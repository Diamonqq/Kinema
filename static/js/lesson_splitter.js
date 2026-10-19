// Same interaction as Panel's artifact divider: pointer capture, keyboard and a saved ratio.
export class LessonSplitter {
  constructor(host, pane, options={}) {
    this.host=host;this.pane=pane;this.options=options;this.key=options.key||'kinema.lessonPaneRatio.v2';this.ratio=null;
    try { const n=Number(localStorage.getItem(this.key));if(n>0&&n<1)this.ratio=n; } catch {}
    const grip=this.grip=document.createElement('div');
    grip.className='lr-divider '+(options.className||'');grip.hidden=true;grip.tabIndex=0;
    grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','vertical');
    grip.setAttribute('aria-label',options.label||'Resize lesson pane');grip.title='Drag to resize · arrow keys to adjust · double-click to reset';
    host.append(grip);
    grip.addEventListener('pointerdown',e=>{
      if(e.button!==0||grip.hidden)return;e.preventDefault();grip.focus({preventScroll:true});
      this.drag={id:e.pointerId,x:e.clientX,width:this.width};grip.setPointerCapture(e.pointerId);host.classList.add('lr-resizing');
    });
    grip.addEventListener('pointermove',e=>{if(this.drag?.id===e.pointerId)this.layout(this.drag.width+this.drag.x-e.clientX)});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])grip.addEventListener(name,()=>this.end());
    grip.addEventListener('keydown',e=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();const b=this.bounds();
      this.layout(e.key==='Home'?b.min:e.key==='End'?b.max:this.width+(e.key==='ArrowLeft'?1:-1)*(e.shiftKey?80:24));this.remember();
    });
    grip.addEventListener('dblclick',()=>{this.ratio=null;try{localStorage.removeItem(this.key)}catch{}this.layout()});
    const observer=new ResizeObserver(()=>this.queue());observer.observe(host);observer.observe(pane);
  }
  bounds() {
    const side=this.host.classList.contains('tv-side-open')?this.host.querySelector('.tv-side')?.getBoundingClientRect().width||200:0;
    const available=Math.max(0,this.host.clientWidth-side-8),min=Math.min(360,available/2);
    return {available,min,max:Math.max(min,available-360)};
  }
  queue(){cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>this.layout())}
  layout(value) {
    const on=!this.pane.hidden&&innerWidth>(this.options.breakpoint||800)&&(!this.options.enabled||this.options.enabled());
    this.grip.hidden=!on;
    if(!on){this.end(false);return}
    const b=this.bounds(),desired=value??(this.drag?this.width:b.available*(this.ratio??this.options.defaultRatio??.3));
    const width=Math.round(Math.max(b.min,Math.min(b.max,desired)));
    this.width=width;const css=width+'px';
    if(this.host.style.getPropertyValue(this.options.variable||'--lr-width')!==css)this.host.style.setProperty(this.options.variable||'--lr-width',css);
    this.grip.style.left=(this.pane.offsetLeft-12)+'px';
    for(const [key,n] of Object.entries({min:b.min,max:b.max,now:width}))this.grip.setAttribute('aria-value'+key,String(Math.round(n)));
    this.grip.setAttribute('aria-valuetext',width+' pixels wide');
  }
  remember(){this.ratio=this.width/this.bounds().available;try{localStorage.setItem(this.key,String(this.ratio))}catch{}}
  end(remember=true){
    if(!this.drag)return;const id=this.drag.id;this.drag=null;this.host.classList.remove('lr-resizing');
    if(remember)this.remember();if(this.grip.hasPointerCapture(id))this.grip.releasePointerCapture(id);
  }
}
