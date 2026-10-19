import { esc } from './md.js';
import { controlIcon } from './icons.js';
export const zoomGlyph = plus => '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5M7 10h6'+(plus?'M10 7v6':'')+'"/></svg>';
export const nextView = (views, current) => views.length ? views[(views.indexOf(current)+1)%views.length] : null;
export function labelView(button, current, next) {
 button.innerHTML=esc(current)+' '+controlIcon('reset');button.title='Next view: '+next;
 button.setAttribute('aria-label','View: '+current+'. Next: '+next);
}
// Shared inline sizing and compact, discoverable camera controls.
export function bindVisualResize(host, key, opts = {}) {
  if (!host) return; if(host._visualSize){host._visualSize();return;}
  const grip = document.createElement('button');
  grip.type = 'button'; grip.className = 'visual-grip';
  grip.setAttribute('role', 'separator'); grip.setAttribute('aria-orientation', 'horizontal');
  grip.setAttribute('aria-label', 'Resize simulation'); grip.title = 'Drag to resize · double-click to reset';
  host.append(grip); host.classList.add('visual-resizable');
  const base = () => { const value = Number(opts.ratio?.() ?? .38); return Number.isFinite(value) && value > 0 ? value : .38; };
  let stored; try { stored = Number(localStorage.getItem(key)); } catch {}
  let manual = Number.isFinite(stored) && stored > 0;
  let ratio = manual ? stored : base(), start, height;
  const apply = (persist = false) => {
    if (!manual) ratio = base();
    const min = Number(host.dataset.visualMin)||260,max = Math.max(min, Math.min(700, innerHeight * .65));
    height = Math.max(min, Math.min(max, innerHeight * ratio));
    host.style.setProperty('--visual-height', height + 'px');
    grip.setAttribute('aria-valuemin', String(min)); grip.setAttribute('aria-valuemax', String(Math.round(max)));
    grip.setAttribute('aria-valuenow', String(Math.round(height)));
    if (persist) try { localStorage.setItem(key, String(ratio)); } catch {}
  };
  grip.onpointerdown = e => { if (e.button !== 0) return; e.preventDefault(); start = { y:e.clientY, height }; grip.setPointerCapture(e.pointerId); };
  grip.onpointermove = e => { if (!grip.hasPointerCapture(e.pointerId)) return; manual = true; ratio = Math.max(260, Math.min(innerHeight * .65, start.height + e.clientY - start.y)) / innerHeight; apply(); };
  const end = e => { if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId); apply(manual); };
  grip.onpointerup = end; grip.onpointercancel = end;
  const reset = () => { manual = false; try { localStorage.removeItem(key); } catch {} apply(); };
  grip.ondblclick = reset;
  grip.onkeydown = e => { if (!['ArrowUp','ArrowDown','Home'].includes(e.key)) return; e.preventDefault(); if (e.key === 'Home') return reset(); manual = true; ratio = (height + (e.key === 'ArrowUp' ? -24 : 24)) / innerHeight; apply(true); };
  host._visualSize=()=>apply();
  const ro = new ResizeObserver(()=>apply()); ro.observe(document.documentElement);
  const cleanup = new MutationObserver(() => { if (!host.isConnected) { ro.disconnect(); cleanup.disconnect(); } });
  cleanup.observe(document.body, {childList:true,subtree:true}); apply();
}

export function preparedChrome(wrap) {
  const q=s=>wrap.querySelector(s),bottom=document.createElement('div');bottom.className='dv-bottom';
  const tools=document.createElement('div');tools.className='dv-tools';
  q('.dv-zoom-in').innerHTML=zoomGlyph(true);q('.dv-zoom-out').innerHTML=zoomGlyph(false);
  const zoom=document.createElement('div');zoom.className='viewer-zoom';zoom.setAttribute('role','group');zoom.setAttribute('aria-label','Zoom');zoom.append(q('.dv-zoom-out'),q('.dv-zoom-in'));
  const pan=q('.dv-pan');pan.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/></svg>';pan.title='Pan the view';pan.setAttribute('aria-label','Pan the view');
  tools.append(q('.dv-force'),q('.dv-views'),zoom,q('.dv-fit'),pan);bottom.append(q('.dv-ctrl'),tools);wrap.append(bottom);
  const camera=q('.dv-camera');camera.classList.add('dv-secondary-camera');
  camera.querySelector('.dv-seg')?.remove();camera.querySelector('.dv-gesture').hidden=true;
  bottom.before(camera);
}
