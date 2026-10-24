import test from 'node:test';
import assert from 'node:assert/strict';
import {model,curveForces,speedLimits,trackPoint} from '../../static/js/experiments/race-track/model.js';
const near=(a,b,tol)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}, absolute tolerance ${tol}`);
test('banked maximum/minimum speed and design speed formulas (absolute 1e-10 m/s)',()=>{
  const r=60,mu=.4,g=9.81,theta=25*Math.PI/180,s=speedLimits({radius:r,bank:25,mu,gravity:g});
  near(s.maxSpeed,Math.sqrt(r*g*(Math.tan(theta)+mu)/(1-mu*Math.tan(theta))),1e-10);
  near(s.minSpeed,Math.sqrt(r*g*(Math.tan(theta)-mu)/(1+mu*Math.tan(theta))),1e-10);
  near(s.idealSpeed,Math.sqrt(r*g*Math.tan(theta)),1e-10);
  const flat=speedLimits({radius:r,mu});near(flat.maxSpeed,Math.sqrt(mu*g*r),1e-10);near(flat.minSpeed,0,0);
});
test('banked normal/friction decomposition satisfies inward and vertical Newton equations (absolute 1e-8 N)',()=>{
  for(const speed of [5,15,25]){const f=curveForces({mass:900,speed,radius:50,bank:20});near(f.inward,900*speed**2/50,1e-8);near(f.vertical,900*9.81,1e-8);}
  const ideal=speedLimits({radius:50,bank:20,mu:0}).idealSpeed;near(curveForces({speed:ideal,radius:50,bank:20,mu:0}).lateral,0,1e-8);
  assert.ok(curveForces({speed:5,bank:20}).lateral<0);assert.ok(curveForces({speed:25,bank:20}).lateral>0);
});
test('friction circle clips drive/braking to remaining grip (absolute 1e-8 N)',()=>{
  for(const drive of [-15000,15000]){const f=curveForces({mass:1000,speed:15,radius:50,bank:0,mu:.8,drive});assert.ok(f.grip);near(f.friction,f.capacity,1e-8);near(f.longitudinal**2+f.lateral**2,f.capacity**2,1e-7);assert.equal(Math.sign(f.longitudinal),Math.sign(drive));}
});
test('constant-speed lap time and distance across straights/arcs (absolute 1e-7 s/m)',()=>{
  const i=model.create({speed:15,halfStraight:50,radius:50}),length=200+100*Math.PI,T=length/15;i.step(T+.1);const s=i.sample();assert.equal(s.lostGrip,false);near(s.lapTime,T,1e-7);near(s.distance,15*(T+.1),1e-7);near(s.energyError,0,1e-8);assert.equal(s.laps,1);
});
test('oval joins have continuous position/tangent (absolute 2.1e-6 m, 1e-6 rad)',()=>{
  for(const q of [50,50+50*Math.PI,150+50*Math.PI,150+100*Math.PI,200+100*Math.PI]){const a=trackPoint(q-1e-6),b=trackPoint(q+1e-6);near(Math.hypot(a.x-b.x,a.y-b.y),2e-6,1e-7);near(Math.cos(a.heading),Math.cos(b.heading),1e-6);near(Math.sin(a.heading),Math.sin(b.heading),1e-6);}
});
test('initial overspeed and underspeed bank demand end valid lap; clock remains exact (no numeric tolerance)',()=>{
  for(const p of [{speed:30,mu:.1,halfStraight:0},{speed:0,bank:30,mu:.1,halfStraight:0}]){const i=model.create(p);i.step(1);const s=i.sample();assert.equal(s.lostGrip,true);assert.equal(s.activeTime,0);assert.equal(i.t,1);assert.equal(i.geometry().validLap,false);}
});
test('overspeed on straight stops at corner entry (absolute 1e-7 m and s)',()=>{
  const i=model.create({speed:30,halfStraight:50,mu:.1});i.step(5);const s=i.sample();assert.equal(s.lostGrip,true);near(s.distance,50,1e-7);near(s.activeTime,50/30,1e-7);assert.equal(s.lapTime,0);
});
test('coasting analytic quadratic drag and dissipated energy (absolute 1e-7 m/s, 1e-5 J)',()=>{
  const i=model.create({mass:1000,speed:15,drag:2,halfStraight:300});i.step(5);const s=i.sample();near(s.speed,15/(1+2*15*5/1000),1e-7);near(s.energyError,0,1e-5);assert.ok(s.dissipatedWork>0);near(s.driveWork,0,0);
});
test('drive + rolling + drag energy ledger, including braking (absolute .02 J)',()=>{
  for(const drive of [-5000,3000]){const i=model.create({drive,drag:.5,rolling:.01,speed:15,halfStraight:300});i.step(2);near(i.invariants().energyError,0,.02);assert.ok(i.sample().dissipatedWork>0);}
});
test('braking never reverses car and energy ledger remains closed (absolute .1 J, 1e-8 m/s)',()=>{
  const i=model.create({drive:-5000,speed:10,halfStraight:300});i.step(8);near(i.sample().speed,0,1e-8);near(i.invariants().energyError,0,.1);assert.ok(i.sample().distance>0);
});
test('all presets obey contract and reset; invalid inputs reject',()=>{
  for(const p of model.presets){const i=model.create(p.values);i.step(.5);for(const d of model.observables)assert.ok(Number.isFinite(i.sample()[d.key]),`${p.id}:${d.key}`);i.reset();assert.equal(i.t,0);near(i.sample().distance,0,0);}
  assert.throws(()=>model.create({mu:-1}),RangeError);assert.throws(()=>model.create({speed:NaN}),RangeError);assert.throws(()=>model.create().step(-1),RangeError);
});
