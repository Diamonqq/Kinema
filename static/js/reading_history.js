import {esc} from './md.js';

const KEY='kinema.reading.history';
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(KEY+k))||f}catch{return f}};
const write=(k,v)=>{try{localStorage.setItem(KEY+k,JSON.stringify(v));return true}catch{return false}};
export const activeDelta=(from,to,lastActivity,enabled)=>enabled?Math.max(0,Math.min(to,lastActivity+60000)-from):0;
export const readingTime=ms=>ms<60000?'Under 1 min':Math.floor(ms/60000)+' min';

export class ReadingHistory {
 constructor(t){
  this.t=t;this.sections=read('.sections',{});this.pending=read('.pending',{});this.last=performance.now();this.activity=this.last;
  this.foreground=document.visibilityState==='visible'&&document.hasFocus();
  const activity=()=>{this.tick();this.activity=performance.now()};
  for(const e of ['pointerdown','keydown','wheel','touchstart'])t.host.addEventListener(e,activity,{passive:true});
  const visibility=()=>{this.tick();this.foreground=document.visibilityState==='visible'&&document.hasFocus();this.last=this.activity=performance.now();if(!this.foreground)this.flush()};
  window.addEventListener('focus',visibility);window.addEventListener('blur',visibility);document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',()=>{this.tick();this.persist();this.flush(true)});
  t.host.addEventListener('click',e=>{if(e.target.closest('[data-reading-history-retry]')){this.error=false;Object.keys(this.pending).length?this.flush():this.load()}});
  setInterval(()=>{this.tick();if(!this.error)this.flush()},15000);
  this.load();
 }
 persist(){this.storageError=!write('.pending',this.pending);write('.sections',this.sections)}
 tick(now=performance.now()){
  if(this.visit){const delta=activeDelta(this.last,now,this.activity,this.foreground);if(delta){const v=this.pending[this.visit.id]||{...this.visit};v.active_ms=Math.min(86400000,v.active_ms+Math.round(delta));this.visit=v;this.pending[v.id]=v;this.persist()}}
  this.last=now;
 }
 set(section){
  if(this.section===section)return;
  this.tick();this.section=section;this.visit=null;this.last=this.activity=performance.now();
  if(section){this.visit={id:crypto.randomUUID(),section_id:section,active_ms:0,ack_ms:0};this.pending[this.visit.id]=this.visit;this.persist()}
  if(!this.error)this.flush();
 }
 apply(data){
  this.sections=data.sections||{};
  for(const [id,ms] of Object.entries(data.ack||{})){
   const v=this.pending[id];if(!v)continue;v.ack_ms=Math.max(v.ack_ms||0,ms);
   if(this.visit?.id===id)this.visit={...v};
   if(v.active_ms<=ms)delete this.pending[id];
  }
  this.persist();this.paint();
 }
 async load(){
  if(this.saving)return;
  const params=new URLSearchParams();Object.keys(this.pending).slice(0,100).forEach(id=>params.append('pending',id));
  this.saving=true;
  try{this.apply(await this.t.d.api(this.t.d.url('/api/reading-history?'+params)));this.error=false}
  catch{this.error=true}finally{this.saving=false;this.paint();if(!this.error&&Object.keys(this.pending).length)this.flush()}
 }
 async flush(keepalive=false){
  if(this.saving)return;
  const visits=Object.values(this.pending).slice(0,100).map(({id,section_id,active_ms})=>({id,section_id,active_ms}));
  if(!visits.length){this.paint();return}
  this.saving=true;
  try{const response=await fetch(this.t.d.url('/api/reading-history'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visits}),keepalive});if(!response.ok)throw Error('save failed');this.error=false;this.apply(await response.json())}
  catch{this.error=true;this.paint()}
  finally{this.saving=false}
 }
 rows(){
  const rows=structuredClone(this.sections);
  for(const v of Object.values(this.pending)){const r=rows[v.section_id]||={section_id:v.section_id,active_ms:0,last_ts:Date.now()/1000};r.active_ms+=Math.max(0,v.active_ms-(v.ack_ms||0))}
  return rows;
 }
 line(id,chapter=false){
  const rows=Object.values(this.rows()).filter(r=>chapter?r.section_id.split('.')[0]===String(id):r.section_id===id);
  if(!rows.length)return '';
  const total=rows.reduce((s,r)=>s+r.active_ms,0),date=new Date(Math.max(...rows.map(r=>r.last_ts))*1000).toLocaleDateString([],{month:'short',day:'numeric'});
  return `<small class="reading-history">${chapter?rows.length+' lesson'+(rows.length===1?'':'s')+' viewed':'Viewed'} · ${readingTime(total)} · ${esc(date)}</small>`;
 }
 status(){return this.error||this.storageError?'<p class="reading-history-error" role="status">Reading history has not saved yet. <button data-reading-history-retry>Retry save</button></p>':''}
 paint(){
  const box=this.t.el.pathpage;if(this.t.page!=='path'||!box)return;
  for(const node of box.querySelectorAll('[data-reading-record]'))node.innerHTML=this.line(node.dataset.readingRecord,node.dataset.readingChapter==='true');
  const status=box.querySelector('[data-reading-save-status]');if(status)status.innerHTML=this.status();
 }
}
