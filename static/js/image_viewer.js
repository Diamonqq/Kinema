/* Read-only image inspection. Viewing never opens an edit workflow. */
(() => {
  'use strict';
  const box = document.getElementById('lightbox');
  const img = document.getElementById('lbimg');
  const stage = document.getElementById('lb-stage');
  const label = document.getElementById('lb-scale');
  const closeButton = box.querySelector('[data-image-close]');
  const MAX_SCALE = 8;
  // `view` is what is painted; `goal` is where zoom is heading. The wheel and buttons move the
  // goal and the view eases toward it, so zoom glides instead of jumping. Dragging moves both.
  const view = {scale: 1, x: 0, y: 0}, goal = {scale: 1, x: 0, y: 0};
  let previousFocus = null, drag = null, fade = null, motionEpoch = 0, frame = 0, lastFrame = 0, settleTimer = 0, clickZoomAt = 0;
  let gallery = [], galleryIndex = 0, returnFocus = null;
  const pointers=new Map();let pinch=null,suppressClick=false;
  const galleryControls=document.createElement('div');galleryControls.className='lb-gallery';galleryControls.hidden=true;
  galleryControls.innerHTML='<button type="button" data-image-prev aria-label="Previous image"><svg viewBox="0 0 20 20"><path d="m12 4-6 6 6 6"/></svg></button><span class="lb-count" role="status"></span><button type="button" data-image-next aria-label="Next image"><svg viewBox="0 0 20 20"><path d="m8 4 6 6-6 6"/></svg></button>';
  box.querySelector('.lbtools').prepend(galleryControls);box.querySelector('.lbtools').setAttribute('aria-label','Image controls');
  const previous=galleryControls.querySelector('[data-image-prev]'),next=galleryControls.querySelector('[data-image-next]'),count=galleryControls.querySelector('.lb-count');
  const visible = () => !box.hidden;
  // Draft uploads use local object URLs; only this page's origin is accepted.
  const sourceURL=url=>{try{const value=new URL(url,location.href);return ['http:','https:'].includes(value.protocol)||(value.protocol==='blob:'&&value.origin===location.origin)?value.href:null;}catch{return null;}};
  const reducedMotion = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
  function reset(){
    cancelAnimationFrame(frame);frame=0;
    Object.assign(view,{scale:1,x:0,y:0});Object.assign(goal,view);
  }
  function showImage(source,name){
    document.getElementById('lbname').textContent=name||'Image';img.alt=name||'Viewed image';
    box.classList.remove('image-error','image-ready','is-dragging');reset();drag=null;pointers.clear();pinch=null;suppressClick=false;
    galleryControls.hidden=gallery.length<2;previous.disabled=galleryIndex===0;next.disabled=galleryIndex===gallery.length-1;
    if(document.activeElement===next&&next.disabled)previous.focus({preventScroll:true});else if(document.activeElement===previous&&previous.disabled)next.focus({preventScroll:true});
    count.textContent=(galleryIndex+1)+' / '+gallery.length;paint();img.src=source;
  }
  function stepImage(delta){if(!visible()||gallery.length<2)return;const at=galleryIndex+delta;if(at<0||at>=gallery.length)return;galleryIndex=at;const item=gallery[at];showImage(sourceURL(item.source?.url)||item.url,item.name);}
  previous.addEventListener('click',()=>stepImage(-1));next.addEventListener('click',()=>stepImage(1));
  // Keep the image covering the stage once it is larger than it, per axis.
  function clamp(state){
    const limitX = Math.max(0, (img.offsetWidth * state.scale - stage.clientWidth) / 2);
    const limitY = Math.max(0, (img.offsetHeight * state.scale - stage.clientHeight) / 2);
    state.x = Math.min(limitX, Math.max(-limitX, state.x));
    state.y = Math.min(limitY, Math.max(-limitY, state.y));
  }
  function paint() {
    // Book crops should fit the available stage, even when their source is smaller.
    if(img.naturalWidth&&img.naturalHeight){const fit=Math.min(stage.clientWidth/img.naturalWidth,stage.clientHeight/img.naturalHeight);img.style.width=(img.naturalWidth*fit)+'px';img.style.height=(img.naturalHeight*fit)+'px';}
    clamp(goal);clamp(view);
    img.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.scale})`;
    const fitted = goal.scale <= 1.001;
    label.textContent = fitted ? 'Fit' : `${Math.round(goal.scale * 100)}%`;
    label.setAttribute('aria-label', fitted ? 'Image fitted to view' : 'Fit image to view');
    box.classList.toggle('is-zoomed', goal.scale > 1.001);
    box.querySelector('[data-image-zoom="out"]').disabled = fitted || !img.naturalWidth;
    box.querySelector('[data-image-zoom="in"]').disabled = goal.scale >= MAX_SCALE - 0.001 || !img.naturalWidth;
  }
  // While moving, the browser keeps the image on its own layer; once still it is repainted sharp.
  function moving(){
    img.style.willChange='transform';clearTimeout(settleTimer);
    settleTimer=setTimeout(()=>{img.style.willChange='';},160);
  }
  function tick(now){
    const dt=Math.min(64,now-(lastFrame||now));lastFrame=now;
    const k=1-Math.exp(-dt/55);
    for(const key of ['scale','x','y'])view[key]+=(goal[key]-view[key])*k;
    const done=Math.abs(goal.scale-view.scale)<0.0015&&Math.abs(goal.x-view.x)<0.25&&Math.abs(goal.y-view.y)<0.25;
    if(done)Object.assign(view,goal);
    paint();moving();
    frame=done?0:requestAnimationFrame(tick);
  }
  function animate(){
    if(reducedMotion()){Object.assign(view,goal);paint();return;}
    if(!frame){lastFrame=0;frame=requestAnimationFrame(tick);}
  }
  function zoom(value,clientX,clientY,{instant=false}={}) {
    if(!img.naturalWidth)return;
    const rect=stage.getBoundingClientRect(),px=(clientX??(rect.left+rect.width/2))-rect.left-rect.width/2,py=(clientY??(rect.top+rect.height/2))-rect.top-rect.height/2;
    const target=Math.max(1,Math.min(MAX_SCALE,value)),ratio=target/goal.scale;
    // The point under the cursor stays under the cursor.
    goal.x=px-(px-goal.x)*ratio;goal.y=py-(py-goal.y)*ratio;goal.scale=target;
    if(target<=1){goal.x=0;goal.y=0;}
    clamp(goal);
    if(instant){cancelAnimationFrame(frame);frame=0;Object.assign(view,goal);paint();moving();return;}
    paint();animate();
  }
  function finishClose(epoch){
    if(epoch!==motionEpoch)return;
    box.hidden = true;fade?.cancel();fade=null;
    document.body.classList.remove('lbopen');
    for (const e of document.querySelectorAll('[data-image-inert]')) {
      e.inert = false; e.removeAttribute('data-image-inert');
    }
    img.removeAttribute('src');reset();
    drag = null;pointers.clear();pinch=null;gallery=[];galleryControls.hidden=true; box.classList.remove('is-dragging');
    const focusTarget=previousFocus?.isConnected?previousFocus:returnFocus?.();
    if(focusTarget?.isConnected)focusTarget.focus({preventScroll:true});
    previousFocus=null;returnFocus=null;
  }
  function close() {
    if (!visible()) return;
    const epoch=++motionEpoch;fade?.cancel();
    if(reducedMotion()){finishClose(epoch);return;}
    fade=box.animate([{opacity:getComputedStyle(box).opacity},{opacity:0}],{duration:160,easing:'ease-out',fill:'forwards'});
    fade.finished.then(()=>finishClose(epoch)).catch(()=>{});
  }
  function open(url, name, options={}) {
    // HTML/script/data URLs stay inert; same-origin local image previews are supported.
    const source=sourceURL(url);if(!source)return;
    if (!visible()) previousFocus = document.activeElement;
    returnFocus=typeof options.returnFocus==='function'?options.returnFocus:null;
    ++motionEpoch;fade?.cancel();fade=null;
    gallery=[];const seen=new Set();for(const item of options.images||[]){const url=sourceURL(item?.url);if(url&&!seen.has(url)){seen.add(url);gallery.push({url,name:item.name||'Image',source:item});}}
    galleryIndex=gallery.findIndex(item=>item.url===source);if(galleryIndex<0){gallery=[{url:source,name}];galleryIndex=0;}
    box.hidden = false;
    if(!reducedMotion())fade=box.animate([{opacity:0},{opacity:1}],{duration:200,easing:'ease-out'});
    document.body.classList.add('lbopen');
    // The dialog lives at body level so the rest of the interface can be inert.
    for (const e of document.body.children) {
      if (e !== box && !e.inert && !['SCRIPT','STYLE','LINK'].includes(e.tagName)) {
        e.inert = true; e.setAttribute('data-image-inert', '');
      }
    }
    paint();
    showImage(source,name);
    closeButton.focus({preventScroll:true});
  }
  img.addEventListener('load', () => { box.classList.remove('image-error');box.classList.add('image-ready'); paint(); });
  img.addEventListener('error', () => { if (visible()) { box.classList.add('image-error'); paint(); } });
  img.addEventListener('dragstart', e => e.preventDefault());
  closeButton.addEventListener('click', close);
  box.querySelector('[data-image-retry]').addEventListener('click',()=>{const url=new URL(img.src);url.searchParams.set('retry',Date.now());box.classList.remove('image-error','image-ready');img.src=url.href;});
  label.addEventListener('click', () => zoom(1));
  box.querySelector('[data-image-zoom="in"]').addEventListener('click', () => zoom(goal.scale * 1.5));
  box.querySelector('[data-image-zoom="out"]').addEventListener('click', () => zoom(goal.scale / 1.5));
  stage.addEventListener('click',e=>{if(suppressClick){suppressClick=false;return;}if(e.target===img&&goal.scale<=1.001){clickZoomAt=performance.now();zoom(2.5,e.clientX,e.clientY);}});
  // Double-click returns a zoomed image to fit (the first click of a double-click on a fitted image zooms in).
  stage.addEventListener('dblclick',e=>{e.preventDefault();if(performance.now()-clickZoomAt<450)return;if(goal.scale>1.001)zoom(1);else zoom(2.5,e.clientX,e.clientY);});
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?stage.clientHeight:1);
    // A trackpad pinch arrives as a ctrl+wheel with small deltas; a mouse notch is about 100.
    const factor=e.ctrlKey?Math.exp(-Math.max(-60,Math.min(60,delta))*.012):Math.exp(-Math.max(-240,Math.min(240,delta))*.0022);
    zoom(goal.scale*factor,e.clientX,e.clientY);
  }, {passive:false});
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    suppressClick=false;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2){const [a,b]=[...pointers.values()];cancelAnimationFrame(frame);frame=0;Object.assign(view,goal);pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),scale:goal.scale,x:goal.x,y:goal.y,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2};drag=null;suppressClick=true;}
    if(goal.scale<=1.001&&e.pointerType!=='touch')return;
    if(pinch){stage.setPointerCapture(e.pointerId);e.preventDefault();return;}
    // Dragging follows the pointer exactly: stop any glide and start from what is on screen.
    cancelAnimationFrame(frame);frame=0;Object.assign(goal,view);
    drag = {id:e.pointerId, px:e.clientX, py:e.clientY, x:view.x, y:view.y};
    stage.setPointerCapture(e.pointerId); box.classList.add('is-dragging'); e.preventDefault();
  });
  stage.addEventListener('pointermove', e => {
    if(pointers.has(e.pointerId))pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch&&pointers.size===2){
      const [a,b]=[...pointers.values()],cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
      Object.assign(goal,{scale:pinch.scale,x:pinch.x,y:pinch.y});
      zoom(pinch.scale*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance),pinch.cx,pinch.cy,{instant:true});
      goal.x+=cx-pinch.cx;goal.y+=cy-pinch.cy;Object.assign(view,goal);paint();return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    if(Math.hypot(e.clientX-drag.px,e.clientY-drag.py)>3)suppressClick=true;
    goal.x = drag.x + e.clientX - drag.px; goal.y = drag.y + e.clientY - drag.py;
    clamp(goal);Object.assign(view,goal);paint();moving();
  });
  function release(e) { if(e.type==='pointerup'&&e.pointerType==='touch'&&drag&&!suppressClick&&goal.scale<=1.001){zoom(2.5,e.clientX,e.clientY);suppressClick=true;}pointers.delete(e.pointerId);if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);pinch=null;drag=null;box.classList.remove('is-dragging'); }
  stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release);
  box.addEventListener('click', e => { if (e.target === box || (e.target === stage && goal.scale <= 1.001)) close(); });
  window.addEventListener('keydown', e => {
    if(!visible())return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();e.stopPropagation();stepImage(e.key==='ArrowRight'?1:-1);}
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(goal.scale * 1.5); }
    else if (e.key === '-') { e.preventDefault(); zoom(goal.scale / 1.5); }
    else if (e.key === '0') { e.preventDefault(); zoom(1); }
    else if (e.key === 'Tab') {
      const buttons = [...box.querySelectorAll('button:not(:disabled)')].filter(button=>button.getClientRects().length);
      if (e.shiftKey && (document.activeElement === buttons[0]||!box.contains(document.activeElement))) { e.preventDefault(); buttons.at(-1).focus(); }
      else if (!e.shiftKey && (document.activeElement === buttons.at(-1)||!box.contains(document.activeElement))) { e.preventDefault(); buttons[0].focus(); }
    }
  },true);
  new ResizeObserver(() => { if (visible()) paint(); }).observe(stage);
  document.addEventListener('keydown', e => {
    if (!visible() && (e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-panel-image]')) {
      e.preventDefault(); e.target.click();
    }
  });
  document.body.append(box);
  window.KinemaImageViewer = {open, close, state: () => ({scale: goal.scale, x: goal.x, y: goal.y, shown: {...view}})};
})();
