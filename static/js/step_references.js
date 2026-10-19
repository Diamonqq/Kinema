import {esc} from './md.js';

// A reference is part of the unsent draft. Clicking it never sends a message.
export class StepReferences {
 constructor(t){
  this.t=t;this.host=document.createElement('div');this.host.className='tv-step-reference';
  t.el.input.before(this.host);
  t.host.addEventListener('click',e=>{
   const b=e.target.closest('[data-reference-step]');if(b)this.pick(Number(b.dataset.referenceStep),b.dataset.referenceKind);
   if(e.target.closest('[data-reference-clear]')){t.stepReference=null;t.saveDraft();this.render();t.el.input.focus({preventScroll:true});}
  });
  this.render();
 }
 pick(index,kind){
  const t=this.t,w=t.workspace;let ref;
  if(kind==='example'){
   const section=w.selected(),example=Math.max(0,Number(w.view().example)||0),e=section?.lesson?.examples?.[example],s=e?.steps?.[index];if(!s)return;
   ref={section_id:section.id,part_kind:'prepared_example',part_index:example,step_index:index,surface:'lesson',
    title:e.title,reference_label:`${section.id} · Example ${example+1} · Step ${index+1}`,
    text:[e.setup_md,s.math,s.why].filter(Boolean).join('\n\n')};
  }else{
   const p=t.thread?.book_problem,s=p?.prepared_help?.steps?.[index];if(!s||index>=w.progress(p).steps)return;
   ref={...w.visibleContext(),surface:'problem',part_kind:'prepared_problem_help',part_index:index+1,step_index:index,
    title:s.title||p.title,reference_label:`${p.id} · Step ${index+1}`,text:[p.statement_md,s.body_md].filter(Boolean).join('\n\n')};
  }
  t.stepReference=ref;t.saveDraft();this.render();t.el.input.focus({preventScroll:true});
 }
 render(){
  const ref=this.t.stepReference;this.host.hidden=!ref;
  this.host.innerHTML=ref?`<span><b>${esc(ref.reference_label)}</b><small>${esc(ref.title)}</small></span><button type="button" data-reference-clear aria-label="Remove step reference">×</button>`:'';
  for(const b of this.t.host.querySelectorAll('[data-reference-step]')){
   const selected=!!ref&&ref.section_id===(this.t.thread?.book_problem?.id||this.t.workspace?.selected()?.id)&&ref.step_index===Number(b.dataset.referenceStep)&&(b.dataset.referenceKind!=='example'||ref.part_index===(Number(this.t.workspace?.view().example)||0));
   b.setAttribute('aria-pressed',String(selected));
  }
 }
}
