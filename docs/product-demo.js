const missions={
  engineering:{project:'PAYMENTS SERVICE',files:'28',evidence:'42',label:'MISSION / ENGINEERING',title:'Refactor the payment service and prove nothing broke.',prompt:'“Replace the legacy retry logic, preserve API behaviour, run the full test suite and return a review-ready patch.”',algos:['Repository graph + dependency scan','Bounded actions + mutation approval','Parallel isolated candidates scored','Test · lint · build · repair','Diff + checks + rollback point'],result:['Review-ready patch','Tests + lint + build pass','Diff · logs · rollback']},
  diligence:{project:'ACME DILIGENCE',files:'63',evidence:'184',label:'MISSION / DILIGENCE',title:'Build the model. Find the risk. Brief the room.',prompt:'“Review the data room, create the operating model, identify material risks and produce a fully sourced investment committee deck.”',algos:['Document ingestion + claim mapping','Workplan + source permissions','Parallel research hypotheses scored','Formula · citation · consistency checks','Model + report + deck + evidence'],result:['IC-ready deliverable set','Reconciled model + sourced claims','Source map · checks · history']},
  artifacts:{project:'BOARD REPORTING',files:'41',evidence:'96',label:'MISSION / EXECUTIVE OUTPUTS',title:'Turn the quarter into one coherent executive narrative.',prompt:'“Reconcile operating data, build the board workbook, write the performance report and produce a presentation with consistent numbers.”',algos:['Cross-file schema + data mapping','Artifact plan + output contracts','Specialist document skills routed','Formula · layout · narrative checks','XLSX + DOCX + PPTX package'],result:['Board-ready artifact suite','Numbers agree across every file','Checks · provenance · versions']}
};
const buttons=[...document.querySelectorAll('.mission-tabs button')];
const ids=['project-name','file-count','evidence-count','mission-label','mission-title','mission-prompt'];
buttons.forEach(button=>button.addEventListener('click',()=>{
  const data=missions[button.dataset.mission];
  buttons.forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-selected',String(b===button));});
  const values=[data.project,data.files,data.evidence,data.label,data.title,data.prompt];
  ids.forEach((id,i)=>{const el=document.getElementById(id);el.animate([{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:280});el.textContent=values[i];});
  data.algos.forEach((value,i)=>document.getElementById(`algo-${i+1}`).textContent=value);
  ['result-output','result-contract','result-evidence'].forEach((id,i)=>document.getElementById(id).textContent=data.result[i]);
}));

const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.animate([{opacity:0,transform:'translateY(22px)'},{opacity:1,transform:'none'}],{duration:650,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'});observer.unobserve(entry.target);}}),{threshold:.12});
document.querySelectorAll('.cap-grid article,.proof-stack>div,.benefit-grid>div').forEach(el=>observer.observe(el));
