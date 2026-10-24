import test from 'node:test';
import assert from 'node:assert/strict';
import {model} from '../../static/js/experiments/motion-generator/model.js';
import {model as pendulum} from '../../static/js/experiments/pendulum/model.js';
import {model as anharmonic} from '../../static/js/experiments/anharmonic/model.js';
const near=(a,b,tol)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}; tolerance ${tol}`);
test('all three schemas: kit-compatible string enums and preset/default numeric grids (step fraction < 1e-7)',()=>{
  for(const m of [model,pendulum,anharmonic])for(const values of [Object.fromEntries(m.params.map(p=>[p.key,p.value])),...m.presets.map(p=>p.values)])for(const p of m.params){
    const v=values[p.key];if(p.options){assert.equal(typeof v,'string');assert.ok(p.options.some(o=>o.value===v));}
    else {assert.ok(v>=p.min&&v<=p.max,`${m.id} ${p.key} range`);near((v-p.min)/p.step,Math.round((v-p.min)/p.step),1e-7);}
  }
});
test('motion: constant acceleration in 1D/2D, absolute tolerance 2e-9 SI',()=>{
  for(const dimensions of [1,2]){const a=model.create({dimensions:dimensions===1?'1d':'2d',spring:0,x0:2,y0:3,vx0:4,vy0:5,gravity:9.81});a.step(2);const s=a.sample();near(s.x,dimensions===1?2+8-9.81*2:10,2e-9);near(s.y,dimensions===1?0:3+10-9.81*2,2e-9);near(a.invariants().energyBalance,0,2e-8);}
});
test('motion: linear drag terminal velocity and position, tolerance 2e-9',()=>{
  const a=model.create({spring:0,x0:10,gravity:9.81,linearDrag:2});a.step(8);near(a.sample().vx,-9.81/2*(1-Math.exp(-16)),2e-9);near(a.sample().x,10-9.81/2*(8-(1-Math.exp(-16))/2),2e-9);near(a.invariants().energyBalance,0,2e-8);
});
test('motion: quadratic drag matches tanh solution, tolerance 2e-9',()=>{
  const a=model.create({spring:0,gravity:9.81,quadraticDrag:.5});a.step(3);near(a.sample().vx,-Math.sqrt(9.81/.5)*Math.tanh(Math.sqrt(9.81*.5)*3),2e-9);
});
test('motion: magnetic circle has correct handedness/radius and no work; tolerance 2e-9',()=>{
  const a=model.create({dimensions:'2d',spring:0,x0:0,vx0:1,magnetic:1});a.step(Math.PI/2);const s=a.sample();near(s.x,1,2e-9);near(s.y,-1,2e-9);near(s.speed,1,2e-9);near(s.energy,.5,2e-9);
});
test('motion: harmonic solution/energy over 100 s; tolerances 5e-6 m and 2e-7 J',()=>{
  const a=model.create();a.step(100);near(a.sample().x,Math.cos(100),5e-6);near(a.invariants().energy,.5,2e-7);
});
test('motion: softened central force conserves energy and angular momentum; 2e-7 / 2e-11',()=>{
  const a=model.create(model.presets.find(p=>p.id==='orbit').values),start=a.invariants();a.step(40);near(a.invariants().energy,start.energy,2e-7);near(a.invariants().angularMomentum,start.angularMomentum,2e-11);
});
test('motion: combined forces and ramp account for heat/work; residual < 1e-7 J',()=>{
  const a=model.create({dimensions:'2d',x0:.4,y0:.3,cubic:.5,linearDrag:.2,quadraticDrag:.1,magnetic:.7,gravity:.2,forceX:.3,forceY:.2,ramp:.1,drive:.2});a.step(10);near(a.invariants().energyBalance,0,1e-7);
});
test('motion: constant and cubic restoring terms agree with -dU/dx; tolerance 2e-8 N',()=>{
  const args={x0:.7,cubic:.4,constantRestoring:.2},dx=1e-5,a=model.create(args);const grad=(model.create({...args,x0:.7+dx}).sample().potential-model.create({...args,x0:.7-dx}).sample().potential)/(2*dx);near(a.sample().ax,-grad,2e-8);
});
test('motion: contract, validation, exact dt and reset; time tolerance 1e-14',()=>{
  assert.throws(()=>model.create({mass:0}));assert.throws(()=>model.create({dimensions:1.5}));assert.throws(()=>model.create({x0:NaN}));assert.throws(()=>model.create({bad:1}));
  for(const preset of model.presets){const a=model.create(preset.values),start=a.sample();a.step(.137);near(a.t,.137,1e-14);for(const o of model.observables)assert.ok(Number.isFinite(a.sample()[o.key]),o.key);assert.ok(a.geometry().position.every(Number.isFinite));a.reset();assert.deepEqual(a.sample(),start);assert.throws(()=>a.step(-1));assert.throws(()=>a.step(Infinity));}
});
test('motion coverage: 3D oscillator solution and angular momentum vector; tolerances 5e-6 m, 2e-10 SI',()=>{
  const a=model.create({dimensions:'3d',y0:.5,z0:.3,vy0:.4,vz0:.7}),L=a.invariants().angularMomentumVector;a.step(20);const s=a.sample();near(s.z,.3*Math.cos(20)+.7*Math.sin(20),5e-6);near(s.y,.5*Math.cos(20)+.4*Math.sin(20),5e-6);a.invariants().angularMomentumVector.forEach((v,i)=>near(v,L[i],2e-10));
});
test('motion coverage: ramp, cusp and destabilizing spring analytic examples; tolerances 1e-6 / 8e-4 / 2e-6 m',()=>{
  const ramp=model.create({spring:0,x0:0,ramp:1});ramp.step(2);near(ramp.sample().x,8/6,1e-6);
  const cusp=model.create({spring:0,constantRestoring:1});cusp.step(1.6);const u=1.6-Math.sqrt(2);near(cusp.sample().x,-Math.sqrt(2)*u+u*u/2,8e-4);
  const outward=model.create({spring:-1});outward.step(1);near(outward.sample().x,Math.cosh(1),2e-6);
});
test('motion coverage: Euler/RK2/RK4 errors converge in expected order; RK4 absolute error < 2e-6 m',()=>{
  const errors=['euler','rk2','rk4'].map(method=>{const a=model.create({method,timeStep:.05});a.step(2);return Math.abs(a.sample().x-Math.cos(2));});assert.ok(errors[0]>10*errors[1]);assert.ok(errors[1]>100*errors[2]);assert.ok(errors[2]<2e-6);
});
