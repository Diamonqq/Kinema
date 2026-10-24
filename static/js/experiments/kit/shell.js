import {prepareCandidate,timelineBatches,SeekController} from './state.js';
import {VectorStage} from './stage.js';
import {LinkedGraph,CustomGraph} from './graphs.js';
import {controlIcon} from '../../icons.js';
import {esc,math} from '../../md.js';

export class ExperimentShell {
 constructor(host,{model,view,manifest={},values={},onChange=()=>{},onBack=null}){
  Object.assign(this,{host,model,view,manifest,onChange});this.seeker=new SeekController();this.params={...Object.fromEntries(model.params.map(p=>[p.key,p.value])),...values};this.playing=false;this.speed=1;this.duration=60;this.closeup='';this.breakdown=false;this.enabledGraphs=new Set();this.samples=[];this.last=0;
  host.classList.add('exp-shell');host.innerHTML=`<div class="exp-tools"><button data-exp="setup" aria-expanded="false">Setup</button><button data-exp="graphs" aria-expanded="false">Graphs</button><button data-exp="breakdown" aria-pressed="false">Breakdown</button></div><div class="exp-setup" hidden></div><div class="exp-scene"><canvas aria-label="${esc(model.title)} interactive apparatus"></canvas><div class="exp-closeups"></div><button class="exp-zoom-back" data-exp="scene" hidden>← Full scene</button><div class="exp-key"></div></div><div class="exp-equation exp-closeup-equation" hidden></div><div class="exp-equations" hidden></div><div class="exp-graph-panel" hidden><p class="exp-graph-status" role="status"></p><div class="exp-graph-choices"></div><div class="exp-graphs"></div></div><p class="exp-note" role="status"></p><div class="exp-transport"><button data-exp="play" aria-label="Play" title="Play">${controlIcon('play')}</button><button data-exp="reset" aria-label="Reset" title="Reset">${controlIcon('reset')}</button><input class="exp-time" type="range" min="0" max="60" step="0.01" value="0" aria-label="Time"><output class="exp-clock">0.00 s</output><select class="exp-speed" aria-label="Playback speed"><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
  const q=s=>host.querySelector(s);this.q=q;this.stage=new VectorStage(q('canvas'));this.setup=q('.exp-setup');this.scene=q('.exp-scene');this.equations=q('.exp-equations');this.graphs=[];
  if(onBack){const back=document.createElement('button');back.className='exp-gallery-back';back.textContent='←';back.setAttribute('aria-label','Back to Experiments');back.title='Back to Experiments';back.onclick=onBack;q('.exp-tools').prepend(back);}
  this.setupHTML();
  try{if(!this.validate(this.params))throw Error('Saved values are outside the allowed range.');this.resetModel();}
  catch(error){this.params=Object.fromEntries(model.params.map(p=>[p.key,p.value]));this.resetModel();this.syncInputs();q('.exp-note').textContent='Saved setup could not open. Defaults restored. '+error.message;}
  this.makeGraphs();this.custom=view.mount?.(this);if(this.custom)q('canvas').hidden=true;
  q('.exp-closeups').innerHTML=(view.closeups||manifest.closeups||[]).map(c=>`<button data-exp="closeup" data-id="${esc(c.id)}">${esc(c.label)}</button>`).join('');
  host.addEventListener('click',this.click=e=>{const b=e.target.closest('[data-exp]');if(!b)return;const a=b.dataset.exp;
   if(a==='play')this.setPlaying(!this.playing);if(a==='reset')this.reset();
   if(a==='setup'){this.setup.hidden=!this.setup.hidden;b.setAttribute('aria-expanded',String(!this.setup.hidden));}
   if(a==='graphs')this.setGraphsOpen(this.q('.exp-graph-panel').hidden);
   if(a==='breakdown')this.setBreakdown(!this.breakdown);
   if(a==='preset'){const p=model.presets.find(p=>p.id===b.dataset.id);if(p&&this.setParams(p.values))q('.exp-note').textContent=p.note||'';}
   if(a==='closeup')this.setCloseup(b.dataset.id);if(a==='scene')this.setCloseup('');
   if(a==='graph'){const id=b.dataset.id;this.enabledGraphs.has(id)?this.enabledGraphs.delete(id):this.enabledGraphs.add(id);this.syncGraphVisibility();this.changed();}
  });
  host.addEventListener('change',this.change=e=>{const key=e.target.dataset.param;if(key){const p=model.params.find(p=>p.key===key);this.setParams({[key]:p.options?p.options.find(o=>String(o.value)===e.target.value)?.value:Number(e.target.value)});}if(e.target.matches('.exp-speed'))this.speed=Number(e.target.value);});
  q('.exp-time').addEventListener('input',()=>{this.setPlaying(false);this.seek(Number(q('.exp-time').value));});
  const canvas=q('canvas');const pointer=e=>{const r=canvas.getBoundingClientRect(),type=e.type.replace('pointer',''),pt={type,x:e.clientX-r.left,y:e.clientY-r.top};if(view.pointer?.(this.stage,this.frame(),pt)){e.preventDefault();if(type==='down')canvas.setPointerCapture(e.pointerId);}if(type==='up'||type==='cancel')if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);};
  for(const event of ['pointerdown','pointermove','pointerup','pointercancel'])canvas.addEventListener(event,pointer);
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.observer.observe(this.scene);this.tick=this.tick.bind(this);this.raf=requestAnimationFrame(this.tick);this.draw();
 }
 setupHTML(){
  const group=new Map();for(const p of this.model.params){if(!group.has(p.group||'Setup'))group.set(p.group||'Setup',[]);group.get(p.group||'Setup').push(p);}
  this.setup.innerHTML=`<div class="exp-presets">${this.model.presets.map(p=>`<button data-exp="preset" data-id="${esc(p.id)}">${esc(p.label)}</button>`).join('')}</div>`+[...group].map(([title,ps])=>`<fieldset><legend>${esc(title)}</legend><div class="exp-params">${ps.map(p=>`<label data-param-row="${esc(p.key)}"><span>${esc(p.label)}${p.unit?` <small>${esc(p.unit)}</small>`:''}</span>${p.options?`<select data-param="${esc(p.key)}">${p.options.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`:`<input data-param="${esc(p.key)}" type="number" min="${p.min}" max="${p.max}" step="${p.step}" value="${this.params[p.key]}">`}</label>`).join('')}</div></fieldset>`).join('');this.syncInputs();
 }
 syncInputs(){for(const p of this.model.params){const input=this.setup.querySelector(`[data-param="${p.key}"]`);if(input){input.value=this.params[p.key];if(p.options)for(const option of input.options)option.hidden=/^mode[AB]$/.test(p.key)&&Number(option.value)>this.params.n;}const row=input?.closest('label');if(row){const m=p.key.match(/^([mkxv])(\d+)$/);row.hidden=this.view.paramVisible?!this.view.paramVisible(p,this.params):!!m&&Number(m[2])>Number(this.params.n)+(m[1]==='k'?1:0);}}for(const group of this.setup.querySelectorAll('fieldset'))group.hidden=![...group.querySelectorAll('[data-param-row]')].some(row=>!row.hidden);}
 validate(patch){if(!patch||typeof patch!=='object'||Array.isArray(patch))return false;return Object.entries(patch).every(([key,val])=>{const p=this.model.params.find(p=>p.key===key);return p&&(p.options?p.options.some(o=>o.value===val):typeof val==='number'&&Number.isFinite(val)&&val>=p.min-1e-10&&val<=p.max+1e-10&&Math.abs((val-p.min)/p.step-Math.round((val-p.min)/p.step))<1e-7);});}
 setParams(patch){
  let candidate;
  try{if(!this.validate(patch))throw Error('Choose a value within the shown range.');candidate=prepareCandidate(this.model,this.params,patch);}
  catch(error){this.q('.exp-note').textContent=error.message||'This setup could not open.';this.syncInputs();return false;}
  this.cancelSeek();this.params=candidate.values;this.instance=candidate.instance;this.setPlaying(false);this.startForecast();this.stage.snap=true;this.q('.exp-note').textContent='';this.syncInputs();this.makeGraphs();this.draw();this.changed();return true;
 }
 resetModel(){this.cancelSeek();this.instance=prepareCandidate(this.model,{},this.params).instance;this.startForecast();this.stage.snap=true;this.q('.exp-note').textContent='';}
 startForecast(){
  const generation=this.forecastGeneration=(this.forecastGeneration||0)+1;clearTimeout(this.forecastTimer);cancelAnimationFrame(this.forecastFrame);
  this.duration=60;this.endTime=null;this.q('.exp-time').max=this.duration;
  this.samples=[this.instance.sample()];this.forecastComplete=false;this.forecastError='';
  this.observeEnd(this.samples[0]);
  const iterator=timelineBatches(this.model,{...this.params},{duration:this.duration,batchSize:8});
  const batch=()=>{
   if(this.destroyed||generation!==this.forecastGeneration)return;
   try{const result=iterator.next();if(result.done){this.forecastComplete=true;this.graphStatus();return;}
    for(const sample of result.value){if(this.samples.at(-1)?.t!==sample.t&&this.samples.length<3601)this.samples.push(sample);if(sample.ended===true){this.observeEnd(sample);this.forecastComplete=true;this.graphStatus();return;}}
    this.graphStatus();this.forecastTimer=setTimeout(batch,0);
   }catch(error){this.forecastError=error.message||'The trajectory stopped.';this.graphStatus();}
  };
  // A first paint is guaranteed before any forecast integration starts.
  this.forecastFrame=requestAnimationFrame(()=>{this.forecastTimer=setTimeout(batch,0);});this.graphStatus();
 }
 observeEnd(sample){
  if(sample?.ended!==true||!Number.isFinite(sample.t)||sample.t<0||sample.t>60||this.endTime!==null&&sample.t>=this.endTime)return;
  this.endTime=sample.t;this.duration=sample.t;this.q('.exp-time').max=this.duration;
  // An event has a single terminal state; later frames never extend it again.
  if(this.instance.sample().ended===true||this.instance.t>=this.duration-1e-8){
   if(this.playing)this.setPlaying(false);
   if(this.instance.t>this.duration+1e-8&&!this.seeker.pending)this.seek(this.duration);
  }
 }
 graphStatus(){const end=this.samples.at(-1)?.t||0;this.q('.exp-graph-status').textContent=this.forecastError?'Graph available through '+end.toFixed(2)+' s · '+this.forecastError:this.forecastComplete?'':'Computing graphs · '+end.toFixed(1)+' / '+this.duration+' s';}

 frame(){return {instance:this.instance,params:this.params,sample:this.instance.sample(),geometry:this.instance.geometry(),t:this.instance.t,breakdown:this.breakdown,closeup:this.closeup,samples:this.samples,setParams:p=>this.setParams(p),setCloseup:id=>this.setCloseup(id)};}
 graphDescriptors(){return this.view.graphDescriptors?.(this.params)||this.view.graphs||[];}
 makeGraphs(){this.q('.exp-graphs').replaceChildren();this.graphs=this.graphDescriptors().map(d=>{const host=document.createElement('section');host.dataset.graph=d.id;this.q('.exp-graphs').append(host);return {id:d.id,host,plot:d.kind==='custom'?new CustomGraph(host,d,(stage,descriptor,frame)=>this.view.drawGraph?.(stage,descriptor,frame)):new LinkedGraph(host,d)};});this.q('.exp-graph-choices').innerHTML=this.graphs.map(g=>`<button data-exp="graph" data-id="${esc(g.id)}">${esc(this.graphDescriptors().find(d=>d.id===g.id).label)}</button>`).join('');this.syncGraphVisibility();}
 syncGraphVisibility(){this.host.classList.toggle('is-graphs-open',!this.q('.exp-graph-panel').hidden);for(const g of this.graphs)g.host.hidden=!this.enabledGraphs.has(g.id);for(const b of this.q('.exp-graph-choices').children)b.setAttribute('aria-pressed',String(this.enabledGraphs.has(b.dataset.id)));this.draw();}
 setGraphsOpen(open){
  this.q('.exp-graph-panel').hidden=!open;this.q('[data-exp=graphs]').setAttribute('aria-expanded',String(open));
  if(open&&!this.enabledGraphs.size)for(const graph of this.graphDescriptors().slice(0,2))this.enabledGraphs.add(graph.id);
  this.syncGraphVisibility();if(open)this.revealGraph();else this.host.scrollTop=0;
 }
 revealGraph(){
  if(innerWidth>900)return;cancelAnimationFrame(this.graphRevealFrame);
  this.graphRevealFrame=requestAnimationFrame(()=>{
   if(this.destroyed||this.q('.exp-graph-panel').hidden)return;
   const first=this.graphs.find(graph=>!graph.host.hidden);if(!first)return;
   const canvas=first.plot.canvas.getBoundingClientRect(),host=this.host.getBoundingClientRect(),top=host.top+this.q('.exp-tools').offsetHeight+8,bottom=host.bottom-this.q('.exp-transport').offsetHeight-10;
   if(canvas.bottom>bottom)this.host.scrollTop+=canvas.bottom-bottom;
   else if(canvas.top<top)this.host.scrollTop-=top-canvas.top;
   this.resize();
  });
 }
 cancelSeek(){if(this.seeker.pending)this.q('.exp-note').textContent='';this.seeker.cancel();}
 seek(t){
  this.setPlaying(false);this.seekTarget=Math.max(0,Math.min(this.duration,t));
  const immediate=this.model.id==='coupled-oscillators'&&this.params.method==='modes';
  if(!immediate&&this.seekTarget)this.q('.exp-note').textContent='Seeking '+this.seekTarget.toFixed(2)+' s…';
  return this.seeker.run(this.model,this.params,this.seekTarget,{immediate,onComplete:candidate=>{if(this.destroyed)return;this.instance=candidate;this.observeEnd(candidate.sample());this.q('.exp-note').textContent='';this.draw();this.changed();},onError:error=>{this.q('.exp-note').textContent=error.message||'This time could not be reached.';this.draw();}});
 }

 setPlaying(value){if(value){this.cancelSeek();if(this.instance.t>=this.duration-1e-8||this.instance.sample().ended===true)this.instance.reset();}this.playing=!!value;const b=this.q('[data-exp=play]');b.innerHTML=controlIcon(this.playing?'pause':'play');b.setAttribute('aria-label',this.playing?'Pause':'Play');b.title=this.playing?'Pause':'Play';this.changed();}
 reset(){this.cancelSeek();this.setPlaying(false);this.instance.reset();this.closeup='';this.scene.classList.remove('is-closeup');this.stage.snap=true;this.q('.exp-zoom-back').hidden=true;this.draw();this.changed();}
 setCloseup(id){if(id&&!(this.view.closeups||this.manifest.closeups||[]).some(c=>c.id===id))return;this.closeup=id;this.q('.exp-zoom-back').hidden=!id;this.scene.classList.toggle('is-closeup',!!id);this.draw();this.changed();}
 setBreakdown(value){this.breakdown=!!value;this.q('[data-exp=breakdown]').setAttribute('aria-pressed',String(this.breakdown));this.equations.hidden=!this.breakdown;this.draw();this.changed();}
 equation(el,lines){const signature=JSON.stringify(lines);if(el.dataset.signature===signature)return;el.dataset.signature=signature;el.innerHTML=lines.map(s=>`<div class="exp-equation">\\[${esc(s)}\\]</div>`).join('');math(el);}
 draw(){if(this.destroyed||!this.instance)return;const frame=this.frame();this.stage.resize();this.stage.begin();if(this.custom)this.custom.draw(frame);else this.view.draw(this.stage,frame);this.q('.exp-clock').textContent=frame.t.toFixed(2)+' s';this.q('.exp-time').value=this.seeker.pending?Math.min(this.duration,this.seekTarget):frame.t;
  this.equations.hidden=!this.breakdown;if(this.breakdown)this.equation(this.equations,this.view.equations?.(frame)||[]);
  const zoom=this.q('.exp-closeup-equation');zoom.hidden=!this.closeup;if(this.closeup){const lines=this.view.closeupEquation?.(frame)||'';this.equation(zoom,Array.isArray(lines)?lines:[lines]);}
  const anchors=this.view.closeupAnchors?.(this.stage,frame);this.q('.exp-closeups').classList.toggle('has-anchors',!!anchors);if(anchors)for(const button of this.q('.exp-closeups').children){const a=anchors[button.dataset.id];if(a){button.style.left=Math.max(button.offsetWidth/2+8,Math.min(this.stage.w-button.offsetWidth/2-8,a.x))+'px';button.style.top=Math.min(this.stage.h-40,a.y)+'px';}}
  if(this.view.key)this.q('.exp-key').textContent=this.view.key(frame);
  if(!this.q('.exp-graph-panel').hidden)for(const g of this.graphs)if(!g.host.hidden)g.plot.draw(this.samples,this.instance.t,frame);
 }
 tick(now){if(this.destroyed)return;const elapsed=this.last?Math.min(.06,(now-this.last)/1000):0;this.last=now;if(this.playing&&this.host.isConnected&&this.host.getClientRects().length){try{this.instance.step(Math.max(0,Math.min(elapsed*this.speed,this.duration-this.instance.t)));this.observeEnd(this.instance.sample());if(this.playing&&this.instance.t>=this.duration-1e-8)this.setPlaying(false);}catch(error){this.setPlaying(false);this.q('.exp-note').textContent=error.message||'Motion stopped at this state.';}}this.draw();this.raf=requestAnimationFrame(this.tick);}
 snapshot(){return {params:{...this.params},t:this.instance.t,observables:this.instance.sample(),playing:this.playing,closeup:this.closeup,breakdown:this.breakdown,graphs:[...this.enabledGraphs]};}
 changed(){this.onChange(this.snapshot());}
 apply(a){if(!a)return;if(a.type==='set_params')return this.setParams(a.values);if(a.type==='preset'){const p=this.model.presets.find(p=>p.id===a.id);return p?this.setParams(p.values):false;}if(a.type==='play')this.setPlaying(true);if(a.type==='pause')this.setPlaying(false);if(a.type==='reset')this.reset();if(a.type==='closeup')this.setCloseup(a.id);if(a.type==='breakdown')this.setBreakdown(a.enabled);if(a.type==='graph'){a.enabled?this.enabledGraphs.add(a.id):this.enabledGraphs.delete(a.id);this.setGraphsOpen(true);this.changed();}}
 resize(){this.stage.resize();this.custom?.resize?.();this.draw();}
 destroy(){this.destroyed=true;this.cancelSeek();cancelAnimationFrame(this.graphRevealFrame);this.forecastGeneration++;clearTimeout(this.forecastTimer);cancelAnimationFrame(this.forecastFrame);cancelAnimationFrame(this.raf);this.observer.disconnect();this.custom?.destroy?.();this.host.removeEventListener('click',this.click);this.host.removeEventListener('change',this.change);this.host.replaceChildren();}
}
