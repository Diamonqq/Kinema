import test from 'node:test';
import assert from 'node:assert/strict';
import {model,interactionAt,rutherfordAngle,scatteringCurve} from '../../static/js/experiments/collisions/model.js';
const close=(a,b,tol,message='')=>assert.ok(Math.abs(a-b)<=tol,`${message}: ${a} vs ${b}, tolerance ${tol}`);
const defaults=Object.fromEntries(model.params.map(p=>[p.key,p.value]));
const run=(s,total,dt)=>{for(let t=0;t<total;) {const h=Math.min(dt,total-t);s.step(h);t+=h;}};

test('analytic unequal-mass head-on elastic velocities and momentum/energy (1e-12)',()=>{
  for(const [m1,m2,u1,u2] of [[1,1,2,0],[2,3,4,-1],[1,10,3,0]]) {
    const s=model.create({m1,m2,speed:u1,targetSpeed:u2,b:0}),initial=s.invariants();
    s.step(10);const q=s.sample(),M=m1+m2;
    close(q.vx1,((m1-m2)*u1+2*m2*u2)/M,1e-12);
    close(q.vx2,(2*m1*u1+(m2-m1)*u2)/M,1e-12);
    close(q.py,0,1e-12);close(q.px,initial.momentum.x,1e-12);
    close(q.energy,initial.energy,1e-12);assert.equal(q.contactCount,1);
  }
});

test('2D glancing velocities from normal impulse, perpendicular equal-mass outputs (1e-12)',()=>{
  const s=model.create({b:.6}),nx=-.8,ny=.6,normal=2*nx;
  s.step(10);const q=s.sample();
  close(q.vx1,2-normal*nx,1e-12);close(q.vy1,-normal*ny,1e-12);
  close(q.vx2,normal*nx,1e-12);close(q.vy2,normal*ny,1e-12);
  close(q.vx1*q.vx2+q.vy1*q.vy2,0,1e-12);
});

test('CM speeds unchanged by elastic impact and frame transforms consistent (1e-12)',()=>{
  const s=model.create({m1:2,m2:5,b:.7}),before=s.sample();s.step(10);const after=s.sample();
  close(after.cmSpeed1,before.cmSpeed1,1e-12);close(after.cmSpeed2,before.cmSpeed2,1e-12);
  const {lab,cm}=s.geometry().frames;
  for(let i=0;i<2;i++) {close(lab[i].vx-cm[i].vx,4/7,1e-12);close(lab[i].vy,cm[i].vy,1e-12);}
  close(2*cm[0].x+5*cm[1].x,0,1e-12);
});

test('restitution dissipates (1-e²) μ u_n²/2, conserves momentum, tangential velocity (2e-12 J)',()=>{
  for(const restitution of [0,.3,1]) {
    const s=model.create({m1:2,m2:3,b:.6,restitution}),before=s.invariants();s.step(10);
    const q=s.sample(),loss=(1-restitution**2)*(6/5)*(2*.8)**2/2;
    close(q.dissipated,loss,2e-12);close(q.energy+q.dissipated,before.energy,2e-12);
    close(q.px,before.momentum.x,1e-12);close(q.py,0,1e-12);
    const r=s.geometry().relative;close(r.vx*.6+r.vy*.8,2*.6,1e-12);
  }
});

test('continuous collision detection prevents tunnelling; grazing/miss and partition equivalence (2e-11)',()=>{
  const a=model.create({b:.4}),b=model.create({b:.4});a.step(10);run(b,10,.013);
  for(const key of ['vx1','vy1','vx2','vy2','separation']) close(a.sample()[key],b.sample()[key],2e-11);
  for(const impact of [1,1.1,-1.1]) {
    const s=model.create({b:impact});s.step(10);close(s.sample().vx1,2,1e-12);close(s.sample().vy1,0,1e-12);
  }
});

test('every smooth force equals -dU/dr (relative 2e-6, absolute 2e-7 N), continuous charge surface',()=>{
  for(const interaction of ['soft','coulomb','shielded','truncated','power','yukawa','woods-saxon'])
    for(const strength of [-2,2]) for(const power of [-3,-1,.5]) for(const r of [.3,.8,1.2,3]) {
      const p={...defaults,interaction,strength,power},dr=1e-6;
      const gradient=-(interactionAt(p,r+dr).potential-interactionAt(p,r-dr).potential)/(2*dr);
      const force=interactionAt(p,r).force;
      close(force,gradient,Math.max(2e-7,Math.abs(force)*2e-6),`${interaction}, r=${r}`);
    }
  const p={...defaults,interaction:'truncated'};
  close(interactionAt(p,1-1e-8).potential,interactionAt(p,1+1e-8).potential,3e-8);
  close(interactionAt(p,1-1e-8).force,interactionAt(p,1+1e-8).force,4e-8);
});

test('Rutherford numerical scattering versus analytic angle at three b (0.003 rad); E/L conservation (3e-6)',()=>{
  for(const b of [.5,1,2]) {
    const p={interaction:'coulomb',b,distance:1000,speed:2,m1:1,m2:3},s=model.create(p);
    const initial=s.invariants();run(s,1100,1);
    const rel=s.geometry().relative,angle=Math.abs(Math.atan2(rel.vy,rel.vx));
    close(angle,rutherfordAngle({...defaults,...p}),.003,`b=${b}`);
    close(s.invariants().energy/initial.energy,1,3e-6);
    close(s.invariants().angularMomentum/initial.angularMomentum,1,3e-9);
  }
});

test('smooth interactions conserve E/L in complete encounters, relative energy tolerance 2e-5',()=>{
  for(const [interaction,strength,b] of [['soft',1,.4],['shielded',1,.8],['yukawa',-1,.8],
    ['woods-saxon',-2,.8],['truncated',-1,.5],['power',1,.7]]) {
    const s=model.create({interaction,strength,b,distance:10}),initial=s.invariants();run(s,15,.1);
    const final=s.invariants();close(final.energy/initial.energy,1,2e-5,interaction);
    close(final.angularMomentum/initial.angularMomentum,1,2e-10,interaction);
    assert.equal(s.sample().status,'running');
  }
});

test('curves mark unfinished trajectories; complete hard-sphere curve agrees with geometry (1e-12 rad)',()=>{
  const points=scatteringCurve({interaction:'hard'},[0,.5,2],{duration:12,dt:.1});
  assert.ok(points.every(p=>p.complete));
  close(Math.abs(points[0].angle),Math.PI,1e-12);
  close(Math.abs(points[1].angle),2*Math.acos(.5),1e-12);close(points[2].angle,0,1e-12);
  assert.equal(scatteringCurve({},[0],{duration:.1})[0].complete,false);
});

test('all presets finite and reset; exact dt; invalid parameters and requests reject',()=>{
  for(const preset of model.presets) {
    const s=model.create(preset.values),initial=s.sample();s.step(.123);close(s.t,.123,0);
    for(const d of model.observables) assert.ok(Number.isFinite(s.sample()[d.key]),`${preset.id}/${d.key}`);
    s.reset();assert.deepEqual(s.sample(),initial);
  }
  for(const value of [{interaction:'bad'},{m1:NaN},{b:Infinity},{extra:1}]) assert.throws(()=>model.create(value),RangeError);
  const s=model.create();for(const dt of [-1,NaN,Infinity,61]) assert.throws(()=>s.step(dt),RangeError);
  assert.equal(s.t,0);assert.throws(()=>scatteringCurve({},[0],{dt:0}),RangeError);
});

test('head-on singular attraction freezes explicitly; never passes off an incomplete curve as final',()=>{
  const s=model.create({interaction:'coulomb',strength:-1,b:0});run(s,6,.1);
  assert.equal(s.sample().status,'close-encounter');
  assert.ok(s.sample().separation>0);
  for(const d of model.observables) assert.ok(Number.isFinite(s.sample()[d.key]),d.key);
  const r=s.geometry().relative;s.step(.2);assert.deepEqual(s.geometry().relative,r);
  const point=scatteringCurve({interaction:'coulomb',strength:-1},[0],{duration:6})[0];
  assert.equal(point.complete,false);assert.equal(point.status,'close-encounter');
});

test('every single-parameter range endpoint stays finite at 16 ms; all preset steps aligned (1e-6)',()=>{
  for(const p of model.params.filter(p=>!p.options)) {
    assert.ok(p.unit!==undefined && p.symbol!==undefined);
    for(const value of [p.min,p.max]) {
      const s=model.create({[p.key]:value});s.step(.016);
      for(const o of model.observables) assert.ok(Number.isFinite(s.sample()[o.key]),`${p.key}/${value}/${o.key}`);
    }
    for(const preset of model.presets) {
      const n=(preset.values[p.key]-p.min)/p.step;
      close(n,Math.round(n),1e-6,`${preset.id}/${p.key} step alignment`);
    }
  }
});
