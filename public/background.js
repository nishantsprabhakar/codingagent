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

  let clock = 0;

  // ---------- Sun ----------

  const sun = { xf: 0.87, yf: 0.15 };

  const SUN_GRANULES = Array.from({ length: 46 }, () => ({
    angle: Math.random() * Math.PI * 2,
    dist: Math.random() * 0.82,
    r: Math.random() * 0.1 + 0.04,
    tone: Math.random(),
  }));

  const SUN_SPOTS = Array.from({ length: 3 }, () => ({
    angle: Math.random() * Math.PI * 2,
    dist: Math.random() * 0.55,
    r: Math.random() * 0.09 + 0.05,
  }));

  const PROMINENCES = Array.from({ length: 4 }, (_, i) => ({
    base: (i / 4) * Math.PI * 2 + Math.random() * 0.6,
    span: 0.35 + Math.random() * 0.25,
    reach: 0.35 + Math.random() * 0.3,
    phase: Math.random() * Math.PI * 2,
  }));

  // ---------- Earth ----------

  const GLOBE_STEPS = 40;
  const globe = { xf: 0.5, yf: 1.06, tilt: -0.4 };
  let cloudShift = 0;

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

  const CLOUD_PUFFS = Array.from({ length: 8 }, () => ({
    lon: Math.random() * 360 - 180,
    lat: Math.random() * 130 - 65,
    scale: Math.random() * 0.5 + 0.7,
    speed: Math.random() * 0.4 + 0.6,
  }));

  function sphereFromLonLat(lonDeg, latDeg) {
    const lon = lonDeg * DEG;
    const lat = latDeg * DEG;
    return { x: Math.cos(lat) * Math.sin(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.cos(lon) };
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
      cloudShift += dt * (0.015 + boost * 0.05);
    }

    draw();
    if (!reduceMotion) requestAnimationFrame(frame);
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    drawStars();
    drawSun();
    drawGlobe();
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
    const spin = angle * 0.12;

    ctx.save();

    // Outer corona — soft, slightly irregular rather than a perfect ring.
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 4.4 * pulse);
    glow.addColorStop(0, "rgba(255, 214, 130, 0.5)");
    glow.addColorStop(0.35, "rgba(255, 165, 80, 0.15)");
    glow.addColorStop(1, "rgba(255, 140, 60, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 4.4 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Prominence loops arcing off the limb.
    ctx.globalAlpha = 0.5;
    for (const p of PROMINENCES) {
      const wobble = 0.06 * Math.sin(clock * 0.8 + p.phase);
      const a0 = p.base + spin;
      const a1 = a0 + p.span + wobble;
      const reach = r * (1.15 + p.reach + 0.06 * Math.sin(clock * 1.3 + p.phase));
      const x0 = cx + Math.cos(a0) * r * 1.02;
      const y0 = cy + Math.sin(a0) * r * 1.02;
      const x1 = cx + Math.cos(a1) * r * 1.02;
      const y1 = cy + Math.sin(a1) * r * 1.02;
      const midA = (a0 + a1) / 2;
      const cxp = cx + Math.cos(midA) * reach;
      const cyp = cy + Math.sin(midA) * reach;
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, "rgba(255, 120, 60, 0)");
      grad.addColorStop(0.5, "rgba(255, 160, 90, 0.65)");
      grad.addColorStop(1, "rgba(255, 120, 60, 0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cxp, cyp, x1, y1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Photosphere disc, clipped so granulation/spots stay inside it.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * pulse, 0, Math.PI * 2);
    ctx.clip();

    const core = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r * pulse);
    core.addColorStop(0, "#fff8e4");
    core.addColorStop(0.45, "#ffd27a");
    core.addColorStop(1, "#f9862f");
    ctx.fillStyle = core;
    ctx.fillRect(cx - r * 1.2, cy - r * 1.2, r * 2.4, r * 2.4);

    for (const g of SUN_GRANULES) {
      const a = g.angle + spin;
      const gx = cx + Math.cos(a) * g.dist * r;
      const gy = cy + Math.sin(a) * g.dist * r;
      const gr = g.r * r;
      ctx.globalAlpha = 0.18 + g.tone * 0.12;
      ctx.fillStyle = g.tone > 0.5 ? "#fff3cf" : "#e8730f";
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const spot of SUN_SPOTS) {
      const a = spot.angle + spin * 0.8;
      const sx = cx + Math.cos(a) * spot.dist * r;
      const sy = cy + Math.sin(a) * spot.dist * r;
      const sr = spot.r * r;
      const spotGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      spotGrad.addColorStop(0, "rgba(90, 30, 10, 0.55)");
      spotGrad.addColorStop(1, "rgba(90, 30, 10, 0)");
      ctx.fillStyle = spotGrad;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Limb darkening — the edge of a real photosphere reads darker than the center.
    const limb = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
    limb.addColorStop(0, "rgba(0, 0, 0, 0)");
    limb.addColorStop(1, "rgba(160, 50, 10, 0.35)");
    ctx.fillStyle = limb;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  /** Rotates a unit-sphere point by the globe's yaw (`angle`) and fixed tilt, then projects it to screen space. */
  function project(p3, cx, cy, r, tilt) {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const x = p3.x * cosA - p3.z * sinA;
    const z1 = p3.x * sinA + p3.z * cosA;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    const y = p3.y * cosT - z1 * sinT;
    const z = p3.y * sinT + z1 * cosT;
    return { x: cx + x * r, y: cy - y * r, z };
  }

  function fillSmoothPolygon(points) {
    if (points.length < 3) return;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    ctx.beginPath();
    const m0 = mid(points[points.length - 1], points[0]);
    ctx.moveTo(m0.x, m0.y);
    for (let i = 0; i < points.length; i++) {
      const cur = points[i];
      const next = points[(i + 1) % points.length];
      const m = mid(cur, next);
      ctx.quadraticCurveTo(cur.x, cur.y, m.x, m.y);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawGlobe() {
    const cx = width * globe.xf;
    const cy = height * globe.yf;
    const r = Math.min(width, height) * (width < 700 ? 0.44 : 0.34);

    ctx.save();

    // Atmosphere glow beyond the limb.
    const atmo = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.35);
    atmo.addColorStop(0, "rgba(120, 200, 255, 0.28)");
    atmo.addColorStop(1, "rgba(120, 200, 255, 0)");
    ctx.fillStyle = atmo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.35, 0, Math.PI * 2);
    ctx.fill();

    // Ocean base.
    const ocean = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    ocean.addColorStop(0, "#2f7db8");
    ocean.addColorStop(0.55, "#1c5c8c");
    ocean.addColorStop(1, "#0c2f4d");
    ctx.fillStyle = ocean;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Continents.
    ctx.fillStyle = "#3d7a3f";
    for (const shape of CONTINENTS) {
      const points3 = shape.map(([lon, lat]) => sphereFromLonLat(lon, lat));
      const avgZ = points3.reduce((sum, p) => sum + project(p, 0, 0, 1, globe.tilt).z, 0) / points3.length;
      if (avgZ < -0.15) continue;
      const projected = points3.map((p) => project(p, cx, cy, r, globe.tilt));
      fillSmoothPolygon(projected);
    }

    // Polar ice caps — small, fixed near the top/bottom rim (the tilt keeps
    // poles there regardless of yaw, so deriving this from the raw 3D
    // projection is unnecessary and was producing an oversized, misplaced cap).
    ctx.fillStyle = "rgba(235, 245, 250, 0.85)";
    ctx.beginPath();
    ctx.ellipse(cx, cy - r * 0.86, r * 0.3, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.86, r * 0.32, r * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cloud cover, drifting at its own slow pace over the terrain.
    for (const puff of CLOUD_PUFFS) {
      const lon = puff.lon + cloudShift * 40 * puff.speed;
      const p3 = sphereFromLonLat(lon, puff.lat);
      const proj = project(p3, cx, cy, r, globe.tilt);
      if (proj.z < -0.1) continue;
      const size = r * 0.065 * puff.scale;
      for (let i = 0; i < 4; i++) {
        const ox = (i - 1.5) * size * 0.8 + Math.sin(i * 2) * size * 0.2;
        const oy = Math.cos(i * 1.7) * size * 0.25;
        const puffR = size * (0.7 + 0.3 * Math.sin(i * 3.1));
        const puffGrad = ctx.createRadialGradient(
          proj.x + ox, proj.y + oy, 0,
          proj.x + ox, proj.y + oy, puffR
        );
        puffGrad.addColorStop(0, "rgba(255, 255, 255, 0.5)");
        puffGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = puffGrad;
        ctx.beginPath();
        ctx.arc(proj.x + ox, proj.y + oy, puffR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Day/night terminator — fixed to screen space since the sun sits in a fixed corner.
    const shade = ctx.createLinearGradient(cx - r, cy + r, cx + r * 0.6, cy - r * 0.6);
    shade.addColorStop(0, "rgba(2, 6, 12, 0.6)");
    shade.addColorStop(0.55, "rgba(2, 6, 12, 0.18)");
    shade.addColorStop(1, "rgba(2, 6, 12, 0)");
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Rim light.
    ctx.strokeStyle = "rgba(180, 225, 255, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  requestAnimationFrame(frame);
  if (reduceMotion) draw();
})();
