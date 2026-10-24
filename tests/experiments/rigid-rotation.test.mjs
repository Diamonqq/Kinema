import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// Public source tree intentionally has no package.json; load browser ES module unchanged.
const source=await readFile(new URL('../../static/js/experiments/rigid-rotation/model.js',import.meta.url),'utf8');
const {model,principalMoments,steadyPrecessionRates,prepareUpdate,sampleBatches}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const near=(a,b,tol,message='')=>assert.ok(Math.abs(a-b)<=tol,`${message}: ${a} vs ${b}, tolerance ${tol}`);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const advance=(m,t,h=.05)=>{for(let i=0;i<Math.floor(t/h);i++)m.step(h);return m;};
const norm=v=>Math.hypot(...v);

test('contract, every preset, snapshot ownership, reset and exact step (2e-14 s)',()=>{
  for(const preset of model.presets){
    for(const d of model.params) if(!d.options){
      const steps=(preset.values[d.key]-d.min)/d.step;
      near(steps,Math.round(steps),2e-8,`${preset.id}.${d.key} matches kit step grid`);
    }
    const m=model.create(preset.values), initial=m.sample();
    m.step(.037);near(m.t,.037,0);
    for(const o of model.observables) assert.ok(Number.isFinite(m.sample()[o.key]),o.key);
    const g=m.geometry();g.quaternion[0]=999;g.omegaBody[0]=999;g.principalMoments[0]=999;
    assert.notEqual(m.geometry().quaternion[0],999);
    assert.notEqual(m.geometry().omegaBody[0],999);
    m.reset();assert.deepEqual(m.sample(),initial);
    m.step(0);near(m.t,0,0);
  }
  const m=model.create();for(let i=0;i<10;i++)m.step(.017);near(m.t,.17,2e-14);
});

test('uniform box, plate and cylindrical rod inertia from SI dimensions (1e-14 kg m²)',()=>{
  const p={mass:2,a:1,b:.6,c:.2};
  principalMoments({...p,shape:'box'}).forEach((v,i)=>near(v,[2*(.36+.04)/12,2*(1+.04)/12,2*1.36/12][i],1e-14));
  const plate=principalMoments({...p,shape:'plate'});near(plate[2],plate[0]+plate[1],1e-14);
  const rod=principalMoments({...p,shape:'rod'});near(rod[0],2*(3*.25+.04)/12,1e-14);near(rod[2],.25,1e-14);
});

test('symmetric free body: body precession Ω=(I3−I1)ω3/I1 (2e-8 rad/s), space cone rate |L|/I1 (2e-8 rad/s)',()=>{
  const m=model.create({I1:.4,I2:.4,I3:.6,w1:.7,w2:0,w3:3,tilt:.6});
  const expected=1.5, dt=.001;
  m.step(dt);const g=m.geometry();near(Math.atan2(g.omegaBody[1],g.omegaBody[0])/dt,expected,2e-8);
  // Angular derivative of the body symmetry axis projected around the fixed space L.
  const a=model.create({I1:.4,I2:.4,I3:.6,w1:.7,w2:0,w3:3,tilt:.6});
  const g0=a.geometry(), L=g0.angularMomentumSpace, u=L.map(v=>v/norm(L));
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  const transverse=v=>v.map((x,i)=>x-dot(v,u)*u[i]);
  const v0=transverse(g0.bodyAxisSpace);a.step(dt);const v1=transverse(a.geometry().bodyAxisSpace);
  const cross=[v0[1]*v1[2]-v0[2]*v1[1],v0[2]*v1[0]-v0[0]*v1[2],v0[0]*v1[1]-v0[1]*v1[0]];
  near(Math.atan2(dot(u,cross),dot(v0,v1))/dt,norm(L)/.4,2e-8);
});

test('asymmetric free rotation conserves energy, |L| and space L for 120 s (relative 2e-8), normalized quaternion (4e-16)',()=>{
  const m=model.create({I1:.3,I2:.5,I3:.7,w1:2,w2:3,w3:4}), start=m.invariants();
  for(let i=0;i<2400;i++){
    m.step(.05);const s=m.invariants();
    near(s.energy/start.energy,1,2e-8);
    near(s.angularMomentumMagnitude/start.angularMomentumMagnitude,1,2e-8);
    near(distance(s.angularMomentum,start.angularMomentum)/start.angularMomentumMagnitude,0,2e-8);
    near(norm(m.geometry().quaternion),1,4e-16);
  }
});

test('minimum and maximum axes remain stable for 40 s (transverse rates < 5e-4 rad/s)',()=>{
  for(const axis of [0,2]){
    const w=[1e-4,1e-4,1e-4];w[axis]=4;
    const m=model.create({I1:.3,I2:.5,I3:.7,w1:w[0],w2:w[1],w3:w[2]});
    for(let i=0;i<800;i++){m.step(.05);const wb=m.geometry().omegaBody;near(Math.hypot(...wb.filter((_,i)=>i!==axis)),0,5e-4);}
  }
});

test('intermediate-axis unstable eigenmode grows at linearized rate (relative 2e-5 at 2 s); visible flip by 15 s',()=>{
  const I1=.3,I2=.5,I3=.7,W=4;
  const rate=W*Math.sqrt((I3-I2)*(I2-I1)/(I1*I3));
  const x=1e-6,z=-rate*I1*x/((I3-I2)*W);
  const m=model.create({I1,I2,I3,w1:x,w2:W,w3:z});
  advance(m,2);near(m.sample().w1/(x*Math.exp(rate*2)),1,2e-5);
  let flipped=false;for(let i=0;i<260;i++){m.step(.05);if(m.sample().w2<-3)flipped=true;}assert.ok(flipped);
});

test('heavy top slow/fast steady roots match quadratic (1e-12), actual tilt (2e-8 rad) and precession (2e-7 rad/s) for 6 s',()=>{
  for(const id of ['slow','fast']){
    const p={...model.presets.find(p=>p.id===id).values,azimuth:1.3,phase:.7}, m=model.create(p), g=m.geometry();
    const I=g.principalMoments, rates=steadyPrecessionRates(I,p.w3,p.mass,p.g,p.distance,p.tilt), rate=rates[id];
    near(I[0]*Math.cos(p.tilt)*rate**2-I[2]*p.w3*rate+p.mass*p.g*p.distance,0,1e-12);
    for(let i=0;i<120;i++){m.step(.05);near(m.sample().theta,p.tilt,2e-8);near(m.sample().precessionRate,rate,2e-7);}
  }
});

test('nutating heavy top conserves total energy, vertical L and body axial L for 30 s (relative 2e-7)',()=>{
  const m=model.create(model.presets.find(p=>p.id==='nutation').values), a=m.invariants();
  let min=Infinity,max=-Infinity;
  for(let i=0;i<600;i++){
    m.step(.05);const b=m.invariants(),s=m.sample();min=Math.min(min,s.theta);max=Math.max(max,s.theta);
    near(b.energy/a.energy,1,2e-7);near(b.verticalAngularMomentum/a.verticalAngularMomentum,1,2e-7);near(b.bodyAxialAngularMomentum/a.bodyAxialAngularMomentum,1,2e-7);
  }
  assert.ok(max-min>.05,'Actual nutation must occur');
});

test('constant space torque: L=L0+τt (2e-8 kg m²/s); energy increase equals external work (2e-8 J)',()=>{
  const m=model.create({w1:2,w2:3,w3:4,torquex:.1,torquey:-.2,torquez:.15}), a=m.invariants();
  advance(m,5);const b=m.invariants();
  b.angularMomentum.forEach((v,i)=>near(v,a.angularMomentum[i]+[.1,-.2,.15][i]*5,2e-8));
  near(b.energy-a.energy,b.work,2e-8);
});

test('fixed-axis support supplies dL/dt=ω×L (finite difference 2e-5 N m), zero power (1e-12 W)',()=>{
  const m=model.create({mode:'fixed-axis',w1:2,w2:1,w3:3}),g=m.geometry(),h=1e-6;
  m.step(h);const n=m.geometry();
  n.angularMomentumSpace.forEach((v,i)=>near((v-g.angularMomentumSpace[i])/h,g.torqueSpace[i],2e-5));
  near(g.torqueSpace.reduce((s,v,i)=>s+v*g.omegaSpace[i],0),0,1e-12);
  near(distance(g.omegaSpace,n.omegaSpace),0,1e-12);
});

test('inertia ellipsoid and invariable plane geometry (1e-12 J); output mutations never alter state',()=>{
  const m=model.create({w1:2,w2:3,w3:4}),g=m.geometry(),s=m.sample();
  near(g.omegaBody.reduce((a,v,i)=>a+(v/g.inertiaEllipsoidRadii[i])**2,0),1,1e-12);
  near(g.omegaSpace.reduce((a,v,i)=>a+v*g.angularMomentumSpace[i],0),2*s.kinetic,1e-12);
  const a=m.invariants();a.angularMomentum[0]=100;assert.notEqual(m.invariants().angularMomentum[0],100);
});

test('invalid parameters and impossible heavy-top states fail explicitly; dt rejects reversal and nonfinite input',()=>{
  for(const p of [null,[],{mass:null},{unknown:1},{w1:NaN},{mass:0},{I1:.1,I2:.1,I3:.7},{shape:'garbage'},{mode:'heavy-top',initial:'slow'},{initial:'slow'},{mode:'fixed-axis',torquex:1},{mode:'heavy-top',shape:'symmetric-top',initial:'slow',w3:0},{mode:'heavy-top',shape:'symmetric-top',initial:'slow',tilt:0}]) assert.throws(()=>model.create(p),RangeError);
  const m=model.create();for(const dt of [-1,Infinity,NaN,61])assert.throws(()=>m.step(dt),RangeError);
  assert.equal(steadyPrecessionRates([1,1,1],0,1,9.81,1,.1),null);
});

test('corner point masses use TOTAL mass: explicit sum of eight mr² agrees (2e-15 kg m²)',()=>{
  const p={shape:'corner-masses',mass:2,a:.3,b:.5,c:.8}, expected=[0,0,0];
  for(const x of [-p.a/2,p.a/2])for(const y of [-p.b/2,p.b/2])for(const z of [-p.c/2,p.c/2]){
    expected[0]+=p.mass/8*(y*y+z*z);expected[1]+=p.mass/8*(x*x+z*z);expected[2]+=p.mass/8*(x*x+y*y);
  }
  principalMoments(p).forEach((v,i)=>near(v,expected[i],2e-15));
  const solid=principalMoments({...p,shape:'box'});
  principalMoments(p).forEach((v,i)=>near(v,3*solid[i],2e-15));
});

test('CM tilt torque matches κ z×axis, no parallel-axis shift (1e-14); dL/dt agrees (3e-6 N m)',()=>{
  const m=model.create({mode:'tilt-torque',I1:.3,I2:.5,I3:.7,w1:.2,w2:.3,w3:3,tilt:.7,azimuth:.4,phase:.2,tiltTorque:.8});
  const g=m.geometry(),axis=g.bodyAxisSpace;
  g.torqueSpace.forEach((v,i)=>near(v,[-.8*axis[1],.8*axis[0],0][i],1e-14));
  assert.deepEqual(g.principalMoments,g.centreMoments);assert.deepEqual(g.centreOfMass,[0,0,0]);assert.deepEqual(g.gravityForce,[0,0,0]);
  m.step(1e-6);m.geometry().angularMomentumSpace.forEach((v,i)=>near((v-g.angularMomentumSpace[i])/1e-6,g.torqueSpace[i],3e-6));
});

test('asymmetric CM/pivot tops conserve E and vertical L for 15 s (relative 3e-7); axial L is not spuriously held fixed',()=>{
  for(const [mode,tiltTorque] of [['tilt-torque',.4],['tilt-torque',-.4],['heavy-top',.4]]){
    const m=model.create({mode,I1:.3,I2:.5,I3:.7,w1:1,w2:.4,w3:6,tilt:.8,tiltTorque}),a=m.invariants();
    let axialChange=0;
    for(let i=0;i<300;i++){
      m.step(.05);const b=m.invariants();near(b.energy/a.energy,1,3e-7);near(b.verticalAngularMomentum/a.verticalAngularMomentum,1,3e-7);
      axialChange=Math.max(axialChange,Math.abs(b.bodyAxialAngularMomentum-a.bodyAxialAngularMomentum));
    }
    assert.ok(axialChange>.01,'Asymmetric top axial angular momentum evolves');
    assert.equal(m.geometry().steadyPrecession,null);
  }
});

test('CM top near-horizontal preset has actual steady precession (tilt 3e-8 rad, rate 3e-7 rad/s over 6 s)',()=>{
  const p=model.presets.find(p=>p.id==='cm-top').values,m=model.create(p),g=m.geometry();
  const rate=steadyPrecessionRates(g.principalMoments,p.w3,1,1,p.tiltTorque,p.tilt).slow;
  for(let i=0;i<120;i++){m.step(.05);near(m.sample().theta,p.tilt,3e-8);near(m.sample().precessionRate,rate,3e-7);}
});

test('live ZYZ readouts reconstruct attitude including both pole gauges (2e-8); flags distinguish nonunique pole angles',()=>{
  for(const tilt of [0,.7,Math.PI]){
    const m=model.create({tilt,azimuth:.6,phase:-.4,w1:0,w2:0,w3:0}),s=m.sample(),q=m.geometry().quaternion;
    const [w,x,y,z]=q,phi=s.phi,psi=s.psi,c=Math.cos(s.theta),st=Math.sin(s.theta);
    const reconstructedX=[Math.cos(phi)*c*Math.cos(psi)-Math.sin(phi)*Math.sin(psi),Math.sin(phi)*c*Math.cos(psi)+Math.cos(phi)*Math.sin(psi),-st*Math.cos(psi)];
    near(distance(reconstructedX,[1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y)]),0,2e-8);
    assert.equal(s.eulerRegular,tilt===.7?1:0);
    if(tilt===.7){near(s.phi,.6,1e-14);near(s.psi,-.4,1e-14);}
  }
});

test('prepareUpdate rejects invalid candidates without mutating live params or state; valid commit is explicit (exact)',()=>{
  const p=Object.freeze({...model.presets[0].values}),live=model.create(p);live.step(.1);const before=live.sample();
  for(const patch of [{I1:.0001,I2:.0001,I3:1,shape:'custom'},{mode:'heavy-top',initial:'fast'},null]){
    const result=prepareUpdate(p,patch);assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_ROTATION_SETUP');assert.equal(typeof result.error.message,'string');assert.deepEqual(live.sample(),before);
  }
  const prepared=prepareUpdate(p,{w2:3});assert.equal(prepared.ok,true);assert.equal(prepared.values.w2,3);assert.equal(prepared.instance.t,0);assert.equal(p.w2,4);assert.deepEqual(live.sample(),before);
});

test('timeline sampling is lazy, batched, cancellable and independent; samples match direct integration (1e-12)',()=>{
  const p=model.presets.find(p=>p.id==='asymmetric-top').values,live=model.create(p),before=live.sample();
  let calls=0;const original=model.create;
  try {
    model.create=values=>{const instance=original(values),step=instance.step;instance.step=dt=>{calls++;return step(dt);};return instance;};
    const stream=sampleBatches(p,{duration:60,interval:.03,batchSize:3});assert.equal(calls,0);
    assert.equal(stream.next().value.length,3);assert.equal(calls,2);stream.return();assert.equal(stream.next().done,true);assert.equal(calls,2);
  } finally {model.create=original;}
  const chunks=[...sampleBatches(p,{duration:.2,interval:.03,batchSize:3})];assert.deepEqual(chunks.map(a=>a.length),[3,3,2]);
  const samples=chunks.flat(),direct=model.create(p);near(samples.at(-1).t,.2,0);
  for(const sample of samples){direct.step(sample.t-direct.t);near(sample.energy,direct.sample().energy,1e-12);near(sample.w1,direct.sample().w1,1e-12);}
  assert.deepEqual(live.sample(),before);
  for(const options of [{duration:61},{duration:-1},{interval:0},{batchSize:0},{batchSize:121}])assert.throws(()=>sampleBatches(p,options),RangeError);
});

test('spherical body analytic attitude after 3 s (2e-9 quaternion distance); rest and vertical states remain finite (1e-12)',()=>{
  const m=model.create({I1:.4,I2:.4,I3:.4,w1:0,w2:0,w3:3,tilt:0,azimuth:0,phase:0});
  m.step(3);near(distance(m.geometry().quaternion,[Math.cos(4.5),0,0,Math.sin(4.5)]),0,2e-9);
  for(const mode of ['free','heavy-top','fixed-axis']){
    const rest=model.create({mode,shape:'symmetric-top',tilt:0,w1:0,w2:0,w3:0});
    rest.step(1);for(const v of Object.values(rest.sample()))assert.ok(Number.isFinite(v));
    near(rest.sample().omega,0,1e-12);near(rest.sample().theta,0,1e-12);
  }
});

test('signed and horizontal steady rates (quadratic residual 2e-13); gravity plus applied torque energy/work balance (2e-7 J)',()=>{
  const I=[.3,.3,.2];
  for(const theta of [.6,2,Math.PI/2]){
    const rates=steadyPrecessionRates(I,-20,1,9.81,.2,theta);
    for(const rate of [rates.slow,rates.fast].filter(v=>v!==null))near(I[0]*Math.cos(theta)*rate**2-I[2]*(-20)*rate+9.81*.2,0,2e-13);
  }
  const p=model.presets.find(p=>p.id==='nutation').values,m=model.create({...p,torquex:.03,torquey:-.02});
  const start=m.sample();advance(m,3);const end=m.sample();near(end.energy-start.energy,end.work,2e-7);
});
