import test from 'node:test';
import assert from 'node:assert/strict';
import {model,normalModes,defaults} from '../../static/js/experiments/coupled-oscillators/model.js';
const near=(got,want,tol=1e-9)=>assert.ok(Math.abs(got-want)<=tol,`${got} != ${want} (±${tol})`);
const advance=(s,t,dt=.01)=>{for(let left=t;left>1e-10;left-=dt)s.step(Math.min(left,dt));};
test('two equal masses have analytic in-phase and out-of-phase frequencies',()=>{
 const {modes}=normalModes({m1:2,m2:2,k1:12,k2:3,k3:12});near(modes[0].omega,Math.sqrt(6));near(modes[1].omega,3);near(modes[0].shape[0],modes[0].shape[1]);near(modes[1].shape[0],-modes[1].shape[1]);
});
test('N equal masses match fixed and free chain eigenfrequencies, including translation',()=>{
 for(let n=2;n<=10;n++)for(const ends of ['walls','free']){const p={n,ends};for(let i=1;i<=n;i++)p['m'+i]=1.7;for(let j=1;j<=n+1;j++)p['k'+j]=13;const {modes}=normalModes(p);modes.forEach((o,j)=>near(o.omega,2*Math.sqrt(13/1.7)*Math.sin(Math.PI*(ends==='walls'?j+1:j)/(2*(ends==='walls'?n+1:n))),2e-7));}
});
test('unequal mass modes satisfy K φ = ω² M φ and mass orthogonality',()=>{
 const {modes,masses,springs}=normalModes({n:4,m1:.4,m2:1.7,m3:2.1,m4:.8,k1:3,k2:27,k3:13,k4:15,k5:4});
 for(const o of modes)for(let i=0;i<4;i++)near((springs[i]+springs[i+1])*o.shape[i]-springs[i]*(o.shape[i-1]||0)-springs[i+1]*(o.shape[i+1]||0),o.omega**2*masses[i]*o.shape[i],1e-9);
 for(let j=0;j<4;j++)for(let k=0;k<4;k++)near(masses.reduce((s,m,i)=>s+m*modes[j].shape[i]*modes[k].shape[i],0),+(j===k),1e-10);
});
test('beats transfer the release energy at half the analytic beat period',()=>{
 const p=model.presets.find(p=>p.id==='beats').values,s=model.create(p),[a,b]=s.modes,T=2*Math.PI/(b.omega-a.omega),E=s.invariants().energy;
 near(T,2*Math.PI/(Math.sqrt(24)-Math.sqrt(20)),1e-8);s.step(T/2);const h=s.sample();assert.ok((.5*h.v1**2+10*h.x1**2)/E<.004);s.step(T/2);const r=s.sample();assert.ok((.5*r.v2**2+10*r.x2**2)/E<.004);
});
test('undamped analytic and symplectic chains conserve energy and agree',()=>{
 const p={n:5,m1:.7,m2:1.4,k1:17,k2:9,k3:31,k4:22,k5:6,k6:14,x1:.23,x2:-.11,x3:.07},a=model.create(p),b=model.create({...p,method:'numerical'}),E=a.invariants().energy;let drift=0;
 for(let i=0;i<2000;i++){a.step(.01);b.step(.01);drift=Math.max(drift,Math.abs(b.invariants().energy/E-1));}near(a.invariants().energy,E,1e-10);assert.ok(drift<.0004,`energy drift ${drift}`);for(let i=1;i<=5;i++)near(a.sample()['x'+i],b.sample()['x'+i],.0004);
});
test('damped normal mode follows exp(-gamma t/2) and RK4 agrees',()=>{
 const p={...model.presets[0].values,gamma:.32},a=model.create(p),b=model.create({...p,method:'numerical'}),w=a.modes[0].omega,wd=Math.sqrt(w*w-(p.gamma/2)**2),T=2*Math.PI/wd;
 advance(a,4*T);advance(b,4*T);near(a.sample().x1,.2*Math.exp(-p.gamma*4*T/2),1e-10);near(b.sample().x1,a.sample().x1,1e-8);assert.ok(a.invariants().energy<.2*model.create(p).invariants().energy);
});
test('driven steady state matches analytic complex transfer function',()=>{
 const p={gamma:.6,force:.15,frequency:4.6,x1:0,x2:0},s=model.create(p),O=p.frequency;
 advance(s,60);const transfer=s.modes.reduce((r,o)=>{const d=o.omega**2-O**2,b=p.gamma*O,z=p.force*o.shape[0]**2/(d*d+b*b);return [r[0]+z*d,r[1]+z*b]},[0,0]);
 near(s.sample().x1,transfer[0]*Math.cos(O*s.t)+transfer[1]*Math.sin(O*s.t),2e-9);
 const numerical=model.create({...p,method:'numerical'});advance(numerical,60);near(numerical.sample().x1,s.sample().x1,2e-8);
});
test('reset and exact step duration preserve initial state for all presets and free modes',()=>{
 for(const p of model.presets){const s=model.create(p.values),initial=s.sample();s.step(.123);near(s.t,.123);s.reset();assert.deepEqual(s.sample(),initial);}
 const free=model.create({ends:'free',modeA:1,amplitudeA:.1,v1:.1});free.step(2);assert.ok(Object.values(free.sample()).every(Number.isFinite));assert.equal(defaults.n,2);
});

test('displacement window follows the excited mode beat and falls back to five periods',async()=>{
 const {displacementWindow,view}=await import('../../static/js/experiments/coupled-oscillators/view.js');
 for(const id of ['beats','mode1','mode2','driven']){
  const p=model.presets.find(p=>p.id===id).values,s=model.create(p),[a,b]=s.modes;
  const expected=['beats','driven'].includes(id)?2*Math.PI/(b.omega-a.omega):5*2*Math.PI/a.omega;
  near(displacementWindow(p),expected,1e-8);near(view.graphDescriptors(p).find(g=>g.id==='motion').window,expected,1e-8);
 }
 const p={...defaults,n:4,modeA:2,modeB:4},s=model.create(p);near(displacementWindow(p),2*Math.PI/(s.modes[3].omega-s.modes[1].omega),1e-8);
 assert.equal(view.graphs.find(g=>g.id==='modes').label,'Mode coordinates');assert.equal(view.graphs.find(g=>g.id==='modes').unit,'√kg · m');
 assert.deepEqual(view.graphs.find(g=>g.id==='energy').series.map(v=>v.label),['E','K','U']);
});
test('Breakdown ends with live net force in N including damping and driving',async()=>{
 const {view}=await import('../../static/js/experiments/coupled-oscillators/view.js');
 for(const p of [{...defaults},{...defaults,gamma:.3,force:.4,ends:'free'}]){
  const s=model.create(p);s.step(.6);const geometry=s.geometry(),lines=view.equations({params:s.params,geometry,t:s.t,sample:s.sample()});
  lines.forEach((line,i)=>{assert.ok(line.includes('='+geometry.forces[i].toFixed(2)+'\\,\\mathrm{N}'));assert.ok(line.includes('m_{'+(i+1)+'}\\ddot'));});
 }
});

test('spring-force names identify receiving mass and spring and match the equations',async()=>{
 const {view,springForces}=await import('../../static/js/experiments/coupled-oscillators/view.js');
 const s=model.create({x1:.13,x2:0,k2:40}),geometry=s.geometry();
 assert.deepEqual(springForces(geometry,0).map(f=>[f.name,f.value]),[['F₁,₁',-2.6],['F₁,₂',-5.2]]);
 assert.deepEqual(springForces(geometry,1).map(f=>[f.name,f.value]),[['F₂,₂',5.2],['F₂,₃',0]]);
 const frame={instance:s,params:s.params,geometry,t:s.t,sample:s.sample(),breakdown:true};
 const equations=view.equations(frame);
 for(let i=0;i<2;i++)for(const force of springForces(geometry,i)){
  assert.ok(equations[i].includes(force.tex+'='));assert.ok(equations[i].includes('='+force.value.toFixed(2)+'\\,\\mathrm{N}'));
 }
 assert.ok(view.closeupEquation(frame)[0].startsWith('F_{2,2}='));
 const free=model.create({ends:'free',x1:.13,x2:0});assert.equal(springForces(free.geometry(),0).length,1);assert.equal(springForces(free.geometry(),1).length,1);
});

test('force tip labels carry signed N values at desktop and simplify before narrow overlaps',async()=>{
 const {view}=await import('../../static/js/experiments/coupled-oscillators/view.js');
 const {VectorStage}=await import('../../static/js/experiments/kit/stage.js');
 const intersects=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
 for(const width of [568,304])for(const height of [340,520])for(const x1 of [-.13,.13]){
  const ctx=new Proxy({font:'11px system-ui',measureText(text){const size=Number.parseFloat(this.font),length=String(text).length*size*.58;return {width:length,actualBoundingBoxLeft:length/2,actualBoundingBoxRight:length/2,actualBoundingBoxAscent:size*.7,actualBoundingBoxDescent:size*.3}}},{get:(obj,key)=>obj[key]||(()=>{})});
  const stage=Object.assign(Object.create(VectorStage.prototype),{ctx,w:width,h:height,labels:[],snap:true});
  const instance=model.create({x1,x2:0,k2:40}),frame={instance,geometry:instance.geometry(),params:instance.params,sample:instance.sample(),t:0,breakdown:true,closeup:''};
  view.draw(stage,frame);const forceLabels=stage.labels.filter(l=>/^F/.test(l.text));assert.equal(forceLabels.length,3);
  if(width<400)assert.ok(forceLabels.every(l=>/^F[₀-₉]+,[₀-₉]+$/.test(l.text)));
  else {assert.ok(forceLabels.every(l=>/^F[₀-₉]+,[₀-₉]+ (?:−)?\d+\.\d{2} N$/.test(l.text)));assert.ok(forceLabels.some(l=>l.text.includes('−')));}
  for(const label of forceLabels){assert.ok(label.x>=0&&label.x+label.width<=width&&label.y>=0&&label.y+label.height<=stage.h);assert.ok(stage.labels.every(other=>other===label||!intersects(label,other)));}
 }
});

test('drawn mass center remains the drag target after layout changes',async()=>{
 const {view}=await import('../../static/js/experiments/coupled-oscillators/view.js');
 const {VectorStage}=await import('../../static/js/experiments/kit/stage.js');
 const ctx=new Proxy({font:'11px system-ui',measureText(text){return {width:String(text).length*6,actualBoundingBoxLeft:String(text).length*3,actualBoundingBoxRight:String(text).length*3,actualBoundingBoxAscent:8,actualBoundingBoxDescent:3}}},{get:(obj,key)=>obj[key]||(()=>{})});
 const stage=Object.assign(Object.create(VectorStage.prototype),{ctx,w:568,h:520,labels:[],snap:true});
 let instance=model.create(model.presets.find(p=>p.id==='beats').values);
 const frame=()=>({instance,params:instance.params,geometry:instance.geometry(),sample:instance.sample(),t:instance.t,breakdown:false,closeup:'',setParams(values){instance=model.create({...instance.params,...values});}});
 for(const [w,h] of [[568,520],[568,340],[304,340]]){
  stage.w=w;stage.h=h;stage.snap=true;stage.labels=[];view.draw(stage,frame());
  const camera=stage.camera,mass=instance.geometry().masses[0],point={x:w/2+(mass.x-camera.cx)*camera.scale,y:h/2+camera.cy*camera.scale},before=instance.params.x1;
  assert.equal(view.pointer(stage,frame(),{...point,type:'down'}),true);
  assert.equal(view.pointer(stage,frame(),{x:point.x-12,y:point.y,type:'move'}),true);
  assert.equal(view.pointer(stage,frame(),{...point,type:'up'}),true);
  assert.ok(instance.params.x1<before);
 }
});
