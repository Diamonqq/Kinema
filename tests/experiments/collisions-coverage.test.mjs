import test from 'node:test';
import assert from 'node:assert/strict';
import {model,interactionAt,scatteringCurve,differentialCrossSection,sweepValues,collisionSweep,collisionTrace,rutherfordAngle}
  from '../../static/js/experiments/collisions/model.js';
const defaults=Object.fromEntries(model.params.map(p=>[p.key,p.value]));
const close=(a,b,tol,label='')=>assert.ok(Math.abs(a-b)<=tol,`${label}: ${a} vs ${b}, tolerance ${tol}`);
const run=(s,time,dt=.1)=>{for(let t=0;t<time;){const h=Math.min(dt,time-t);s.step(h);t+=h;}};

test('Coulomb combinations obey -dU/dr (relative 2e-6) and conserve energy including hard-core contact (3e-5)',()=>{
  for(const secondInteraction of ['woods-saxon','yukawa','hard','soft']) {
    const p={...defaults,interaction:'coulomb',secondInteraction,strength:.2,b:.2};
    for(const r of [.3,.7,1.2]) {
      const dr=1e-6,a=interactionAt(p,r),gradient=-(interactionAt(p,r+dr).potential-interactionAt(p,r-dr).potential)/(2*dr);
      close(a.force,gradient,Math.max(1e-7,Math.abs(a.force)*2e-6));
    }
    const s=model.create(p),initial=s.invariants();run(s,12);const end=s.invariants();
    close((end.energy+end.dissipated)/initial.energy,1,3e-5,secondInteraction);
    close(end.angularMomentum/initial.angularMomentum,1,1e-10);
    if(secondInteraction==='hard')assert.equal(s.sample().contactCount,1);
  }
  assert.throws(()=>model.create({interaction:'soft',secondInteraction:'yukawa'}),RangeError);
  const geometry=model.create({interaction:'coulomb',secondInteraction:'hard',secondRange:2}).geometry();
  for(const body of geometry.bodies)close(body.radius,1,0,'secondary contact radius');
});

test('numerically integrated elastic hard sphere gives dσ/dΩ=R²/4 within 0.001 m²',()=>{
  const b=sweepValues(.1,.9,81),curve=scatteringCurve({interaction:'hard'},b,{duration:12,dt:.2});
  const section=differentialCrossSection(curve);
  assert.ok(section.every(v=>v.available));
  for(const row of section)close(row.sigma,.25,.001);
  close(section[30].logSigma,Math.log(section[30].sigma),0);
});

test('cross-section Jacobian recovers Rutherford formula on a nonuniform grid (relative 0.0001)',()=>{
  const p={...defaults,interaction:'coulomb',m2:3},mu=p.m1*p.m2/(p.m1+p.m2),c=Math.abs(p.strength*p.range)/(2*mu*p.speed**2);
  const points=Array.from({length:301},(_,i)=>.2+2.8*(i/300)**2)
    .map(b=>({b,angle:rutherfordAngle({...p,b}),complete:true}));
  const out=differentialCrossSection(points);
  for(const row of out.slice(1,-1))close(row.sigma/(c*c/Math.sin(row.angle/2)**4),1,.0001);
});

test('incomplete, forward and turning-point cross sections are explicitly unavailable; lab angle supported',()=>{
  const curve=[.2,.4,.6].map(b=>({b,angle:.3,labAngle:.2,labAngleAvailable:true,complete:true}));
  assert.ok(differentialCrossSection(curve).every(p=>!p.available));
  curve[1].complete=false;assert.ok(differentialCrossSection(curve).every(p=>p.reason==='unfinished'));
  const branch=[.2,.4,.6].map((b,i)=>({b,angle:[.2,.5,.3][i],complete:true}));
  assert.equal(differentialCrossSection(branch)[1].reason,'branch-turning-point');
  const numeric=scatteringCurve({},[.2,.4,.6],{duration:12});
  assert.ok(differentialCrossSection(numeric,{frame:'lab'}).every(p=>p.available));
  assert.throws(()=>differentialCrossSection([numeric[1],numeric[0],numeric[2]]),RangeError);
});

test('all original sweep dimensions, concentrated/geometry grids, traces and overlays are serializable and bounded',()=>{
  close(sweepValues(1,100,3,{scale:'geometric'})[1],10,1e-12);
  close(sweepValues(0,1,3,{concentration:3})[1],.125,0);
  const choices={b:[.2,.4],speed:[1,3],m2:[1,5],strength:[.5,2],range:[.5,1.5],diffuseness:[.1,.3],
    interaction:['coulomb','woods-saxon'],secondStrength:[-1,-2],secondRange:[.5,1]};
  for(const [key,list] of Object.entries(choices)) {
    const result=collisionSweep({interaction:'coulomb',secondInteraction:key==='interaction'?'none':'woods-saxon'},key,list,{duration:.2});
    assert.equal(result.length,2);assert.ok(result.every(v=>Number.isFinite(v.angle)));
    assert.doesNotThrow(()=>JSON.stringify(result));
  }
  const a=collisionTrace({}, {duration:8,dt:.1}),b=collisionTrace({b:.7},{duration:8,dt:.1});
  assert.ok(a.samples.length>80&&a.samples.length<=82);assert.equal(a.complete,true);
  assert.doesNotThrow(()=>JSON.parse(JSON.stringify([a,b])));
  assert.throws(()=>collisionTrace({}, {duration:6000,dt:.001}),RangeError);
});
