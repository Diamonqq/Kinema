import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../static/js/experiments/minkowski/model.js',import.meta.url),'utf8');
const {model,C,gamma,boost,interval,addVelocity,transformFourVector,transformTensor,symmetrizeTensor,lightWavefront}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
// Every analytic assertion supplies an absolute tolerance in the quantity's units.
function near(actual,expected,tolerance,message='') {
  assert.ok(Math.abs(actual-expected)<=tolerance,`${message}: ${actual} vs ${expected}; absolute tolerance ${tolerance}`);
}
const event=(t,x,y=0)=>({t,x,y});
test('Lorentz interval and inverse boost: tolerance 2e-13 c² s²; 8e-6 m, 1e-13 s inverse',()=>{
  for(const b of [-.95,-.6,0,.6,.95])for(const a of [event(2,1.4*C,.3*C),event(.5,C),event(1,C),event(0,C)]) {
    const p=boost(a,b),back=boost(p,-b);
    near(interval(p)/(C*C),interval(a)/(C*C),2e-13,'interval / c², s²');near(back.t,a.t,1e-13,'time');near(back.x,a.x,8e-6,'position');
  }
});
test('gamma and moving proper-time ticks: tolerance 1e-13 dimensionless / s',()=>{
  near(gamma(.6),1.25,1e-13);
  const m=model.create({scenario:'light-clock',beta:.6,length:C});
  const e=m.geometry().ground.events;
  near(e.find(a=>a.id==='receive').t,2.5,1e-13,'dilated period');
  const m2=model.create({scenario:'light-clock',beta:.6,length:C,frame:'moving'});
  near(m2.geometry().moving.events.find(a=>a.id==='receive').t,2,1e-13,'proper period');
  m.step(1.25);near(m.sample().properTime,1,1e-13);
  const ticks=m.geometry().ground.worldlines.find(l=>l.id==='lower').ticks;
  near(ticks[0].t,.3125,1e-13);near(ticks[0].tau,.25,1e-13);
});
test('length contraction measures simultaneous endpoints; tolerance 1e-6 m and 1e-13 s',()=>{
  const m=model.create({scenario:'length-contraction',beta:.6,length:C});
  near(m.sample().contractedLength,.8*C,1e-6);
  const e=m.geometry().ground.events;
  near(e[0].t,e[1].t,1e-13);
  near(e[1].x-e[0].x,.8*C,1e-6);
  const lines=m.geometry().moving.worldlines;
  function xAtZero(l){const [a,b]=l.points;return a.x+(b.x-a.x)*(-a.t)/(b.t-a.t);}
  near(xAtZero(lines[1])-xAtZero(lines[0]),C,1e-6,'rod proper length');
});
test('ground simultaneous events: Δt prime = -gamma beta L/c, tolerance 1e-13 s',()=>{
  const m=model.create({scenario:'simultaneity',beta:.6,length:C});
  const e=m.geometry().moving.events;
  near(e.find(a=>a.id==='right-strike').t-e.find(a=>a.id==='left-strike').t,-.75,1e-13);
  near(m.sample().simultaneityOffset,-.75,1e-13);
  const ground=m.geometry().ground.events;
  near(ground.find(a=>a.id==='right-received').t,.3125,1e-13);
  near(ground.find(a=>a.id==='left-received').t,1.25,1e-13);
});
test('velocity addition and light-speed invariance: tolerance 1e-6 m/s',()=>{
  near(addVelocity(.5*C,.6*C),1.1/1.3*C,1e-6);
  for(const b of [-.95,0,.95])for(const sign of [-1,1])near(addVelocity(sign*C,b*C),sign*C,1e-6);
  const m=model.create({scenario:'velocity-addition'});near(m.sample().rocketVelocity,1.1/1.3*C,1e-6);
});
test('catch-up and BOTH round trips; tolerance 1e-13 s; null intervals within 131072 m² at beta .95',()=>{
  for(const b of [-.6,0,.6,.95]) {
    const fixed=model.create({scenario:'moving-mirror',length:C,beta:b});
    const co=model.create({scenario:'comoving-mirrors',length:C,beta:b});
    near(fixed.sample().catchTime,1/(1-b),1e-13);
    near(fixed.sample().roundTripTime,2/(1-b),1e-13,'fixed source');
    near(co.sample().roundTripTime,1/(1-b)+1/(1+b),1e-13,'comoving source');
    for(const m of [fixed,co])for(const frame of ['ground','moving']) {
      const l=m.geometry()[frame].worldlines.find(l=>l.id==='light');
      for(let i=1;i<l.points.length;i++)near(interval(l.points[i],l.points[i-1]),0,131072,'null segment at beta .95');
    }
  }
});
test('twin ages with instantaneous turnaround: tolerance 1e-13 s, both playback frames',()=>{
  for(const frame of ['ground','moving']) {
    const m=model.create({scenario:'twins',beta:.6,length:C,frame});
    m.step(frame==='ground'?2:2.5);
    near(m.sample().homeAge,2,1e-13);near(m.sample().travelerAge,1.6,1e-13);
    const e=m.geometry().moving.events.find(e=>e.id==='turn');
    near(e.x,0,1e-6);near(e.t,.8,1e-13);
  }
  const m=model.create({scenario:'twins',beta:.6,length:C,frame:'moving'});m.step(.8);
  near(m.sample().travelerAge,.8,1e-13,'traveler at turn on moving slice');
  near(m.sample().homeAge,.64,1e-13,'simultaneous home clock');
});
test('now line transforms consistently; chosen-frame objects share coordinate time (1e-13 s)',()=>{
  const m=model.create({scenario:'moving-mirror',frame:'moving'});m.step(.5);
  const geo=m.geometry();
  for(const p of geo.moving.now)near(p.t,.5,1e-13);
  for(const p of geo.objects)near(p.t,.5,1e-13);
  for(const p of geo.calibration.moving)near(interval(p),C*C,2000,'calibration hyperbola m²');
});
test('barn door simultaneity and finite first/last frames, all presets (1e-13 s)',()=>{
  const barn=model.create({scenario:'pole-barn',beta:.8,length:C});
  assert.equal(barn.geometry().barnFits,true);
  const doors=barn.geometry().moving.events.filter(e=>e.id.includes('close'));
  near(doors[1].t-doors[0].t,-gamma(.8)*.8*.8,1e-13);
  for(const preset of model.presets)for(const frame of ['ground','moving']) {
    const m=model.create({...preset.values,frame});
    for(const dt of [0,.01,1,100]) {
      m.step(dt);assert.ok(Object.entries(m.sample()).every(([k,v])=>k==='ended'?typeof v==='boolean':Number.isFinite(v)));
      assert.ok(JSON.stringify(m.geometry()).indexOf('null')<0,'no nonfinite geometry');
    }
    m.reset();assert.equal(m.t,0);
  }
});
test('exact step/reset, reject invalid inputs, geometry snapshots isolated (absolute tolerance 1e-15 s)',()=>{
  const m=model.create();m.step(.13);m.step(.27);near(m.t,.4,1e-15);m.reset();assert.equal(m.t,0);
  const geo=m.geometry();geo.ground.worldlines[0].points[0].x=999;
  assert.equal(m.geometry().ground.worldlines[0].points[0].x,0);
  for(const values of [{beta:1},{beta:NaN},{length:-1},{frame:'oops'},{scenario:'oops'}])assert.throws(()=>model.create(values),RangeError);
  for(const dt of [-1,Infinity,NaN])assert.throws(()=>m.step(dt),RangeError);
});
test('arbitrary-direction boost preserves interval and reverses: 2e-13 s², 2e-6 m',()=>{
  const b={x:.3,y:-.4,z:.2},a={t:2,x:.7*C,y:.2*C,z:-.4*C};
  const v=boost(a,b),back=boost(v,{x:-.3,y:.4,z:-.2});
  near(interval(v)/C**2,interval(a)/C**2,2e-13);
  near(back.t,a.t,2e-13);for(const axis of ['x','y','z'])near(back[axis],a[axis],2e-6);
  assert.throws(()=>model.create({beta:.8,betaY:.8}),RangeError);
});
test('each original body type: simultaneous contracted outlines, transverse width unchanged (2e-6 m, 1e-13 s)',()=>{
  for(const objectType of ['rod','rocket','rectangle','barn','ball']){
    const m=model.create({scenario:'objects',objectType,length:C,objectBetaX:.6,beta:.6});m.step(1);
    const {ground,moving}=m.geometry().solids[0];
    for(const a of [...ground,...moving])near(a.t,1,1e-13);
    const extent=(a,k)=>Math.max(...a.map(v=>v[k]))-Math.min(...a.map(v=>v[k]));
    near(extent(ground,'x'),extent(moving,'x')*.8,2e-6);
    near(extent(ground,'y'),extent(moving,'y'),2e-6);
    if(objectType==='rod')near(extent(moving,'x'),C,2e-6);
    if(objectType==='rectangle')near(extent(moving,'y'),.3*C,2e-6);
    if(objectType==='ball')assert.equal(ground.length,1);
  }
});
test('oblique object outlines satisfy inverse simultaneous-slice contraction (3e-6 m, 1e-13 s)',()=>{
  const m=model.create({scenario:'objects',objectType:'rectangle',objectBetaX:.3,objectBetaY:.4,objectBetaZ:.2,beta:.3,betaY:.4,betaZ:.2,length:C});m.step(.7);
  const a=m.geometry().solids[0].moving;
  near(Math.abs(a[1].x-a[0].x),C,3e-6);near(Math.abs(a[3].y-a[0].y),.3*C,3e-6);
  for(const p of a){near(p.t,.7,1e-13);near(p.z,0,3e-6);}
});
test('flash fronts are spherical null sections in both frames; no pre-emission front (2e-13 s², 2e-6 m)',()=>{
  const emission={t:.5,x:.2*C,y:-.3*C,z:.1*C};
  for(const beta of [0,{x:.3,y:.4,z:.2}]){
    const e=boost(emission,beta);assert.equal(lightWavefront(emission,e.t-.1,beta).visible,false);
    const f=lightWavefront(emission,e.t+1,beta);near(f.radius,C,2e-6);
    for(const ring of f.rings)for(const p of ring)near(interval(p,e)/C**2,0,2e-13);
  }
  const m=model.create({scenario:'flashes',frame:'moving'});assert.equal(m.geometry().wavefronts.filter(f=>f.visible).length,1);
});
test('four-vector and rank-two transforms invert and preserve metric/symmetry (2e-12 dimensionless)',()=>{
  const b={x:.3,y:.4,z:-.2},inv={x:-.3,y:-.4,z:.2},v=[2,1,.2,-.4];
  const norm=a=>a[0]**2-a.slice(1).reduce((s,v)=>s+v*v,0),vp=transformFourVector(v,b);
  near(norm(vp),norm(v),2e-12);
  transformFourVector(vp,inv).forEach((x,i)=>near(x,v[i],2e-12));
  const a=Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>i*4+j-5));
  for(const mode of ['none','symmetric','antisymmetric']){
    const t=symmetrizeTensor(a,mode),tp=transformTensor(t,b),back=transformTensor(tp,inv);
    for(let i=0;i<4;i++)for(let j=0;j<4;j++){
      near(back[i][j],t[i][j],2e-12);
      if(mode!=='none')near(tp[i][j],(mode==='symmetric'?1:-1)*tp[j][i],2e-12);
    }
  }
  const metric=[[1,0,0,0],[0,-1,0,0],[0,0,-1,0],[0,0,0,-1]],transformed=transformTensor(metric,b);
  transformed.forEach((row,i)=>row.forEach((x,j)=>near(x,metric[i][j],2e-12)));
  const f=[[0,1,0,0],[-1,0,0,0],[0,0,0,0],[0,0,0,0]],fp=transformTensor(f,{x:0,y:.6,z:0});
  near(fp[1][0],-1.25,2e-12);near(fp[2][1],-.75,2e-12);
  const contraction=t=>t.reduce((s,row,i)=>s+row.reduce((a,x,j)=>a+(i===0?1:-1)*(j===0?1:-1)*x*x,0),0);
  near(contraction(fp),-2,2e-12);
  const m=model.create({scenario:'tensor'}),snapshot=m.geometry();snapshot.calculator.tensor.ground[0][1]=99;snapshot.calculator.vector.ground[0]=99;
  assert.equal(m.geometry().calculator.tensor.ground[0][1],1);assert.equal(m.geometry().calculator.vector.ground[0],0);
});
test('six independent original object types coexist with distinct motion and flashes (3e-6 m, 1e-13 s)',()=>{
  const p={scenario:'objects',bodyCount:6,objectType:'rod',objectBetaX:.1,
    body2Type:'rocket',body2BetaX:-.2,body3Type:'rectangle',body3BetaY:.3,
    body4Type:'barn',body4BetaZ:-.4,body5Type:'ball',body5BetaX:.5,
    body6Type:'flash',body6EmissionTime:.1,beta:.3,betaY:.2,betaZ:.1};
  const m=model.create(p),before=m.geometry();assert.equal(before.solids.length,5);assert.equal(before.wavefronts[0].visible,false);
  m.step(.2);const after=m.geometry(),velocities=[[.1,0,0],[-.2,0,0],[0,.3,0],[0,0,-.4],[.5,0,0]];
  for(let i=0;i<5;i++)for(let axis=0;axis<3;axis++){
    const k=['x','y','z'][axis];near(after.solids[i].ground[0][k]-before.solids[i].ground[0][k],C*.2*velocities[i][axis],3e-6);
    for(const vertex of after.solids[i].moving)near(vertex.t,.2,1e-13);
  }
  assert.equal(after.wavefronts[0].visible,true);near(after.wavefronts[0].radius,.1*C,3e-6);
  for(const v of [{bodyCount:1.5},{bodyCount:7},{bodyCount:2,body2BetaX:.8,body2BetaY:.8}])assert.throws(()=>model.create(v),RangeError);
});

test('finite light journeys and twin reunion end in the chosen coordinate frame (1e-10 s)',()=>{
 for(const scenario of ['moving-mirror','comoving-mirrors','light-clock','simultaneity','twins'])for(const frame of ['ground','moving']){
  const m=model.create({scenario,frame}),g=m.geometry(),end=Math.max(...g[frame].events.map(e=>e.t));
  m.step(Math.max(0,end-1e-6));assert.equal(m.sample().ended,false);m.step(2e-6);assert.equal(m.sample().ended,true);m.reset();assert.equal(m.sample().ended,false);
 }
 assert.equal(model.create({scenario:'velocity-addition'}).sample().ended,false);
});
