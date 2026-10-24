import test from 'node:test';
import assert from 'node:assert/strict';
import {model} from '../../static/js/experiments/anharmonic/model.js';
const near=(a,b,tol)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}; tolerance ${tol}`);
function measuredPeriod(a,center=0){let prev=a.sample(),crossings=[];while(a.t<40&&crossings.length<2){a.step(.003);const s=a.sample();if(prev.x>center&&s.x<=center)crossings.push(prev.t+(s.t-prev.t)*(prev.x-center)/(prev.x-s.x));prev=s;}assert.equal(crossings.length,2);return crossings[1]-crossings[0];}
test('anharmonic: harmonic analytic trajectory/period, tolerances 5e-6 m / 2e-6 s',()=>{const a=model.create({quartic:0});near(a.period(),2*Math.PI,2e-6);a.step(30);near(a.sample().x,Math.cos(30),5e-6);});
test('anharmonic: quadrature and trajectory period vs amplitude; tolerance 2e-5 s',()=>{
  let previous=Infinity;for(const x0 of [.2,.7,1.5]){const a=model.create({x0}),T=a.period();assert.ok(T<previous);previous=T;near(measuredPeriod(a),T,2e-5);}
});
test('anharmonic: pure quartic period scales inversely with amplitude; relative tolerance 2e-8',()=>{const a=model.create({k:0,x0:.5}),b=model.create({k:0,x0:1});near(a.period()/b.period(),2,2e-8);});
test('anharmonic: Morse analytic period and dissociation; tolerance 2e-7 s',()=>{const a=model.create({potential:'morse',x0:1}),E=a.sample().energy;near(a.period(),2*Math.PI/Math.sqrt(2*(1-E)),2e-7);assert.equal(a.periodAtEnergy(1,0),Infinity);near(measuredPeriod(a),a.period(),2e-5);});
test('anharmonic: all potential forces equal -dU/dx; tolerance 3e-6 N',()=>{
  for(const potential of ['polynomial','morse','lennard-jones','walls','van-der-pol']){const a=model.create({potential,x0:1.25,cubic:.2}),x=1.25,dx=1e-6;near(a.restoringForce(x),-(a.potential(x+dx)-a.potential(x-dx))/(2*dx),3e-6);}
});
test('anharmonic: conservative energy across polynomial, Morse, LJ, walls; tolerance 2e-5 J',()=>{
  for(const preset of model.presets.filter(p=>!['duffing','limit-cycle'].includes(p.id))){const a=model.create(preset.values),E=a.sample().energy;a.step(30);near(a.sample().energy,E,2e-5);}
});
test('anharmonic: repulsive LJ core stays positive, energy drift < 2e-7 J; singular refusal preserves state exactly',()=>{
  const a=model.create({potential:'lennard-jones',x0:.9}),E=a.sample().energy;a.step(10);assert.ok(a.sample().x>0);near(a.sample().energy,E,2e-7);
  const b=model.create({potential:'lennard-jones',x0:1e-6}),start=b.sample();assert.throws(()=>b.step(.01),RangeError);assert.deepEqual(b.sample(),start);
});
test('anharmonic: turning points select current well and match energy; tolerance 2e-10 J',()=>{const a=model.create(model.presets.find(p=>p.id==='double-well').values),E=a.sample().energy,[left,right]=a.turningPoints();assert.ok(left>0&&right>left);near(a.potential(left),E,2e-10);near(a.potential(right),E,2e-10);assert.ok(Number.isFinite(a.period()));});
test('anharmonic: separatrix infinite (exact); equilibrium period tolerance 2e-9 s',()=>{const a=model.create({k:-1,quartic:1,x0:1});assert.equal(a.periodAtEnergy(0,1),Infinity);near(a.periodAtEnergy(-.25,1),2*Math.PI/Math.sqrt(2),2e-9);});
test('anharmonic: driven linear amplitude/phase and work balance; tolerances 2e-8 m / 1e-7 J',()=>{const a=model.create({quartic:0,k:4,damping:.5,drive:.2,driveOmega:1.2,x0:0});a.step(100);const phase=Math.atan2(.5*1.2,4-1.2**2),A=.2/Math.hypot(4-1.2**2,.5*1.2);near(a.sample().x,A*Math.cos(120-phase),2e-8);near(a.sample().v,-1.2*A*Math.sin(120-phase),2e-8);near(a.invariants().energyBalance,0,1e-7);assert.equal(a.period(),null);});
test('anharmonic: active Van der Pol transfer is signed; grows from small initial displacement; balance < 1e-7 J',()=>{const a=model.create(model.presets.find(p=>p.id==='limit-cycle').values),initial=a.sample().energy;a.step(10);assert.ok(a.sample().energy>10*initial);assert.ok(a.sample().heat<0);near(a.invariants().energyBalance,0,1e-7);});
test('anharmonic: exact stroboscopic phase, tolerance 1e-12 s',()=>{const a=model.create({drive:.2});a.step(20);assert.equal(a.section().length,3);a.section().forEach((p,i)=>near(p.t,2*Math.PI*(i+1),1e-12));});
test('anharmonic: all presets contract and reset; exact dt tolerance 1e-14 s',()=>{for(const preset of model.presets){const a=model.create(preset.values),initial=a.sample();a.step(.137);near(a.t,.137,1e-14);for(const o of model.observables)assert.ok(Number.isFinite(a.sample()[o.key]),o.key);assert.ok(a.geometry().position.every(Number.isFinite));a.reset();assert.deepEqual(a.sample(),initial);}assert.throws(()=>model.create({potential:'lennard-jones',x0:0}));assert.throws(()=>model.create({potential:1.5}));});
