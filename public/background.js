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

  const meteors = [];
  let nextMeteorAt = 4 + Math.random() * 6;
  let clock = 0;

  function spawnMeteor() {
    const startX = Math.random() * width * 0.6 + width * 0.2;
    meteors.push({
      x: startX,
      y: -20,
      vx: -260 - Math.random() * 140,
      vy: 180 + Math.random() * 100,
      life: 1,
    });
  }

  // ---------- Sun ----------

  const sun = { xf: 0.87, yf: 0.15 };

  // ---------- Globe ----------

  const GLOBE_MERIDIANS = 10;
  const GLOBE_PARALLELS = 5;
  const GLOBE_STEPS = 56;
  const globe = { xf: 0.5, yf: 1.05, tilt: -0.38 };

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
      const speed = 0.1 + boost * 0.85;
      angle += speed * dt;

      nextMeteorAt -= dt;
      if (nextMeteorAt <= 0) {
        spawnMeteor();
        nextMeteorAt = 5 + Math.random() * 7;
      }
    }

    draw(dt);
    if (!reduceMotion) requestAnimationFrame(frame);
  }

  function draw(dt) {
    ctx.clearRect(0, 0, width, height);
    drawStars(dt);
    drawMeteors(dt);
    drawSun();
    drawGlobe();
  }

  function drawStars(dt) {
    const driftSpeed = (0.15 + boost * 0.7) * dt * 0.02;
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

  function drawMeteors(dt) {
    ctx.save();
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.life -= dt * 0.6;
      if (m.life <= 0 || m.y > height + 40) {
        meteors.splice(i, 1);
        continue;
      }
      const grad = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 0.08, m.y - m.vy * 0.08);
      grad.addColorStop(0, `rgba(224, 246, 255, ${Math.max(m.life, 0)})`);
      grad.addColorStop(1, "rgba(224, 246, 255, 0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * 0.08, m.y - m.vy * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSun() {
    const cx = sun.xf * width;
    const cy = sun.yf * height;
    const r = (width < 700 ? 30 : 44) * (width < 700 ? 0.85 : 1);
    const pulse = 1 + 0.05 * Math.sin(clock * 1.4);

    ctx.save();
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 4.4 * pulse);
    glow.addColorStop(0, "rgba(255, 214, 120, 0.5)");
    glow.addColorStop(0.35, "rgba(255, 170, 80, 0.16)");
    glow.addColorStop(1, "rgba(255, 170, 80, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 4.4 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#ffd27a";
    ctx.lineWidth = 1;
    const rayCount = 10;
    for (let i = 0; i < rayCount; i++) {
      const a = angle * 0.5 + (i / rayCount) * Math.PI * 2;
      const inner = r * 1.35;
      const outer = r * (2.05 + 0.12 * Math.sin(clock * 2 + i));
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const core = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r * pulse);
    core.addColorStop(0, "#fff6e0");
    core.addColorStop(0.5, "#ffd27a");
    core.addColorStop(1, "#ff9d4d");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, r * pulse, 0, Math.PI * 2);
    ctx.fill();
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

  function strokeSphereLine(points, cx, cy, r, tilt) {
    ctx.beginPath();
    let started = false;
    for (const p3 of points) {
      const proj = project(p3, cx, cy, r, tilt);
      if (proj.z < -0.04) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(proj.x, proj.y);
        started = true;
      } else {
        ctx.lineTo(proj.x, proj.y);
      }
    }
    ctx.stroke();
  }

  function drawGlobe() {
    const cx = width * globe.xf;
    const cy = height * globe.yf;
    const r = Math.min(width, height) * (width < 700 ? 0.42 : 0.32);

    ctx.save();

    const atmo = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.4);
    atmo.addColorStop(0, "rgba(34, 211, 238, 0.22)");
    atmo.addColorStop(1, "rgba(34, 211, 238, 0)");
    ctx.fillStyle = atmo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2);
    ctx.fill();

    const base = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    base.addColorStop(0, "rgba(30, 41, 59, 0.92)");
    base.addColorStop(1, "rgba(6, 10, 16, 0.96)");
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.strokeStyle = "rgba(103, 232, 249, 0.5)";
    ctx.lineWidth = 1;
    for (let m = 0; m < GLOBE_MERIDIANS; m++) {
      const theta = (m / GLOBE_MERIDIANS) * Math.PI * 2;
      const points = [];
      for (let t = 0; t <= GLOBE_STEPS; t++) {
        const phi = (t / GLOBE_STEPS) * Math.PI * 2;
        points.push({ x: Math.sin(phi) * Math.cos(theta), y: Math.cos(phi), z: Math.sin(phi) * Math.sin(theta) });
      }
      strokeSphereLine(points, cx, cy, r, globe.tilt);
    }

    ctx.strokeStyle = "rgba(103, 232, 249, 0.4)";
    for (let p = 1; p < GLOBE_PARALLELS; p++) {
      const lat = (p / GLOBE_PARALLELS) * Math.PI - Math.PI / 2;
      const points = [];
      for (let t = 0; t <= GLOBE_STEPS; t++) {
        const theta = (t / GLOBE_STEPS) * Math.PI * 2;
        points.push({ x: Math.cos(lat) * Math.cos(theta), y: Math.sin(lat), z: Math.cos(lat) * Math.sin(theta) });
      }
      strokeSphereLine(points, cx, cy, r, globe.tilt);
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(167, 139, 250, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  requestAnimationFrame(frame);
  if (reduceMotion) draw(0);
})();
