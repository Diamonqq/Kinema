import {esc} from '../md.js';
import {LessonSplitter} from '../lesson_splitter.js';
import {ExperimentShell} from './kit/shell.js';
import {VectorStage} from './kit/stage.js';

export class Experiments {
 constructor(t){
  this.t=t;this.rejected=new Set();try{this.rejected=new Set(JSON.parse(localStorage.getItem('kinema.experimentRejectedActions')||'[]'));}catch{}this.snapshots=new Map();this.snapshotRevisions=new Map();this.seen=new Map();
  this.gallery=document.createElement('section');this.gallery.className='exp-gallery';this.gallery.dataset.page='experiments';this.gallery.hidden=true;t.el.page.append(this.gallery);
  this.splitter=new LessonSplitter(t.host,t.host.querySelector('#tv-visual'),{key:'kinema.experimentPaneRatio.v1',variable:'--exp-width',label:'Resize experiment pane',className:'sl-divider exp-divider',breakpoint:900,defaultRatio:.54,enabled:()=>t.active&&!t.page&&!t.studyShown&&t.thread?.mode==='experiment'&&t.artifact.opened&&!t.artifact.expanded&&!t.artifact.inline});
  this.gallery.addEventListener('click',e=>{const b=e.target.closest('[data-experiment]');if(b)this.open(b.dataset.experiment);if(e.target.closest('[data-experiments-retry]'))this.paintGallery();});
 }
 async catalog(){if(!this.entries)this.entries=(await this.t.d.api(this.t.d.url('/api/experiments'))).experiments;return this.entries;}
 async paintGallery(){
  const epoch=this.galleryEpoch=(this.galleryEpoch||0)+1;this.gallery.innerHTML='<div class="exp-gallery-head"><h1>Experiments</h1><p>Change something. See what follows.</p></div><p role="status">Loading experiments…</p>';
  try{
   const entries=await this.catalog();if(this.t.page!=='experiments'||epoch!==this.galleryEpoch)return;
   this.gallery.innerHTML='<div class="exp-gallery-head"><h1>Experiments</h1><p>Change something. See what follows.</p></div>'+['Mechanics','Relativity'].filter(group=>entries.some(e=>e.group===group)).map(group=>`<section class="exp-group"><h2>${group}</h2><div class="exp-grid">${entries.filter(e=>e.group===group).map(e=>`<button class="exp-card" data-experiment="${esc(e.id)}"><div class="exp-thumb"><canvas data-thumbnail="${esc(e.id)}" aria-hidden="true"></canvas></div><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p><span>Open experiment ↗</span></button>`).join('')}</div></section>`).join('');
   // Thumbnails load together, so one slow module does not hold back the others.
   await Promise.all(entries.map(async entry=>{
    try{const [{model},{view}]=await Promise.all([import(`./${entry.id}/model.js`),import(`./${entry.id}/view.js`)]);if(epoch!==this.galleryEpoch||this.t.page!=='experiments')return;const canvas=this.gallery.querySelector(`[data-thumbnail="${entry.id}"]`);if(!canvas)return;const stage=new VectorStage(canvas),instance=model.create();stage.begin();view.draw(stage,{instance,params:{...Object.fromEntries(model.params.map(p=>[p.key,p.value]))},sample:instance.sample(),geometry:instance.geometry(),t:0,breakdown:false,closeup:'',thumbnail:true,samples:[instance.sample()]});}
    catch{const card=this.gallery.querySelector(`[data-experiment="${entry.id}"]`);if(card){card.disabled=true;card.querySelector('span').textContent='Could not open · reload to try again';}}
   }));
  }catch(e){if(epoch===this.galleryEpoch)this.gallery.innerHTML=`<div class="exp-gallery-head"><h1>Experiments</h1><p role="alert">Could not load experiments. ${esc(e.message)}</p><button data-experiments-retry>Try again</button></div>`;}
 }
 async open(id){const ok=await this.t.newChat({mode:'experiment',experiment_id:id,resume:true});if(ok){this.t.syncSection();await this.sync(this.t.thread,true);}}
 localKey(t){return 'kinema.experiment.'+t.id;}
 snapshot(){const t=this.t.thread;if(t?.mode!=='experiment')return undefined;return this.shell?.threadId===t.id?this.shell.snapshot():this.snapshotRevisions.get(t.id)===t.revision?this.snapshots.get(t.id):t.experiment.state;}
 remember(t,state){this.snapshots.set(t.id,state);this.snapshotRevisions.set(t.id,t.revision);try{localStorage.setItem(this.localKey(t),JSON.stringify({revision:t.revision,state}));}catch{}clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.save(t,state),350);}
 async save(t,state){if(t.pending)return;try{await this.t.d.api(this.t.d.url('/api/teacher/threads/'+t.id+'/experiment'),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:t.revision,state})});}catch{/* local snapshot remains recoverable; next send includes the exact current state */}}
 async sync(t,reentered=false){
  if(!t?.experiment||this.t.page||!this.t.active||this.t.studyShown)return;
  const key=t.id+':'+t.experiment.id;
  if(this.mounting===key)return this.mountPromise;
  if(this.t.artifact.sceneHandle?.experimentKey===key&&this.shell){this.applyActions(t);return;}
  if(!reentered&&this.closed===key)return;
  this.closed=null;this.mounting=key;
  this.mountPromise=(async()=>{
   try{
    const manifest=(await this.catalog()).find(m=>m.id===t.experiment.id);if(!manifest)throw Error('This experiment is unavailable.');
    const [physics,{view}]=await Promise.all([import(`./${manifest.id}/model.js`),import(`./${manifest.id}/view.js`)]);const model={...physics.model,prepareUpdate:physics.prepareUpdate||physics.model.prepareUpdate,sampleBatches:physics.sampleBatches||physics.model.sampleBatches};
    if(this.t.thread?.id!==t.id||this.t.page||!this.t.active)return;
    let state=this.snapshotRevisions.get(t.id)===t.revision?this.snapshots.get(t.id):t.experiment.state;
    try{const local=JSON.parse(localStorage.getItem(this.localKey(t)));if(local?.revision===t.revision)state=local.state;}catch{}
    this.seen.set(t.id,new Set((t.messages||[]).map(m=>m.id)));
    const result=await this.t.artifact.showScene(manifest.title,host=>{
     this.splitter.layout();
     let restoring=true;
     const shell=this.shell=new ExperimentShell(host,{model,view,manifest,values:state.params,onChange:s=>{if(!restoring)this.remember(this.t.thread?.id===t.id?this.t.thread:t,s);},onBack:()=>this.back()});shell.threadId=t.id;
     shell.seek(state.t||0);shell.setCloseup(state.closeup||'');shell.setBreakdown(state.breakdown||false);for(const id of state.graphs||[])shell.enabledGraphs.add(id);if(shell.enabledGraphs.size){shell.q('.exp-graph-panel').hidden=false;shell.q('[data-exp=graphs]').setAttribute('aria-expanded','true');shell.syncGraphVisibility();}
     restoring=false;
     return {experimentKey:key,resize:()=>shell.resize(),destroy:()=>{this.remember(this.t.thread?.id===t.id?this.t.thread:t,shell.snapshot());shell.destroy();if(this.shell===shell)this.shell=null;}};
    });
    if(!result.ok&&!result.cancelled)throw Error(result.error);
    if(this.t.thread?.id===t.id)this.applyActions(this.t.thread);this.splitter.layout();this.shell?.resize();this.updateReopen();
   }catch(e){this.t.note('Could not open experiment: '+e.message);this.t.quietly(()=>this.t.artifact.open(false,false));this.closed=key;this.updateReopen();}
   finally{if(this.mounting===key)this.mounting=null;}
  })();return this.mountPromise;
 }
 applyActions(t){const seen=this.seen.get(t.id)||new Set();for(const m of t.messages||[]){if(!seen.has(m.id)&&m.experiment_action&&this.shell){if(this.shell.apply(m.experiment_action)===false){this.rejected.add(m.id);try{localStorage.setItem('kinema.experimentRejectedActions',JSON.stringify([...this.rejected].slice(-128)));}catch{}this.remember(t,this.shell.snapshot());}}if(this.rejected.has(m.id))this.t.el.stream.querySelector(`.amsg[data-mid="${CSS.escape(String(m.id))}"] .exp-action-chip`)?.remove();seen.add(m.id);}this.seen.set(t.id,seen);}
 visualChanged(open){this.splitter.queue();if(!open&&!this.mounting&&this.t.thread?.mode==='experiment')this.closed=this.t.thread.id+':'+this.t.thread.experiment.id;this.updateReopen();}
 updateReopen(){for(const b of this.t.el.stream.querySelectorAll('.exp-reopen'))b.hidden=this.t.artifact.opened;}
 back(){this.t.closeDrawer();this.t.openPage('experiments');}
}
