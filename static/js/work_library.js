import {esc} from './md.js';

const key='kinema.library.work';
const reference=r=>r.kind+':'+r.id;
export const validUndo = r => !!r && ['chat','saved'].includes(r.kind) && typeof r.id==='string' && r.id.length>0 && r.id.length<=120 && typeof r.title==='string';
export function workCard(r) {
  return `<article class="wl-card" data-work-item="${esc(reference(r))}">
    ${r.crop ? `<button type="button" class="wl-image" data-work-action="image" data-ref="${esc(reference(r))}" aria-label="Enlarge ${esc(r.title)}"><img src="${esc(r.crop)}" alt="Problem photograph" loading="lazy"></button>` : ''}
    <div class="wl-copy"><h3>${esc(r.title)}</h3>${r.preview ? `<p>${esc(r.preview)}</p>` : ''}<small>${esc([r.number && (r.verified ? 'Morin ' : 'Mentions ')+r.number,new Date(r.created_ts*1000).toLocaleDateString([], {month:'short',day:'numeric'})].filter(Boolean).join(' · '))}</small></div>
    <div class="wl-actions"><button type="button" data-work-action="open" data-ref="${esc(reference(r))}">Open</button>
    ${!r.saved ? `<button type="button" data-work-action="save" data-ref="${esc(reference(r))}">Save</button>` : ''}
    <button type="button" data-folder-action="add" data-folder-kind="${esc(r.kind)}" data-folder-id="${esc(r.id)}" data-folder-title="${esc(r.title)}">Folder</button>
    <button type="button" data-work-action="remove" data-ref="${esc(reference(r))}" aria-label="Remove ${esc(r.title)} from My work">Remove</button></div></article>`;
}

export class WorkLibrary {
  constructor(host,deps) {
    this.host=host; this.d=deps; this.view='saved'; this.query=''; this.seq=0; this.undo=[]; this.busy=new Set();
    try { const state=JSON.parse(sessionStorage.getItem(key)||'{}');
      if(['saved','recent'].includes(state.view)) this.view=state.view;
      this.undo=(Array.isArray(state.undo)?state.undo:[]).filter(validUndo).slice(0,20);
    } catch {}
    if(!document.querySelector('link[data-work-library-style]')) {
      const link=document.createElement('link'); link.rel='stylesheet'; link.dataset.workLibraryStyle='1';
      link.href=new URL('../work_library.css',import.meta.url).href; document.head.append(link);
    }
    host.innerHTML=`<div class="wl-toolbar"><nav aria-label="My work views"><button type="button" data-work-view="saved">Saved</button><button type="button" data-work-view="recent">Recent</button></nav>
      <label class="wl-search"><span class="wl-sr">Search My work</span><input type="search" id="libsearch" placeholder="Search problems" aria-label="Search My work" maxlength="200"></label></div>
      <div class="wl-undo" aria-live="polite"></div><p class="wl-error" role="alert" hidden></p><button type="button" class="wl-retry" data-work-action="retry" hidden>Try again</button>
      <p class="wl-result-status wl-empty" role="status" hidden></p><div class="wl-items" id="liblist"></div>`;
    host.addEventListener('click',e=>this.click(e));
    host.querySelector('input').addEventListener('input',e=>{
      this.query=e.target.value; ++this.seq; clearTimeout(this.timer);
      this.timer=setTimeout(()=>this.enter(),180);
    });
    this.renderUndo();
  }
  store() { try {sessionStorage.setItem(key,JSON.stringify({view:this.view,undo:this.undo}));} catch {} }
  request(path='',method='GET',body) {
    return this.d.api(this.d.url('/api/library/work'+path),{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  }
  error(message='') {const box=this.host.querySelector('.wl-error');box.textContent=message;box.hidden=!message;}
  renderUndo() {
    this.host.querySelector('.wl-undo').innerHTML=this.undo.map(r=>`<div><span>${r.confirmed?'Removed':'Removal requested'}: ${esc(r.title)}</span><button type="button" data-work-action="undo" data-ref="${esc(reference(r))}">Undo</button></div>`).join('');
  }
  previousResults(updating=false) {
    const box=this.host.querySelector('.wl-result-status'), previous=this.result;
    box.hidden=!previous;
    box.textContent=previous?`Showing previous ${previous.view==='saved'?'Saved':'Recent'} results${previous.query?' for “'+previous.query+'”':''}.${updating?' Updating…':''}`:'';
  }
  async enter() {
    clearTimeout(this.timer); const seq=++this.seq, view=this.view, query=this.query;
    this.host.querySelectorAll('[data-work-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.workView===view?'page':'false'));
    const list=this.host.querySelector('.wl-items');list.setAttribute('aria-busy','true');this.error();
    const retry=this.host.querySelector('.wl-retry');retry.hidden=true;this.previousResults(true);
    if(!this.rows)list.innerHTML='<p class="wl-empty" role="status">Loading your work…</p>';
    try {
      const data=await this.request('?view='+view+'&q='+encodeURIComponent(query));
      if(seq!==this.seq || !this.host.isConnected)return;
      this.rows=data.items||[];
      this.result={view,query};
      this.host.querySelectorAll('[data-work-view]').forEach(b=>{
        const label=b.dataset.workView==='saved'?'Saved':'Recent';
        b.textContent=label+' ('+(data.counts?.[b.dataset.workView]||0)+')';
      });
      list.innerHTML=this.rows.length?this.rows.map(r=>workCard({...r,crop:r.crop?this.d.url(r.crop):''})).join(''):
        `<p class="wl-empty">${query?'No problems match your search.':view==='saved'?'Problems you save or work through appear here. Look in Recent to save a problem.':'Typed problems and problem photos from your chats appear here.'}</p>`;
      const status=this.host.querySelector('.wl-result-status');status.textContent='';status.hidden=true;
      if(data.warning){this.error(data.warning);retry.hidden=false;}
    } catch(e) {if(seq===this.seq && this.host.isConnected){
      if(!this.result)list.innerHTML='';
      this.previousResults();retry.hidden=false;
      this.error('Could not '+(this.result?'refresh':'load')+' your work: '+e.message);
    }}
    finally {if(seq===this.seq)list.removeAttribute('aria-busy');}
  }
  async change(action,item) {
    const id=reference(item); if(this.busy.has(id))return;
    this.busy.add(id);this.error();
    this.host.querySelectorAll('[data-ref]').forEach(b=>{if(b.dataset.ref===id)b.disabled=true;});
    try {
      if(action==='save') await this.d.api(this.d.url('/api/library/problems/'+encodeURIComponent(item.id)+'/keep?on=true'),{method:'POST'});
      else {
        if(action==='remove') {
          this.undo=[{kind:item.kind,id:item.id,title:item.title,confirmed:false},...this.undo.filter(r=>reference(r)!==id)].slice(0,20);
          this.store();this.renderUndo();
        }
        await this.request('/'+item.kind+'/'+encodeURIComponent(item.id)+'/visibility','POST',{hidden:action==='remove'});
        if(action==='undo')this.undo=this.undo.filter(r=>reference(r)!==id);
        else {const entry=this.undo.find(r=>reference(r)===id);if(entry)entry.confirmed=true;}
        this.store();this.renderUndo();
      }
      await this.enter();
    } catch(e) {this.error('Could not confirm '+(action==='undo'?'restore':action==='save'?'save':'removal')+': '+e.message);}
    finally {
      this.busy.delete(id);
      this.host.querySelectorAll('[data-ref]').forEach(b=>{if(b.dataset.ref===id)b.disabled=false;});
    }
  }
  click(e) {
    const view=e.target.closest('[data-work-view]');
    if(view){this.view=view.dataset.workView;this.store();this.enter();return;}
    const button=e.target.closest('[data-work-action]');if(!button)return;
    const action=button.dataset.workAction;
    if(action==='retry')return this.enter();
    const item=(action==='undo'?this.undo:this.rows||[]).find(r=>reference(r)===button.dataset.ref);
    if(!item)return;
    if(action==='open'){this.d.open(item);return;}
    if(action==='image'){this.d.image(this.d.url(item.crop),item.title);return;}
    if(['remove','undo','save'].includes(action))this.change(action,item);
  }
  destroy(){++this.seq;clearTimeout(this.timer);}
}
