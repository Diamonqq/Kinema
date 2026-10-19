import {esc,mdlite,math} from '../md.js';

// Source-specific controls augment the shared apparatus; they never replace its
// forces, body selector, playback or additional physically supported close-ups.
export function chapterNativeControls(host,spec,stage){
 const bar=host.querySelector?.('#library-views');
 if(!bar)return {destroy(){},close(){},get view(){return null},get breakdown(){return false}};
 let current=spec.views?.[0]?.id||'side',on=false,popup=null,anchor=null;
 bar.classList.add('ce-native-controls');
 const aside=host.closest('.lr-visual'),scroll=host.closest('.tv-scroll');
 function resize(){if(!aside)return;aside.dataset.visualMin=innerWidth<=800?'380':'480';const compact=innerWidth<=800&&!aside.classList.contains('lr-expanded');aside.style.minHeight=compact?'0':'';aside.style.maxHeight=compact&&scroll?Math.max(240,scroll.clientHeight-32)+'px':'';aside._visualSize?.()}
 const layoutObserver=new ResizeObserver(resize);if(scroll)layoutObserver.observe(scroll);addEventListener('resize',resize);resize();
 const originalBreakdown=bar.querySelector('[data-library-view=breakdown]');
 const groups=spec.force_load_groups||[];let groupChoice=null;
 function applyLoads(){if(groups.length)stage.forceLoads?.(groups[Number(groupChoice?.value)||0].loads)}
 if(groups.length){groupChoice=document.createElement('select');groupChoice.className='ce-load-group';groupChoice.setAttribute('aria-label','Contact arc');groups.forEach((g,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=g.label;groupChoice.append(o)});groupChoice.addEventListener('change',()=>{stage.pause?.();stage.forces?.(true,{explicit:true});applyLoads()});bar.append(groupChoice);applyLoads()}
 const buttons=[];
 for(const view of spec.views||[]){
  const button=document.createElement('button');button.type='button';button.dataset.chapterView=view.id;
  button.textContent=view.label||view.id;button.setAttribute('aria-pressed',String(view.id===current));
  button.addEventListener('click',()=>setView(view.id));bar.append(button);buttons.push(button);
 }
 // Authored Full setup replaces the generic camera button; retain additional
 // native close-ups (such as spring targets) that the chapter does not duplicate.
 if(buttons.length)bar.querySelector('[data-library-view=hero]')?.remove();
 if(spec.views?.some(v=>v.id==='closeup'))bar.querySelector('[data-library-view="closeup:0"]')?.remove();
 let breakdown=originalBreakdown;
 if(spec.breakdown?.length&&!breakdown){breakdown=document.createElement('button');breakdown.type='button';breakdown.dataset.libraryView='breakdown';breakdown.textContent='Breakdown';bar.prepend(breakdown)}
 function sync(){buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.chapterView===current)));breakdown?.setAttribute('aria-pressed',String(on))}
 function close({focus=false}={}){popup?.remove();popup=null;anchor?.setAttribute('aria-expanded','false');if(focus&&anchor?.isConnected)anchor.focus();anchor=null}
 function position(){if(!popup||!anchor)return;const r=anchor.getBoundingClientRect(),w=Math.min(420,innerWidth-24);popup.style.width=w+'px';const h=Math.min(popup.scrollHeight,innerHeight-24);Object.assign(popup.style,{left:Math.max(12,Math.min(innerWidth-w-12,r.right-w))+'px',top:Math.max(12,Math.min(innerHeight-h-12,r.top-h-8))+'px'})}
 function showNotes(){close();anchor=breakdown;popup=document.createElement('section');popup.className='ce-popup';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Problem breakdown');popup.innerHTML=`<header><b>Breakdown</b><button type="button" aria-label="Close breakdown">Close</button></header><div class="ce-breakdown mdb">${spec.breakdown.map(s=>`<h4>${esc(s.title)}</h4>${mdlite(s.body)}`).join('')}</div>`;document.body.append(popup);popup.querySelector('button').addEventListener('click',()=>close({focus:true}));anchor.setAttribute('aria-expanded','true');math(popup);position();popup.querySelector('button').focus()}
 function setView(id){const v=spec.views?.find(v=>v.id===id);if(!v)return false;current=id;stage.apply?.({camera:v.camera||id,focus:v.focus,playing:false});if(v.target)stage.closeupTarget?.(v.target);sync();return true}
 function references(enabled){if(!spec.native_static||!spec.native_lesson?.visualization?.rigid3d?.references?.length)return;const show=new Set(stage.state?.().show||['labels']);enabled?show.add('references'):show.delete('references');stage.apply?.({show:[...show],playing:false})}
 function click(e){const b=e.target.closest('[data-library-view]');if(!b)return;
  if(b.dataset.libraryView==='breakdown'&&spec.breakdown?.length){e.stopImmediatePropagation();on=!on;stage.pause?.();stage.breakdown?.(on);references(on);if(on){stage.forces?.(true,{explicit:true});const focus=spec.native_lesson?.visualization?.scene?.focus;if(focus&&!stage.state?.().forceBody)stage.forceBody?.(focus);applyLoads();showNotes()}else close();sync()}
  if(b.dataset.libraryView==='reset'){e.stopImmediatePropagation();stage.reset?.();on=false;close();stage.breakdown?.(false);references(false);setView(spec.views?.[0]?.id);if(groupChoice)groupChoice.value='0';applyLoads();sync()}
  else if(b.dataset.libraryView==='hero'||b.dataset.libraryView.startsWith('closeup:')){current=null;sync()}
 }
 const outside=e=>{if(popup&&!popup.contains(e.target)&&e.target!==breakdown&&!breakdown?.contains(e.target))close()},key=e=>{if(popup&&e.key==='Escape'){e.preventDefault();e.stopPropagation();close({focus:true})}};
 bar.addEventListener('click',click,true);document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);addEventListener('resize',position);
 if(spec.native_static)stage.still?.();
 const focus=spec.native_lesson?.visualization?.scene?.focus;
 if(spec.id==='3.11'&&focus)stage.forceBody?.(focus);
 setView(current);
 return {setView,close,get view(){return current},get breakdown(){return on},destroy(){close();groupChoice?.remove();stage.forceLoads?.(null);layoutObserver.disconnect();removeEventListener('resize',resize);if(aside){aside.style.minHeight='';aside.style.maxHeight=''}bar.removeEventListener('click',click,true);document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);removeEventListener('resize',position);buttons.forEach(b=>b.remove());if(breakdown!==originalBreakdown)breakdown?.remove();bar.classList.remove('ce-native-controls')}};
}
