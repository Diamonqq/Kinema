import {esc,mdlite,math,texExpr} from './md.js';
import {controlIcon} from './icons.js';
import {LessonSplitter} from './lesson_splitter.js';

const read=id=>{try{return JSON.parse(localStorage.getItem('kinema.chatStudy.'+id))||{}}catch{return {}}};
const rows=sheet=>(sheet?.sections||[]).flatMap(s=>[s,...(s.subsections||[])]);
export const plainChat=t=>!!t&&!t.study_context&&!t.book_problem&&!t.topic_companion&&t.mode!=='simulation';
export const formulaParts=row=>{
 const explicit=(row?.lesson?.parts||[]).filter(p=>['relations','symbols'].includes(p.id));
 if(explicit.length)return explicit;
 // Revised lessons use authored part IDs rather than the original relations ID.
 // Their compact exact-topic reference retains equations, units and assumptions together.
 if(row?.notes)return [{title:'Relations and conditions',body_md:row.notes}];
 return (row?.lesson?.parts||[]).filter(p=>/\$\$|\\\[/.test(p.body_md||''));
};

// Browsing this shelf never changes a conversation's scope or creates a tutor run.
// The same live artifact DOM moves here; there is no second renderer.
export class ChatStudyPane {
 constructor(t){
  this.t=t;this.states=new Map();this.sheets=new Map();this.media=matchMedia('(max-width:900px)');
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('../chat_study_pane.css',import.meta.url).href;document.head.append(css);
  const el=this.el=document.createElement('aside');el.className='cs-pane';el.hidden=true;el.setAttribute('aria-label','Study pane');
  el.innerHTML=`<header class="cs-head"><b>Study pane</b><button data-cs="close" aria-label="Close study pane" title="Close study pane">${controlIcon('close')}</button></header><nav class="cs-tabs" aria-label="Study pane"><button data-cs="tab" data-tab="visual">Visual</button><button data-cs="tab" data-tab="reference">Reference</button></nav><section class="cs-visual"><div class="cs-visual-status"></div><div class="cs-artifact"></div></section><section class="cs-reference"><div class="cs-selectors"></div><nav class="cs-kinds" aria-label="Reference content"></nav><div class="cs-reading" tabindex="0"></div></section>`;
  t.host.append(el);this.slot=el.querySelector('.cs-artifact');
  const button=this.button=document.createElement('button');button.type='button';button.className='cs-toggle';button.innerHTML=controlIcon('book')+'<span>Study pane</span>';button.setAttribute('aria-expanded','false');button.onclick=()=>{this.state().closed=!this.state().closed;this.save();this.sync()};t.el.read.closest('.tv-readwrap').before(button);
  this.splitter=new LessonSplitter(t.host,el,{key:'kinema.chatStudyWidth.v1',variable:'--cs-width',label:'Resize study pane',breakpoint:900,defaultRatio:.38,enabled:()=>this.active()&&!this.state().closed});
  el.addEventListener('click',e=>this.click(e));el.addEventListener('change',e=>{if(e.target.matches('[data-cs-chapter]'))this.loadChapter(e.target.value);if(e.target.matches('[data-cs-section]')){this.state().section=e.target.value;this.state().example=0;this.save();this.paintReading()}});
  el.querySelector('.cs-reading').addEventListener('scroll',()=>{if(this.active())this.state().scroll=el.querySelector('.cs-reading').scrollTop;this.save()},{passive:true});
  this.media.addEventListener('change',()=>{this.mobileOpen=false;this.sync()});
  document.addEventListener('keydown',e=>{if(!this.active()||el.hidden||!this.media.matches)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.mobileOpen=false;this.sync();button.focus();this.t.reportVisual()}else if(e.key==='Tab'){const ns=[...el.querySelectorAll('button,select,[tabindex="0"]')].filter(n=>n.getClientRects().length&&!n.disabled),first=ns[0],last=ns.at(-1);if(e.shiftKey&&(document.activeElement===first||!el.contains(document.activeElement))){e.preventDefault();last?.focus()}else if(!e.shiftKey&&(document.activeElement===last||!el.contains(document.activeElement))){e.preventDefault();first?.focus()}}},true);
  button.onclick=()=>{if(this.media.matches)this.mobileOpen=!this.mobileOpen;else this.state().closed=!this.state().closed;this.save();this.sync();this.t.reportVisual();if(this.media.matches&&this.mobileOpen)el.querySelector('button')?.focus()};
 }
 active(){const t=this.t;return t.active&&!t.creating&&!t.threadLoading&&!t.page&&!t.studyShown&&plainChat(t.thread)&&!t.workspace?.loading}
 state(){const id=this.t.thread?.id||'new';if(!this.states.has(id)){
   const prior=this.id&&this.id.startsWith('reading:new:')?this.states.get(this.id):null;
   this.states.set(id,{tab:'reference',kind:'notes',...read(id),...(prior||{})});
  }this.id=id;return this.states.get(id)}
 save(){try{localStorage.setItem('kinema.chatStudy.'+this.id,JSON.stringify(this.state()))}catch{}}
 sync(){
  const active=this.active();this.button.hidden=!active;
  const s=this.state(),show=active&&(this.media.matches?!!this.mobileOpen:!s.closed);
  this.el.hidden=!show;this.button.setAttribute('aria-expanded',String(show));this.t.host.classList.toggle('cs-open',show&&!this.media.matches);this.t.host.classList.toggle('cs-mobile',show&&this.media.matches);
  this.el.setAttribute('role',this.media.matches?'dialog':'complementary');if(this.media.matches&&show)this.el.setAttribute('aria-modal','true');else this.el.removeAttribute('aria-modal');
  if(this.wasMobile&&!this.t.artifact.expanded)this.t.el.main.inert=false;
  if(show&&this.media.matches)this.t.el.main.inert=true;this.wasMobile=show&&this.media.matches;
  this.splitter.queue();if(!active){if(this.slot.contains(this.t.artifact.pane))this.t.quietly(()=>this.t.artifact.mountInline(null));return}
  this.el.querySelectorAll('[data-cs=tab]').forEach(b=>b.setAttribute('aria-current',s.tab===b.dataset.tab?'page':'false'));
  this.el.querySelector('.cs-visual').hidden=s.tab!=='visual';this.el.querySelector('.cs-reference').hidden=s.tab!=='reference';
  if(s.tab==='reference'&&show){if(!this.map&&!this.mapLoading)this.loadMap();else if(this.paintId!==this.id)this.paintReference()}
  this.paintId=this.id;
  const art=this.t.thread?.artifact;
  this.el.querySelector('[data-tab=visual]').classList.toggle('cs-has-visual',!!art);
  const status=this.el.querySelector('.cs-visual-status');
  const ready=art?.status==='ready'&&!this.t.visualError&&this.t.stage.owner()===this.t.visualKey(art)&&!this.t.loadingKey;
  status.hidden=!!ready;
  status.innerHTML=art?.status==='error'||this.t.visualError?`<p role="alert">The visual could not open.</p><button data-cs="retry">Try again</button>`:art?.status==='preparing'||this.t.loadingKey?'<p role="status">Preparing your visual…</p>':'<div class="cs-empty"><span class="cs-orbit" aria-hidden="true"></span><h2>Room to see it</h2><p>Ask the tutor for a visual. It opens here beside your conversation.</p></div>';
  if(ready&&!this.t.previewing)this.t.quietly(()=>this.t.artifact.mountInline(this.slot));
  // A hidden tab is not a visible artifact. Keep its pose, pause motion and report honestly.
  if(!show||s.tab!=='visual')this.t.stage.pause?.();
 }
 present(art,ready){
  if(!this.active())return false;
  const key=this.t.visualKey(art);if(art&&key!==this.state().artifactKey){this.state().artifactKey=key;this.state().tab='visual';this.state().closed=false;this.save();if(this.media.matches)this.mobileOpen=true}
  const slot=this.t.el.stream.querySelector('.tv-card-slot');if(slot)slot.innerHTML=ready?`<button class="tv-inline-reopen cs-transcript-link" data-cs="show-visual">${controlIcon('cube')} ${esc(art.title||'Visual')} ${controlIcon('right')}</button>`:'';
  if(slot&&!slot.dataset.csBound){slot.dataset.csBound='1';slot.addEventListener('click',e=>{if(e.target.closest('[data-cs=show-visual]'))this.showVisual()})}
  this.sync();return true;
 }
 showVisual(){this.state().tab='visual';this.state().closed=false;this.mobileOpen=true;this.save();this.sync();this.t.quietly(()=>this.t.artifact.open(true,false));this.t.reportVisual();requestAnimationFrame(()=>this.t.stage.refit?.())}
 async loadMap(){this.mapLoading=true;this.paintReference();try{this.map=await this.t.d.api(this.t.d.url('/api/chapter-map'));this.mapError=''}catch{this.mapError='The reference library could not load.'}finally{this.mapLoading=false;if(this.active())this.paintReference()}}
 get sheet(){return this.sheets.get(String(this.state().chapter))}
 async loadChapter(chapter,{restore=false}={}){
  const id=this.id,seq=this.loadSeq=(this.loadSeq||0)+1,s=this.state(),chosen=String(s.chapter)===String(chapter)?s.section:null;
  s.chapter=chapter;if(!restore){s.section=null;s.example=0;s.scroll=0}this.loading=!!chapter;this.error='';this.save();this.paintReference();if(!chapter){this.loading=false;return}
  try{const scope={kind:'chapter',chapter:Number(chapter)},data=await this.t.d.api(this.t.d.url('/api/teacher/reading?scope='+encodeURIComponent(JSON.stringify(scope))));this.sheets.set(String(chapter),data.topic_companion);if(seq!==this.loadSeq||id!==this.t.thread?.id)return;s.section=rows(this.sheet).some(r=>r.id===chosen)?chosen:rows(this.sheet)[0]?.id;this.save()}
  catch{if(seq===this.loadSeq&&id===this.t.thread?.id)this.error='This chapter could not open.'}
  finally{if(seq===this.loadSeq){this.loading=false;if(this.active())this.paintReference()}}
 }
 paintReference(){
  if(!this.active())return;const s=this.state(),ch=this.map?.chapters?.filter(c=>!c.math)||[],same=this.sheet&&rows(this.sheet).some(r=>r.id===s.section);
  if(s.chapter&&!same&&!this.loading&&!this.error&&this.map){this.loadChapter(s.chapter,{restore:true});return}
  this.el.querySelector('.cs-selectors').innerHTML=`<label><span>Chapter</span><select data-cs-chapter aria-label="Reference chapter"><option value="">Choose a chapter</option>${ch.map(c=>`<option value="${esc(c.n)}" ${String(c.n)===String(s.chapter)?'selected':''}>${esc(c.n+' · '+c.title)}</option>`).join('')}</select></label>${same?`<label><span>Topic</span><select data-cs-section aria-label="Reference topic">${rows(this.sheet).map(r=>`<option value="${esc(r.id)}" ${r.id===s.section?'selected':''}>${esc(r.id+' '+r.title)}</option>`).join('')}</select></label>`:''}`;
  this.el.querySelector('.cs-kinds').innerHTML=same?[['notes','Notes'],['formulas','Formulas'],['examples','Examples']].map(([key,label])=>`<button data-cs="kind" data-kind="${key}" aria-current="${s.kind===key?'page':'false'}">${label}</button>`).join(''):'';
  this.paintReading();
 }
 paintReading(){
  const s=this.state(),box=this.el.querySelector('.cs-reading'),row=rows(this.sheet).find(r=>r.id===s.section);this.rawContext=null;this.contextParts=null;
  if(this.mapError||this.error){box.innerHTML=`<div class="cs-empty" role="alert"><h2>Let's try that again</h2><p>${esc(this.error||this.mapError)}</p><button data-cs="reload">Try again</button></div>`;return}
  if(this.loading||this.mapLoading){box.innerHTML='<p class="cs-loading" role="status">Opening your reference…</p>';return}
  if(!row){box.innerHTML='<div class="cs-empty"><span class="cs-orbit" aria-hidden="true"></span><h2>An idea beside you</h2><p>Choose a chapter to browse its notes, formulas and worked examples while you chat.</p></div>';return}
  let body='',text='';const lesson=row.lesson;
  if(s.kind==='examples'){
   const ex=lesson?.examples||[],idx=Math.max(0,Math.min(ex.length-1,s.example||0)),e=ex[idx];
   if(e){body=`<nav class="cs-example-nav"><button data-cs="example" data-delta="-1" ${idx===0?'disabled':''} aria-label="Previous example">${controlIcon('left')}</button><span>Example ${idx+1} of ${ex.length}</span><button data-cs="example" data-delta="1" ${idx===ex.length-1?'disabled':''} aria-label="Next example">${controlIcon('right')}</button></nav><h2>${esc(e.title)}</h2>${mdlite(e.setup_md)}<ol class="cs-steps">${e.steps.map(step=>`<li>${texExpr(step.math,true)}${mdlite(step.why)}</li>`).join('')}</ol><h3>Result</h3>${mdlite(e.answer_md)}<h3>Check</h3>${mdlite(e.check_md)}`;text=[e.title,e.setup_md,...e.steps.flatMap(x=>[x.math,x.why]),e.answer_md,e.check_md].join('\n')}
  }else{const parts=s.kind==='formulas'?formulaParts(row):(lesson?.parts||[]).filter(p=>!['relations','symbols'].includes(p.id));this.contextParts=parts;body=parts.map((p,i)=>`<section data-cs-part="${i}"><h2>${esc(p.title)}</h2>${mdlite(p.body_md)}</section>`).join('')||mdlite(row.summary||row.notes||'');text=parts.map(p=>p.title+'\n'+p.body_md).join('\n')||row.summary||row.notes||''}
  box.innerHTML=`<header><small>Lesson ${esc(row.id)}</small><h1>${esc(row.title)}</h1></header><article class="mdb">${body}</article>`;math(box);box.scrollTop=s.scroll||0;this.rawContext={title:row.id+' '+row.title+' · '+s.kind,text:text.slice(0,4000),section_id:row.id,part_kind:'reference',surface:'lesson'};
 }
 visibleContext(){
  if(!this.active()||this.el.hidden||this.state().tab!=='reference'||this.loading||this.error||!this.rawContext)return null;
  const box=this.el.querySelector?.('.cs-reading');
  if(!this.contextParts?.length||!box)return this.rawContext;
  const viewport=box.getBoundingClientRect(),visible=[...box.querySelectorAll('[data-cs-part]')].filter(n=>{const r=n.getBoundingClientRect();return r.bottom>viewport.top&&r.top<viewport.bottom}).map(n=>this.contextParts[Number(n.dataset.csPart)]).filter(Boolean);
  return visible.length?{...this.rawContext,text:visible.map(p=>p.title+'\n'+p.body_md).join('\n').slice(0,4000)}:this.rawContext;
 }
 click(e){const b=e.target.closest('[data-cs]');if(!b||b.disabled)return;const s=this.state();switch(b.dataset.cs){case 'close':if(this.media.matches)this.mobileOpen=false;else s.closed=true;this.save();this.sync();this.button.focus();this.t.reportVisual();break;case 'tab':s.tab=b.dataset.tab;this.save();this.sync();this.t.reportVisual();if(s.tab==='visual')this.t.stage.refit?.();break;case 'kind':s.kind=b.dataset.kind;s.scroll=0;this.save();this.paintReference();break;case 'example':s.example=Math.max(0,(s.example||0)+Number(b.dataset.delta));s.scroll=0;this.save();this.paintReading();break;case 'reload':this.error='';if(this.mapError)this.loadMap();else this.loadChapter(s.chapter);break;case 'retry':this.t.visualError=null;this.t.syncVisual(true);break}}
}
