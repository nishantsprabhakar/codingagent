(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  const progress = document.querySelector(".scroll-progress i");
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    if (progress) progress.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
  };
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
  if (!reduce) addEventListener("pointermove", e => {
    root.style.setProperty("--mx", `${e.clientX}px`);
    root.style.setProperty("--my", `${e.clientY}px`);
  }, { passive: true });

  const reveal = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add("is-visible"); reveal.unobserve(entry.target); }
  }), { threshold: .12 });
  document.querySelectorAll("section:not(.hero), .featureGrid article, .pipeline>div, .numbers>div").forEach(el => {
    el.classList.add("reveal"); reveal.observe(el);
  });

  document.querySelectorAll(".featureGrid article").forEach(card => card.addEventListener("pointermove", e => {
    const r = card.getBoundingClientRect(); card.style.setProperty("--x", `${e.clientX-r.left}px`); card.style.setProperty("--y", `${e.clientY-r.top}px`);
  }));

  const missions = {
    engineering: ["MISSION / ENGINEERING", "Refactor the service. Prove the build. Ship the patch.", ["Repository mapped", "Patch implemented", "Project checks running", "Evidence package queued"]],
    diligence: ["MISSION / DILIGENCE", "Build the model. Find the risk. Brief the room.", ["Evidence extracted", "Operating model built", "IC presentation generating", "Cross-artifact verification"]],
    artifacts: ["MISSION / ARTIFACTS", "Turn source evidence into documents that survive review.", ["Sources normalized", "Narrative structured", "Native files compiling", "Quality gate queued"]]
  };
  const buttons = document.querySelectorAll(".missionSwitch button");
  buttons.forEach(button => button.addEventListener("click", () => {
    buttons.forEach(b => b.classList.toggle("active", b === button));
    const data = missions[button.dataset.mission];
    document.getElementById("mission-code").textContent = data[0];
    document.getElementById("mission-title").textContent = data[1];
    document.querySelectorAll(".steps .step strong").forEach((el,i) => el.textContent = data[2][i]);
    document.querySelector(".console .work").animate([{opacity:.3,transform:"translateY(6px)"},{opacity:1,transform:"none"}],{duration:420,easing:"cubic-bezier(.2,.8,.2,1)"});
  }));

  const countObserver = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const el=entry.target,target=Number(el.dataset.count),started=performance.now();
    const tick=now=>{const p=Math.min(1,(now-started)/900);el.textContent=Math.round(target*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(tick);};
    requestAnimationFrame(tick); countObserver.unobserve(el);
  }),{threshold:.7});
  document.querySelectorAll("[data-count]").forEach(el=>countObserver.observe(el));

  const canvas=document.getElementById("system-field");
  if(!canvas||reduce)return;
  const ctx=canvas.getContext("2d");let nodes=[];
  const resize=()=>{const b=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);canvas.width=b.width*d;canvas.height=b.height*d;ctx.setTransform(d,0,0,d,0,0);nodes=Array.from({length:Math.min(64,Math.floor(b.width/18))},()=>({x:Math.random()*b.width,y:Math.random()*b.height,vx:(Math.random()-.5)*.14,vy:(Math.random()-.5)*.14}));};
  new ResizeObserver(resize).observe(canvas);resize();
  const draw=()=>{const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);nodes.forEach((a,i)=>{a.x=(a.x+a.vx+w)%w;a.y=(a.y+a.vy+h)%h;ctx.fillStyle="rgba(99,247,194,.38)";ctx.fillRect(a.x,a.y,1.2,1.2);for(let j=i+1;j<nodes.length;j++){const b=nodes[j],d=Math.hypot(a.x-b.x,a.y-b.y);if(d<115){ctx.strokeStyle=`rgba(99,247,194,${(1-d/115)*.08})`;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}}});requestAnimationFrame(draw);};draw();
})();
