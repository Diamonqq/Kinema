import {esc} from './md.js';

// The shared native renderer remains the sole renderer for mapped library lessons.
export class ReaderVisual {
 constructor(t){this.t=t;this.seq=0;this.saved=new Map()}
 remember(){if(!this.key)return;const state=this.handle?.state||(this.kind==='recipe'&&this.t.stage.owner()===this.owner?this.t.stage.state():null);if(!state)return;this.saved.set(this.key,state);try{localStorage.setItem('kinema.reader.visual.'+this.key,JSON.stringify(state))}catch{}}
 park(){if(this.kind==='recipe')this.t.artifact.parkInline()}
 leave(){++this.seq;this.remember();this.handle?.destroy();this.handle=null;this.host?.remove();this.host=null;if(this.kind==='recipe')this.t.quietly(()=>{this.t.artifact.open(false,false);this.t.artifact.mountInline(null)});this.key=null;this.kind=null;this.failed=false}
 async sync(section,slot,{open=true}={}){
  const d=section?.reader_visual,key=section?.id+':'+(d?.id||'none');
  if(!d||!slot)return this.leave();
  if(this.key===key){if(this.failed)return;if(this.kind==='recipe'&&this.t.stage.owner()===this.owner){const a=this.t.artifact,moved=a.inlineSlot!==slot||a.pane?.parentElement!==slot,changed=a.opened!==open;this.t.quietly(()=>{if(moved)a.mountInline(slot);if(changed||moved)a.open(open,false)});if(open&&(moved||changed))requestAnimationFrame(()=>this.t.stage.refit?.())}else if(this.handle){if(this.host.parentElement!==slot)slot.append(this.host);if(!open)this.handle.pause?.();this.handle.resize?.()}return}
  this.leave();this.key=key;this.kind=d.kind;this.owner='reader:'+key;
  if(!this.saved.has(key))try{const state=JSON.parse(localStorage.getItem('kinema.reader.visual.'+key));if(state)this.saved.set(key,state)}catch{}
  const seq=++this.seq,live=()=>seq===this.seq&&slot.isConnected&&this.t.workspace.active();
  this.host=document.createElement('div');this.host.className='lr-visual-host';this.host.innerHTML='<p role="status">Opening visual…</p>';slot.append(this.host);
  try{
   if(d.kind==='light_pulse'){
    const {mountLightPulse}=await import('./light_pulse.js');if(!live())return;
    this.handle=mountLightPulse(this.host,{saved:this.saved.get(key)});return;
   }
   if(d.kind!=='recipe')throw Error('This lesson has no supported visual.');
   const data=await this.t.d.api(this.t.d.url('/api/visual-library/recipes/'+encodeURIComponent(d.id)));if(!live())return;
   const result=await this.t.stage.load(data.lesson,this.owner,{live,prepared:true,intent:'learn'});if(!live())return;
   if(!result.ok)throw Error(result.error||'The visual could not be drawn.');
   this.t.quietly(()=>{this.t.artifact.configure(result.kind,d.title);this.t.artifact.setStep({kind:'native',title:d.title,caption:d.description});this.t.artifact.mountInline(slot);this.t.artifact.open(open,false)});
   this.host.remove();this.t.stage.libraryControls?.({forces:result.kind==='mechanics',intent:'learn'});
   const saved=this.saved.get(key);if(saved){this.t.stage.apply({...saved,time:saved.t,playing:false});if(typeof saved.forces==='boolean')this.t.stage.forces?.(saved.forces)}
   requestAnimationFrame(()=>{if(live())this.t.stage.refit?.()});
  }catch(e){if(live()){this.failed=true;this.host.innerHTML=`<p role="alert">This visual could not open. ${esc(e.message)}</p><button data-reading="visual-retry">Try again</button>`}}
 }
 setExample(i){this.handle?.setExample?.(i)}
 state(){return this.handle?.state||(this.kind==='recipe'?this.t.stage.state():null)}
}
