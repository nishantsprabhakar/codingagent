/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
(() => {
  "use strict";

  const canvas = document.getElementById("bg-canvas");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DEG = Math.PI / 180;

  let width = 0;
  let height = 0;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function offscreen(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  // ---------- Stars ----------

  const STAR_COUNT = 220;
  const stars = Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.3 + 0.3,
    phase: Math.random() * Math.PI * 2,
    twinkleSpeed: Math.random() * 0.5 + 0.15,
    drift: Math.random() * 0.6 + 0.2,
  }));

  // Faint Milky-Way-style haze behind the stars, for depth.
  const NEBULA_BLOBS = [
    { x: 0.12, y: 0.28, r: 0.42, color: "80, 90, 200" },
    { x: 0.68, y: 0.62, r: 0.5, color: "120, 70, 170" },
    { x: 0.35, y: 0.75, r: 0.38, color: "60, 110, 190" },
  ];

  let clock = 0;

  // ---------- Sun (baked once to a texture, rotated + relit live) ----------

  const sun = { xf: 0.87, yf: 0.15 };

  function buildSunTexture(size) {
    const c = offscreen(size, size);
    const tctx = c.getContext("2d");
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2;

    const core = tctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, 0, cx, cy, r);
    core.addColorStop(0, "#fff8e4");
    core.addColorStop(0.5, "#ffd27a");
    core.addColorStop(0.8, "#fca846");
    core.addColorStop(1, "#e8730f");
    tctx.fillStyle = core;
    tctx.beginPath();
    tctx.arc(cx, cy, r, 0, Math.PI * 2);
    tctx.fill();

    tctx.save();
    tctx.beginPath();
    tctx.arc(cx, cy, r, 0, Math.PI * 2);
    tctx.clip();

    for (let i = 0; i < 240; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r * 0.95;
      const gx = cx + Math.cos(a) * d;
      const gy = cy + Math.sin(a) * d;
      const gr = Math.random() * r * 0.05 + r * 0.018;
      const tone = Math.random();
      tctx.globalAlpha = 0.05 + tone * 0.05;
      tctx.fillStyle = tone > 0.5 ? "#fff3cf" : "#d9640a";
      tctx.beginPath();
      tctx.arc(gx, gy, gr, 0, Math.PI * 2);
      tctx.fill();
    }
    tctx.globalAlpha = 1;

    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r * 0.5;
      const sx = cx + Math.cos(a) * d;
      const sy = cy + Math.sin(a) * d;
      const sr = r * (0.06 + Math.random() * 0.05);
      const g = tctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, "rgba(110, 40, 15, 0.45)");
      g.addColorStop(1, "rgba(110, 40, 15, 0)");
      tctx.fillStyle = g;
      tctx.beginPath();
      tctx.arc(sx, sy, sr, 0, Math.PI * 2);
      tctx.fill();
    }

    const limb = tctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r);
    limb.addColorStop(0, "rgba(0, 0, 0, 0)");
    limb.addColorStop(1, "rgba(140, 40, 10, 0.4)");
    tctx.fillStyle = limb;
    tctx.beginPath();
    tctx.arc(cx, cy, r, 0, Math.PI * 2);
    tctx.fill();

    tctx.restore();
    return c;
  }

  const SUN_TEXTURE = buildSunTexture(256);

  const PROMINENCES = Array.from({ length: 3 }, (_, i) => ({
    base: (i / 3) * Math.PI * 2 + Math.random() * 0.6,
    span: 0.3 + Math.random() * 0.2,
    reach: 0.3 + Math.random() * 0.22,
    phase: Math.random() * Math.PI * 2,
  }));

  // ---------- Earth (baked equirectangular texture, rendered as foreshortened strips) ----------

  const globe = { xf: 0.5, yf: 1.06 };
  let cloudDriftDeg = 0;

  // Very simplified, stylized continent silhouettes (lon, lat in degrees) — not surveyed coastlines.
  const CONTINENTS = [
    [
      [-17, 35], [10, 37], [33, 31], [43, 12], [51, -2],
      [40, -26], [20, -35], [12, -18], [9, 4], [-10, 10], [-17, 20],
    ],
    [
      [-10, 71], [40, 70], [100, 72], [140, 60], [150, 45],
      [130, 25], [105, 10], [80, 8], [60, 25], [45, 40], [30, 45], [15, 45], [-5, 60],
    ],
    [
      [-165, 68], [-140, 60], [-125, 49], [-117, 33], [-97, 26],
      [-80, 25], [-75, 45], [-95, 50], [-110, 60], [-140, 68],
    ],
    [
      [-80, 10], [-60, 10], [-50, 0], [-35, -8], [-40, -20],
      [-58, -35], [-70, -45], [-73, -20], [-80, -5],
    ],
    [
      [113, -12], [135, -11], [145, -16], [153, -28], [140, -38], [120, -34], [113, -22],
    ],
  ];

  function fillSmoothPath(tctx, points) {
    if (points.length < 3) return;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    tctx.beginPath();
    const m0 = mid(points[points.length - 1], points[0]);
    tctx.moveTo(m0.x, m0.y);
    for (let i = 0; i < points.length; i++) {
      const cur = points[i];
      const next = points[(i + 1) % points.length];
      const m = mid(cur, next);
      tctx.quadraticCurveTo(cur.x, cur.y, m.x, m.y);
    }
    tctx.closePath();
  }

  function buildEarthTexture() {
    const w = 720;
    const h = 360;
    const c = offscreen(w, h);
    const tctx = c.getContext("2d");
    const lonLatToXY = (lon, lat) => ({ x: ((lon + 180) / 360) * w, y: ((90 - lat) / 180) * h });

    // Night-side Earth: near-black ocean/land, lit mainly by clustered city lights.
    const ocean = tctx.createLinearGradient(0, 0, 0, h);
    ocean.addColorStop(0, "#02050c");
    ocean.addColorStop(0.15, "#050e1e");
    ocean.addColorStop(0.5, "#0a1830");
    ocean.addColorStop(0.85, "#050e1e");
    ocean.addColorStop(1, "#02050c");
    tctx.fillStyle = ocean;
    tctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 900; i++) {
      tctx.fillStyle = `rgba(120, 160, 255, ${Math.random() * 0.03})`;
      tctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }

    function cityLights(pts, minX, maxX, minY, maxY, density) {
      const spots = [];
      for (const p of pts) {
        for (let i = 0; i < density; i++) {
          spots.push({ x: p.x + (Math.random() - 0.5) * 16, y: p.y + (Math.random() - 0.5) * 16 });
        }
      }
      for (let i = 0; i < density * pts.length; i++) {
        spots.push({ x: minX + Math.random() * (maxX - minX), y: minY + Math.random() * (maxY - minY) });
      }
      for (const s of spots) {
        const r = Math.random() * 1.5 + 0.4;
        const g = tctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 3.2);
        g.addColorStop(0, "rgba(255, 220, 150, 0.85)");
        g.addColorStop(0.4, "rgba(255, 175, 70, 0.35)");
        g.addColorStop(1, "rgba(255, 175, 70, 0)");
        tctx.fillStyle = g;
        tctx.beginPath();
        tctx.arc(s.x, s.y, r * 3.2, 0, Math.PI * 2);
        tctx.fill();
      }
    }

    CONTINENTS.forEach((shape, idx) => {
      const pts = shape.map(([lon, lat]) => lonLatToXY(lon, lat));
      tctx.save();
      fillSmoothPath(tctx, pts);
      tctx.clip();

      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const base = tctx.createLinearGradient(minX, minY, maxX, maxY);
      base.addColorStop(0, "#1b160f");
      base.addColorStop(1, "#100c08");
      tctx.fillStyle = base;
      tctx.fillRect(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);

      // Africa/Eurasia (indices 0-1) get denser lights to match a classic
      // Europe/Middle East/Africa night view; the rest are sparser.
      cityLights(pts, minX, maxX, minY, maxY, idx <= 1 ? 4 : 2);
      tctx.restore();
    });

    const iceH = h * 0.1;
    const iceTop = tctx.createLinearGradient(0, 0, 0, iceH * 1.6);
    iceTop.addColorStop(0, "rgba(190, 210, 235, 0.65)");
    iceTop.addColorStop(1, "rgba(190, 210, 235, 0)");
    tctx.fillStyle = iceTop;
    tctx.fillRect(0, 0, w, iceH * 1.6);
    const iceBottom = tctx.createLinearGradient(0, h - iceH * 1.6, 0, h);
    iceBottom.addColorStop(0, "rgba(190, 210, 235, 0)");
    iceBottom.addColorStop(1, "rgba(190, 210, 235, 0.65)");
    tctx.fillStyle = iceBottom;
    tctx.fillRect(0, h - iceH * 1.6, w, iceH * 1.6);

    return c;
  }

  // Clouds are drawn dynamically per frame (not baked into the strip-mapped
  // texture): a tight bright puff sliced across strips with different
  // stretch factors near the limb created a visible seam/"comet" artifact.
  // Broad, low-contrast content (continents, ocean) hides that seam fine,
  // but small bright gradients don't, so clouds get their own single-shape
  // projection with a horizontal-only foreshortening squash instead.
  const CLOUD_PUFFS = Array.from({ length: 12 }, () => ({
    lon: Math.random() * 360 - 180,
    lat: Math.random() * 130 - 65,
    scale: Math.random() * 0.5 + 0.7,
    speed: Math.random() * 0.4 + 0.7,
  }));

  const EARTH_TEXTURE = buildEarthTexture();
  const GLOBE_STRIPS = 90;
  const STRIP_DEG = 360 / GLOBE_STRIPS;

  function normalizeDeg(d) {
    return ((d % 360) + 540) % 360 - 180;
  }

  /**
   * Draws a lon/lat texture as vertical strips, each foreshortened by how far
   * around the sphere it's rotated — this is what makes continents narrow
   * near the limb instead of looking like a flat sticker.
   */
  function drawGlobeStrips(texture, cx, cy, r, rotationDeg, lonOffsetDeg) {
    const srcStripW = texture.width / GLOBE_STRIPS;
    for (let i = 0; i < GLOBE_STRIPS; i++) {
      const worldLon = -180 + (i + 0.5) * STRIP_DEG;
      const appLon = normalizeDeg(worldLon - rotationDeg + lonOffsetDeg);
      if (appLon <= -90 || appLon >= 90) continue;
      let leftLon = Math.max(appLon - STRIP_DEG / 2, -90);
      let rightLon = Math.min(appLon + STRIP_DEG / 2, 90);
      const leftX = Math.sin(leftLon * DEG) * r;
      const rightX = Math.sin(rightLon * DEG) * r;
      const dstX = cx + Math.min(leftX, rightX);
      const dstW = Math.abs(rightX - leftX);
      if (dstW < 0.4) continue;
      ctx.drawImage(texture, i * srcStripW, 0, srcStripW, texture.height, dstX, cy - r, dstW, r * 2);
    }
  }

  /** Projects one lon/lat point to screen space; z is a 0..1 foreshortening factor (0 = at the limb). */
  function projectPoint(lonDeg, latDeg, cx, cy, r, rotationDeg) {
    const appLon = normalizeDeg(lonDeg - rotationDeg);
    if (appLon <= -90 || appLon >= 90) return null;
    const x = Math.sin(appLon * DEG) * r;
    const y = Math.sin(latDeg * DEG) * r;
    const z = Math.cos(appLon * DEG);
    return { x: cx + x, y: cy - y, z };
  }

  function drawClouds(cx, cy, r, rotationDeg) {
    for (const puff of CLOUD_PUFFS) {
      const lon = normalizeDeg(puff.lon + cloudDriftDeg * puff.speed);
      const proj = projectPoint(lon, puff.lat, cx, cy, r, rotationDeg);
      if (!proj) continue;
      const squash = Math.max(proj.z, 0.18);
      const size = r * 0.09 * puff.scale;
      ctx.save();
      ctx.translate(proj.x, proj.y);
      ctx.scale(squash, 1);
      for (let i = 0; i < 4; i++) {
        const ox = (i - 1.5) * size * 0.8 + Math.sin(i * 2) * size * 0.2;
        const oy = Math.cos(i * 1.7) * size * 0.25;
        const puffR = size * (0.7 + 0.3 * Math.sin(i * 3.1));
        const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, puffR);
        grad.addColorStop(0, "rgba(255, 255, 255, 0.5)");
        grad.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(ox, oy, puffR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // A small fixed "digital twin" accent (orbit rings + a data-node network)
  // layered over the realistic globe — deliberately not tied to lon/lat
  // rotation math, since a screen-space HUD reads as intentional while a
  // geometrically-simplified lat/lon grid would visibly not converge at the
  // poles and look like a bug instead of a feature.
  const TECH_NODES = [
    { dx: -0.38, dy: -0.72 },
    { dx: 0.22, dy: -0.88 },
    { dx: 0.58, dy: -0.5 },
    { dx: -0.05, dy: -0.98 },
  ];
  const TECH_LINKS = [
    [0, 1],
    [1, 2],
    [1, 3],
  ];

  function drawTechOverlay(cx, cy, r) {
    ctx.save();
    ctx.strokeStyle = "rgba(103, 232, 249, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.85, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();

    const pts = TECH_NODES.map((n) => ({ x: cx + n.dx * r, y: cy + n.dy * r }));
    ctx.strokeStyle = "rgba(103, 232, 249, 0.35)";
    for (const [a, b] of TECH_LINKS) {
      ctx.beginPath();
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
      ctx.stroke();
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const pulse = 0.5 + 0.5 * Math.sin(clock * 2 + i * 1.3);
      ctx.fillStyle = `rgba(160, 240, 255, ${0.5 + pulse * 0.4})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6 + pulse * 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(103, 232, 249, ${0.3 * (1 - pulse)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5 + pulse * 4.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Interaction: touch/pointer speeds everything up ----------

  let boost = 0;
  let lastPointer = null;

  function kick(amount) {
    boost = Math.min(boost + amount, 3.5);
  }

  function onPointerMove(x, y) {
    if (lastPointer) {
      const dx = x - lastPointer.x;
      const dy = y - lastPointer.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      kick(Math.min(dist / 35, 0.6));
    }
    lastPointer = { x, y };
  }

  window.addEventListener("pointermove", (e) => onPointerMove(e.clientX, e.clientY), { passive: true });
  window.addEventListener(
    "pointerdown",
    (e) => {
      onPointerMove(e.clientX, e.clientY);
      kick(0.7);
    },
    { passive: true }
  );
  window.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      if (t) onPointerMove(t.clientX, t.clientY);
    },
    { passive: true }
  );
  window.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      if (t) onPointerMove(t.clientX, t.clientY);
      kick(0.7);
    },
    { passive: true }
  );
  window.addEventListener("wheel", () => kick(0.35), { passive: true });

  // ---------- Rotation / animation loop ----------

  let angle = 0.6;
  let last = null;
  let running = true;

  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) {
      last = null;
      requestAnimationFrame(frame);
    }
  });

  function frame(ts) {
    if (!running) return;
    if (last == null) last = ts;
    const dt = Math.min((ts - last) / 1000, 0.05);
    last = ts;
    clock += dt;

    if (!reduceMotion) {
      boost *= Math.pow(0.05, dt);
      const speed = 0.08 + boost * 0.7;
      angle += speed * dt;
      cloudDriftDeg += dt * (0.6 + boost * 2);
    }

    draw();
    if (!reduceMotion) requestAnimationFrame(frame);
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    drawNebula();
    drawStars();
    drawSun();
    drawGlobe();
  }

  function drawNebula() {
    ctx.save();
    for (const n of NEBULA_BLOBS) {
      const cx = n.x * width;
      const cy = n.y * height;
      const r = n.r * Math.max(width, height);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${n.color}, 0.07)`);
      g.addColorStop(1, `rgba(${n.color}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawStars() {
    const driftSpeed = (0.15 + boost * 0.7) * 0.0006;
    ctx.save();
    for (const s of stars) {
      s.x -= s.drift * driftSpeed;
      if (s.x < -0.02) s.x = 1.02;
      const twinkle = 0.5 + 0.5 * Math.sin(clock * s.twinkleSpeed * 4 + s.phase);
      ctx.globalAlpha = 0.25 + twinkle * 0.65;
      ctx.fillStyle = "#dff6ff";
      ctx.beginPath();
      ctx.arc(s.x * width, s.y * height, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSun() {
    const cx = sun.xf * width;
    const cy = sun.yf * height;
    const r = width < 700 ? 34 : 46;
    const pulse = 1 + 0.035 * Math.sin(clock * 1.1);
    const spin = angle * 0.1;

    ctx.save();

    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 4.4 * pulse);
    glow.addColorStop(0, "rgba(255, 214, 130, 0.5)");
    glow.addColorStop(0.35, "rgba(255, 165, 80, 0.15)");
    glow.addColorStop(1, "rgba(255, 140, 60, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 4.4 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.4;
    for (const p of PROMINENCES) {
      const wobble = 0.06 * Math.sin(clock * 0.8 + p.phase);
      const a0 = p.base + spin;
      const a1 = a0 + p.span + wobble;
      const reach = r * (1.12 + p.reach + 0.05 * Math.sin(clock * 1.3 + p.phase));
      const x0 = cx + Math.cos(a0) * r * 1.0;
      const y0 = cy + Math.sin(a0) * r * 1.0;
      const x1 = cx + Math.cos(a1) * r * 1.0;
      const y1 = cy + Math.sin(a1) * r * 1.0;
      const midA = (a0 + a1) / 2;
      const cxp = cx + Math.cos(midA) * reach;
      const cyp = cy + Math.sin(midA) * reach;
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, "rgba(255, 120, 60, 0)");
      grad.addColorStop(0.5, "rgba(255, 160, 90, 0.55)");
      grad.addColorStop(1, "rgba(255, 120, 60, 0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cxp, cyp, x1, y1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    ctx.drawImage(SUN_TEXTURE, -r * pulse, -r * pulse, r * pulse * 2, r * pulse * 2);
    ctx.restore();

    ctx.restore();
  }

  function drawGlobe() {
    const cx = width * globe.xf;
    const cy = height * globe.yf;
    const r = Math.min(width, height) * (width < 700 ? 0.44 : 0.34);
    const rotationDeg = angle / DEG;

    ctx.save();

    const atmo = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.35);
    atmo.addColorStop(0, "rgba(120, 200, 255, 0.28)");
    atmo.addColorStop(1, "rgba(120, 200, 255, 0)");
    ctx.fillStyle = atmo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Base fill avoids thin seams between strips at fractional-pixel boundaries.
    ctx.fillStyle = "#050e1e";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    drawGlobeStrips(EARTH_TEXTURE, cx, cy, r, rotationDeg, 0);
    drawClouds(cx, cy, r, rotationDeg);

    // Day/night terminator with a warm sunrise band, fixed to screen space
    // since the sun sits in a fixed corner — this is what makes the city
    // lights on the dark side read against a warmer, lived-in lit side.
    const shade = ctx.createLinearGradient(cx - r, cy + r, cx + r * 0.6, cy - r * 0.6);
    shade.addColorStop(0, "rgba(2, 6, 14, 0.55)");
    shade.addColorStop(0.42, "rgba(2, 6, 14, 0.22)");
    shade.addColorStop(0.55, "rgba(255, 140, 80, 0.14)");
    shade.addColorStop(0.7, "rgba(255, 190, 130, 0.05)");
    shade.addColorStop(1, "rgba(255, 190, 130, 0)");
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    drawTechOverlay(cx, cy, r);

    ctx.restore();

    ctx.strokeStyle = "rgba(140, 210, 255, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  requestAnimationFrame(frame);
  if (reduceMotion) draw();
})();
