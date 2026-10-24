import test from 'node:test';
import assert from 'node:assert/strict';
import {model as pendulum} from '../../static/js/experiments/pendulum/model.js';
import {view as pendulumView,pendulumBounds,shaftHits} from '../../static/js/experiments/pendulum/view.js';
import {fixedMap,linePlot,drawAnalysis} from '../../static/js/experiments/motion-generator/view-tools.js';
function stage(w,h){
 const ctx=new Proxy({measureText:t=>({width:t.length*6}),createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{}});
 const s={w,h,ctx,snap:true,labels:[],avoid:[],line(){},circle(){},arrow(){},spring(){},text(text,x,y,color,size=12,align='center'){const width=ctx.measureText(text).width;this.labels.push({text,x:x-(align==='center'?width/2:align==='right'?width:0),y:y-size*.65,width,height:size*1.3});}};return s;
}
function frame(model,values){const params=Object.fromEntries(model.params.map(p=>[p.key,values?.[p.key]??p.value])),instance=model.create(params);return {params,instance,t:0,sample:instance.sample(),geometry:instance.geometry(),samples:[],breakdown:false,closeup:''};}
test('gallery thumbnails contain apparatus only: zero caption or readout labels',async()=>{
 for(const id of ['motion-generator','pendulum','anharmonic']){const {model}=await import('../../static/js/experiments/'+id+'/model.js'),{view}=await import('../../static/js/experiments/'+id+'/view.js'),s=stage(260,112);view.draw(s,{...frame(model),thumbnail:true});assert.equal(s.labels.length,0,id);}
});
test('pendulum force labels clear every shaft and all three terms remain visible at both widths, tolerance 0 px',()=>{
 for(const [w,h] of [[320,500],[570,500],[320,340],[570,340]])for(const closeup of ['', 'gravity']){
  const s=stage(w,h),f={...frame(pendulum),breakdown:!closeup,closeup};pendulumView.draw(s,f);
  for(const term of ['mg','\u2212mg sin\u03b8','mg cosθ']){const rect=s.labels.find(l=>l.text===term);assert.ok(rect,`${w}x${h} ${closeup}: missing ${term}`);for(const a of s.forceArrows)assert.equal(shaftHits(rect,[a.ax,a.ay],[a.x,a.y],2),false,`${w} ${term}`);}
 }
});
test('pendulum focused fixed envelope contains all presets over 60 s, tolerance 1e-6 m',()=>{
 for(const preset of pendulum.presets){const p=preset.values,b=pendulumBounds(p,true),i=pendulum.create(p);
  for(let n=0;n<=120;n++){const q=i.sample();assert.ok(q.x>=b[0]-1e-6&&q.x<=b[1]+1e-6&&q.y>=b[2]-1e-6&&q.y<=b[3]+1e-6,preset.id);if(n<120)i.step(.5);}
 }
});
test('focused small-angle pendulum uses at least 100 px of a 340 px scene; tolerance 1e-10 px',()=>{
 const f=frame(pendulum),s=stage(320,340),m=fixedMap(s,pendulumBounds(f.params,true),{top:34,bottom:190,padding:35});assert.ok(m.scale*f.params.length>=100-1e-10);
});

test('main small-angle view uses the fixed conservative envelope, including initial speed; tolerance 1e-6 m',()=>{
 for(const values of [{theta0:.3},{theta0:.1,omega0:1.2}]){const f=frame(pendulum,values),b=pendulumBounds(f.params),s=stage(320,280),m=fixedMap(s,b,{top:28,bottom:145,padding:35});assert.ok(m.scale*f.params.length>80);
  for(let n=0;n<120;n++){const q=f.instance.sample();assert.ok(q.x>=b[0]-1e-6&&q.x<=b[1]+1e-6&&q.y>=b[2]-1e-6&&q.y<=b[3]+1e-6);f.instance.step(.5);}
 }
});
test('nonnegative spectrum starts at zero and keeps amplitude caption above the curve, tolerance 0 px',()=>{
 for(const w of [260,570]){const s=stage(w,190);s.resize=()=>{};s.begin=()=>{s.labels=[];};linePlot(s,{title:'Angular velocity spectrum',points:[{x:0,y:0},{x:1,y:.32},{x:2,y:.01}],ylabel:'amplitude',yFloor:0});assert.equal(s.plotBounds.ymin,0);const caption=s.labels.find(l=>l.text==='amplitude');assert.ok(caption);assert.ok(caption.y+caption.height<s.plotBounds.top);}
});
test('polish: active dimensions only, five-period windows, coefficient symbols and clean energy statement',async()=>{
 const {model:m}=await import('../../static/js/experiments/motion-generator/model.js'),{view:v,forceEquations,forceLaw}=await import('../../static/js/experiments/motion-generator/view.js'),{model:a}=await import('../../static/js/experiments/anharmonic/model.js');
 for(const dimensions of ['1d','2d','3d']){const f=frame(m,{dimensions}),ds=v.graphDescriptors(f.params),n=Number(dimensions[0]);for(const id of ['motion','velocity'])assert.equal(ds.find(d=>d.id===id).series.length,n);}
 const f=frame(m),equations=v.equations(f).join(' ');assert.ok(!equations.includes('beta'));assert.ok(!equations.includes('alpha'));assert.ok(equations.includes('E=K+U='));assert.ok(!equations.includes('E-W+Q'));assert.ok(!equations.includes('W_{'));assert.ok(!equations.includes('Q_{'));assert.ok(forceLaw(f.params).includes('\u2212kx'));assert.ok(!forceLaw(f.params).includes('-'));
 assert.equal(m.params.find(p=>p.key==='cubic').symbol,a.params.find(p=>p.key==='quartic').symbol);const cubic=frame(m,{spring:0,cubic:1});assert.ok(forceEquations(cubic).join(' ').includes('\\beta'));assert.ok(!forceEquations(cubic).join(' ').includes('-kx'));
 for(const id of ['motion-generator','pendulum','anharmonic']){const {model}=await import('../../static/js/experiments/'+id+'/model.js'),{view}=await import('../../static/js/experiments/'+id+'/view.js'),f=frame(model),ds=view.graphDescriptors(f.params);for(const d of ds.filter(d=>!d.kind))assert.ok(d.window>0&&d.window<=60);if(id!=='motion-generator')assert.equal(ds.find(d=>d.id==='strobe').label,'Poincar\u00e9 section');}
});
test('polish: labels stay in bounds for every preset and view, tolerance 0 px',async()=>{
 for(const id of ['motion-generator','pendulum','anharmonic']){const {model}=await import('../../static/js/experiments/'+id+'/model.js'),{view}=await import('../../static/js/experiments/'+id+'/view.js');
 for(const preset of model.presets)for(const [w,h] of [[306,340],[570,685]])for(const mode of ['scene','breakdown','closeup']){const s=stage(w,h),f={...frame(model,preset.values),breakdown:mode==='breakdown',closeup:mode==='closeup'?view.closeups[0].id:''};view.draw(s,f);for(const l of s.labels)assert.ok(l.x>=0&&l.y>=0&&l.x+l.width<=w&&l.y+l.height<=h,`${id} ${preset.id} ${mode} ${l.text}`);}
 }
});
test('polish: Zoom anchors stay fixed during motion instead of following the bob; tolerance 1e-8 px',async()=>{
 for(const id of ['motion-generator','pendulum','anharmonic']){const {model}=await import('../../static/js/experiments/'+id+'/model.js'),{view}=await import('../../static/js/experiments/'+id+'/view.js'),f=frame(model),s=stage(570,685);view.draw(s,f);const before=view.closeupAnchors(s,f);f.instance.step(.4);f.sample=f.instance.sample();f.geometry=f.instance.geometry();f.t=.4;s.labels=[];view.draw(s,f);const after=view.closeupAnchors(s,f),key=view.closeups[0].id;assert.ok(Math.hypot(before[key].x-after[key].x,before[key].y-after[key].y)<1e-8,id);}
});
test('polish: custom graphs leave the title to their shell',()=>{
 const s=stage(320,190);s.resize=()=>{};s.begin=()=>{s.labels=[];};linePlot(s,{title:'Phase space',points:[{x:-1,y:0},{x:1,y:1}],xlabel:'x / m',ylabel:'v / (m/s)'});assert.ok(!s.labels.some(l=>l.text==='Phase space'));
});

test('pendulum readout stays clear of gravity arrows, tolerance 0 px',()=>{
 for(const [w,h] of [[306,340],[570,340],[306,685],[570,685]])for(const closeup of ['', 'gravity']){const s=stage(w,h),f={...frame(pendulum),breakdown:!closeup,closeup};pendulumView.draw(s,f);const rect=s.labels.find(l=>l.text.includes(' rad   '));assert.ok(rect);for(const a of s.forceArrows)assert.equal(shaftHits(rect,[a.ax,a.ay],[a.x,a.y],2),false,`${w}x${h} ${closeup}`);}
});
test('anharmonic readout survives its own reserved band in every preset/view',async()=>{
 const {model}=await import('../../static/js/experiments/anharmonic/model.js'),{view}=await import('../../static/js/experiments/anharmonic/view.js');for(const preset of model.presets)for(const [w,h] of [[306,340],[570,685]])for(const mode of ['scene','breakdown','closeup']){const s=stage(w,h),f={...frame(model,preset.values),breakdown:mode==='breakdown',closeup:mode==='closeup'?'force':''};view.draw(s,f);assert.ok(s.labels.some(l=>l.text.startsWith('x ')&&l.text.includes(' m/s')),`${preset.id} ${mode} ${w}`);}
});
test('pendulum default tangential force extends beyond the bob by at least 8 px',()=>{
 for(const [w,h] of [[306,340],[570,340],[306,685],[570,685]])for(const closeup of ['', 'gravity']){const s=stage(w,h),f={...frame(pendulum),breakdown:!closeup,closeup};pendulumView.draw(s,f);const a=s.forceArrows.find(a=>a.text.includes('sin'));assert.ok(a);assert.ok(Math.hypot(a.x-a.ax,a.y-a.ay)>=s.bobRadius+8);}
});
test('force equations end with numerical units and omit inactive drive/damping terms',async()=>{
 for(const id of ['pendulum','anharmonic','motion-generator']){const {model}=await import('../../static/js/experiments/'+id+'/model.js'),{view}=await import('../../static/js/experiments/'+id+'/view.js'),f=frame(model),lines=view.equations(f),all=lines.join(' ');assert.ok(!all.includes('reservoir'));assert.ok(!all.includes('cos(\\Omega'));assert.ok(!all.includes('-b'));assert.ok(/\\mathrm/.test(lines.at(-1)));if(id==='motion-generator'){assert.ok(all.includes('ma_x='));assert.ok(!view.graphDescriptors(f.params).some(g=>g.id==='balance'));assert.equal(view.key({...f,breakdown:true}),'');}if(id==='anharmonic'){assert.ok(all.includes('-(1.00)(1.00)^3'));assert.ok(all.includes('-2.00'));}}
});


test('judge: shared formatter has identical precision in labels and equations, no e-notation',async()=>{
 const {fmt,tex,withUnit}=await import('../../static/js/experiments/motion-generator/view-tools.js');
 for(const [v,plain,math] of [[-1,'\u22121.00','-1.00'],[.2333,'0.233','0.233'],[-.0001108,'\u22121.11\u00d710\u207b\u2074','-1.11\\times10^{-4}']]){assert.equal(fmt(v),plain);assert.equal(tex(v),math);assert.equal(withUnit(v,'N'),plain+' N');assert.ok(!/[eE][+-]?\d/.test(fmt(v)));}
});
test('judge: force symbols cover every model force key and track survives zoom',async()=>{
 const {model}=await import('../../static/js/experiments/motion-generator/model.js'),{view,forceSymbols}=await import('../../static/js/experiments/motion-generator/view.js');
 const f={...frame(model),closeup:'force'},s=stage(570,500),lines=[];s.line=(...a)=>lines.push(a);view.draw(s,f);
 assert.deepEqual(Object.keys(forceSymbols).sort(),Object.keys(f.geometry.forces).sort());assert.ok(s.labels.some(l=>l.text==='F_{s} = \u22121.00 N'));assert.ok(s.labels.some(l=>l.text==='x = 0'));assert.ok(lines.some(a=>a[0]===24&&a[2]===546));
});
test('judge: pendulum release and over-the-top preset, inward tension matches centripetal acceleration within 1e-12 N',()=>{
 assert.equal(pendulum.params.find(p=>p.key==='theta0').value,1);assert.equal(pendulum.params.find(p=>p.key==='omega0').value,0);assert.equal(pendulum.presets.find(p=>p.id==='rotation').values.omega0,7);
 const f=frame(pendulum,{theta0:0,omega0:7}),s=stage(570,500);pendulumView.draw(s,{...f,breakdown:true});assert.ok(Math.abs(f.geometry.tension-58.81)<1e-12);const T=s.forceArrows.find(a=>a.text==='T');assert.ok(T);assert.ok(T.y<T.ay);const g=s.forceArrows.find(a=>a.text==='mg');assert.ok(g.y>g.ay);const eq=pendulumView.equations(f).join(' ');assert.ok(eq.includes('58.8'));assert.ok(eq.includes('F_{g,r}'));assert.ok(eq.includes('m\\omega^2L'));
});
test('judge: wrapped angle spans (-pi, pi] and a NaN breaks every sampled rotation wrap',()=>{
 const i=pendulum.create({theta0:0,omega0:7});let before=i.sample(),wraps=0;
 for(let n=0;n<1200;n++){i.step(.01);const q=i.sample(),wrapped=Math.atan2(Math.sin(q.theta),Math.cos(q.theta));if(Math.abs(Math.atan2(Math.sin(before.theta),Math.cos(before.theta))-wrapped)>Math.PI){assert.ok(Number.isNaN(q.thetaWrapped));assert.ok(Number.isNaN(i.sample().thetaWrapped));wraps++;}else assert.ok(q.thetaWrapped>-Math.PI&&q.thetaWrapped<=Math.PI);before=q;}
 assert.ok(wraps>=5);i.reset();assert.equal(i.sample().thetaWrapped,0);assert.equal(pendulumView.graphs.find(g=>g.id==='motion').series[0].key,'thetaWrapped');assert.ok(pendulumView.graphs.find(g=>g.id==='phase').label.includes('unwrapped'));
});
test('judge: coupled default releases one mass, excites two modes and transfers energy (fraction < .004)',async()=>{
 const {model,defaults}=await import('../../static/js/experiments/coupled-oscillators/model.js');assert.equal(defaults.x1,.2);assert.equal(defaults.x2,0);assert.equal(defaults.modeA,0);assert.ok(model.presets.some(p=>p.id==='mode1'));const i=model.create({}),initial=i.sample(),T=2*Math.PI/(i.modes[1].omega-i.modes[0].omega);assert.ok(initial.q1&&initial.q2);const E=initial.energy;i.step(T/2);const q=i.sample();assert.ok((.5*q.v1**2+10*q.x1**2)/E<.004);
});
test('judge: narrow anharmonic scene caps its content height and phase cards have one unit title',async()=>{
 for(const id of ['anharmonic','motion-generator','pendulum']){const {view}=await import('../../static/js/experiments/'+id+'/view.js');assert.equal(view.graphs.find(g=>g.id==='phase').unit,undefined);}
 const {model}=await import('../../static/js/experiments/anharmonic/model.js'),{view}=await import('../../static/js/experiments/anharmonic/view.js'),s=stage(306,685);s.canvas={parentElement:{style:{}}};view.draw(s,frame(model));assert.equal(s.canvas.parentElement.style.maxHeight,'360px');
});

test('period sweep finishes within a few drawn frames and flags pending until then',()=>{
 const plotStage=()=>Object.assign(stage(570,300),{resize(){},begin(){}}),s=plotStage(),f=frame(pendulum),d={id:'period'};let calls=0,draws=0;
 const periodPoint=(frame,i)=>{calls++;const x=.02+(Math.PI-.12)*i/31;return {x,y:pendulum.create({...frame.params,theta0:x,omega0:0}).period()};};
 do{s.labels=[];drawAnalysis(s,d,f,{position:'theta',velocity:'omega',periodPoint});draws++;}while(s.pending&&draws<40);
 assert.equal(s.periodComplete,true);assert.equal(s.pending,false);assert.equal(calls,32);assert.ok(draws<=4,'draws '+draws);
 const slow=plotStage(),g=frame(pendulum,{length:2});let n=0;
 drawAnalysis(slow,d,g,{position:'theta',velocity:'omega',periodPoint:(frame,i)=>{n++;const end=performance.now()+3;while(performance.now()<end);return {x:i,y:1};}});
 assert.ok(n>=1&&n<32,'budgeted points '+n);assert.equal(slow.pending,true);
});
