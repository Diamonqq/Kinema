// Retain the native select as the value/event authority, with a consistent choice panel.
import {esc} from './md.js';
const selector = '#settings select,.kinema-language-dialog select,.kp-dialog select,.account-dialog select,.ka-dialog select,.kw-screen select,.tv-dialog select,.dv select,.lpulse select,.library-views select,.book-browser select,.vl select,.sim-lab select';
const link=document.createElement('link');link.rel='stylesheet';link.href='/ui_controls.css';document.head.append(link);
let active=null;
function close(focus=false){if(!active)return;const {panel,button}=active;active=null;panel.remove();button.setAttribute('aria-expanded','false');if(focus&&button.isConnected)button.focus();}
function sync(s){
 const b=s._choiceButton;if(!b)return;
 // The native's class deliberately hides it. Read authored inline visibility and
 // ancestor visibility without confusing that presentation class with owner intent.
 const hidden=s.hidden||s.style.display==='none'||s.style.visibility==='hidden'||s.style.visibility==='collapse';
 if(b.disabled!==s.disabled)b.disabled=s.disabled;
 if(b.hidden!==hidden)b.hidden=hidden;
 const visibility=s.style.visibility||'';if(b.style.visibility!==visibility)b.style.visibility=visibility;
 const label=s.selectedOptions[0]?.textContent||'Choose';if(b.querySelector('span').textContent!==label)b.querySelector('span').textContent=label;
 const aria=s.getAttribute('aria-label')||'Choose';if(b.getAttribute('aria-label')!==aria)b.setAttribute('aria-label',aria);
 if(active?.select===s&&(hidden||s.disabled||!s.isConnected||b.getClientRects().length===0||getComputedStyle(b).visibility!=='visible'))close();
}
function open(s,b){
 close();sync(s);const panel=document.createElement('div');panel.className='choice-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',s.getAttribute('aria-label')||'Choose an option');
 const rows=[...s.options];panel.innerHTML=(rows.length>8?'<input type="search" aria-label="Search choices" placeholder="Search…" autocomplete="off">':'')+'<div class="choice-options" role="listbox"></div>';
 // A modal dialog's top layer must also contain its choice panel.
 (b.closest('dialog[open]')||document.body).append(panel);active={panel,button:b,select:s};b.setAttribute('aria-expanded','true');
 const paint=()=>{const query=(panel.querySelector('input')?.value||'').toLocaleLowerCase();panel.querySelector('.choice-options').innerHTML=rows.filter(o=>o.textContent.toLocaleLowerCase().includes(query)).map(o=>`<button type="button" role="option" aria-selected="${o.selected}" data-choice="${esc(o.value)}" ${o.disabled?'disabled':''}><span>${esc(o.textContent)}</span>${o.selected?'<span aria-hidden="true">✓</span>':''}</button>`).join('')||'<p>No matches</p>';};paint();
 const r=b.getBoundingClientRect(),w=Math.min(340,innerWidth-20,Math.max(250,r.width));panel.style.width=w+'px';panel.style.left=Math.max(10,Math.min(innerWidth-w-10,r.left))+'px';
 const room=innerHeight-r.bottom-12;panel.style.maxHeight=Math.min(380,innerHeight-24)+'px';if(room>=180){panel.style.top=(r.bottom+6)+'px';panel.style.maxHeight=Math.min(380,room)+'px';}else panel.style.bottom=Math.max(12,innerHeight-r.top+6)+'px';
 panel.oninput=paint;
 panel.onclick=e=>{const item=e.target.closest('[data-choice]');if(!item||item.disabled)return;s.value=item.dataset.choice;sync(s);close(true);s.dispatchEvent(new Event('change',{bubbles:true}));};
 panel.onkeydown=e=>{const items=[...panel.querySelectorAll('[role=option]:not(:disabled)')],i=items.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:items.length-1))%items.length;items[n]?.focus();}};
 (panel.querySelector('input')||panel.querySelector('[aria-selected=true]')||panel.querySelector('button'))?.focus();
}
function enhance(){
 if(active&&(!active.button.isConnected||!active.select.isConnected))close();
 for(const b of document.querySelectorAll('.choice-trigger')){
  const s=b._choiceSelect;
  if(!s)continue;
  if(!s.isConnected||!s.matches(selector)){
   if(active?.button===b)close();b.remove();s._choiceButton=null;s.classList.remove('choice-native');
   for(const [attr,value] of Object.entries(s._choiceOriginal||{})){if(value===null)s.removeAttribute(attr);else s.setAttribute(attr,value);}
  }
 }
 for(const s of document.querySelectorAll(selector)){
  if(s._choiceButton&&!s._choiceButton.isConnected)s._choiceButton=null;
  if(!s._choiceButton){const b=document.createElement('button');b.type='button';b.className='choice-trigger';b.innerHTML='<span></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';b.setAttribute('aria-label',s.getAttribute('aria-label')||'Choose');b.setAttribute('aria-haspopup','listbox');b.setAttribute('aria-expanded','false');
   s._choiceOriginal||={'tabindex':s.getAttribute('tabindex'),'aria-hidden':s.getAttribute('aria-hidden')};s.classList.add('choice-native');s.tabIndex=-1;s.setAttribute('aria-hidden','true');s.after(b);s._choiceButton=b;b._choiceSelect=s;b.onclick=()=>active?.button===b?close():open(s,b);b.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open(s,b)}};if(!s._choiceListening){s.addEventListener('change',()=>sync(s));s._choiceListening=true;}
  }else if(s.nextElementSibling!==s._choiceButton){if(active?.select===s)close();s.after(s._choiceButton);}sync(s);
 }
}
let scheduled=false;new MutationObserver(records=>{
 // Ignore writes to our buttons/panel. This keeps style/hidden synchronization
 // idempotent and prevents observer feedback while still following native changes.
 if(!records.some(r=>r.type==='childList'||!r.target.closest?.('.choice-trigger,.choice-panel')))return;
 if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;enhance()})}
}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','disabled','style','class','selected','label','aria-label']});
document.addEventListener('pointerdown',e=>{if(active&&!active.panel.contains(e.target)&&!active.button.contains(e.target))close()},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active){e.preventDefault();e.stopImmediatePropagation();close(true)}},true);
addEventListener('resize',()=>close());enhance();
