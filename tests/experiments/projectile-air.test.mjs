import test from 'node:test';
import assert from 'node:assert/strict';
import {model,flight,rangeCurve,terminalVelocity,resolve,airDensity,sphereCd} from '../../static/js/experiments/projectile-air/model.js';
const near=(a,b,tol)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}, absolute tolerance ${tol}`);
test('vacuum range, apex, flight time (absolute 1e-7 m, 1e-8 s)',()=>{
  const speed=40,angle=35,g=9.81,a=angle*Math.PI/180,s=flight({drag:'vacuum',speed,angle});
  assert.equal(s.landed,true);near(s.range,speed**2*Math.sin(2*a)/g,1e-7);near(s.apex,(speed*Math.sin(a))**2/(2*g),1e-7);near(s.flightTime,2*speed*Math.sin(a)/g,1e-8);near(s.energyError,0,1e-7);
});
test('linear drag trajectory including wind agrees with closed form (absolute 1e-7 m and m/s)',()=>{
  const p={drag:'linear',linear:.07,mass:.145,speed:25,angle:50,height:100,wind:3};
  const i=model.create(p);i.step(2);const s=i.sample(),tau=p.mass/p.linear,a=p.angle*Math.PI/180,e=Math.exp(-2/tau),vx=p.speed*Math.cos(a),vy=p.speed*Math.sin(a);
  near(s.x,p.wind*2+(vx-p.wind)*tau*(1-e),1e-7);near(s.y,100+(vy+9.81*tau)*tau*(1-e)-9.81*tau*2,1e-7);near(s.vx,p.wind+(vx-p.wind)*e,1e-7);near(s.vy,(vy+9.81*tau)*e-9.81*tau,1e-7);
});
test('linear, quadratic, combined and sphere terminal descent (relative speed tolerance 1e-7)',()=>{
  for(const drag of ['linear','quadratic','combined','sphere']){
    const p={drag,linear:.2,speed:0,height:10000,mass:.145};const i=model.create(p);i.step(60);const s=i.sample(),v=terminalVelocity(p);assert.equal(s.landed,false);near(-s.vy,v,v*1e-7);
  }
});
test('quadratic range optimum is below 45° (1° grid; all flights landed)',()=>{
  const curve=rangeCurve({mass:.145,diameter:.074,speed:40,drag:'quadratic'},Array.from({length:41},(_,i)=>i+20));
  assert.ok(curve.every(x=>x.landed));const best=curve.reduce((a,b)=>a.range>b.range?a:b);assert.ok(best.angle<45&&best.angle>20,JSON.stringify(best));assert.ok(best.range>curve.find(x=>x.angle===45).range);
});
test('terminal speeds match independent algebraic force balance (absolute 1e-10 m/s)',()=>{
  const p=resolve({mass:.145,linear:.2}),k=.5*p.density*p.cd*Math.PI*p.diameter**2/4,mg=p.mass*p.gravity;
  near(terminalVelocity({...p,drag:'linear'}),mg/p.linear,1e-10);
  near(terminalVelocity({...p,drag:'quadratic'}),Math.sqrt(mg/k),1e-10);
  near(terminalVelocity({...p,drag:'combined'}),(-p.linear+Math.sqrt(p.linear**2+4*k*mg))/(2*k),1e-10);
});
test('wind + spin energy ledger includes positive drag heating and wind work (absolute 2e-5 J)',()=>{
  for(const wind of [-15,0,15]){const i=model.create({wind,spin:100,height:100,atmosphere:'exponential'});i.step(4);const s=i.sample();assert.ok(s.dissipatedWork>0);near(s.energyError,0,2e-5);const g=i.geometry();near(g.forces.lift.x*(s.vx-wind)+g.forces.lift.y*s.vy,0,1e-10);}
});
test('Re sphere Stokes limit, density scale and zero-speed force (relative 0.01 Cd, absolute 1e-12 density)',()=>{
  near(sphereCd(1e-6)*1e-6,24,.001);assert.ok(sphereCd(100000)>.3&&sphereCd(100000)<.6);
  const p=resolve({atmosphere:'exponential',scaleHeight:8500,altitude:1000});near(airDensity(p,7500),p.density/Math.E,1e-12);
  const i=model.create({drag:'sphere',speed:0,height:1});near(i.sample().ax,0,0);near(i.sample().ay,-9.81,0);
});
test('landing is frame-independent, clock advances exactly dt; reset restores state (absolute 2e-6 m/s/J)',()=>{
  const p={drag:'quadratic',height:2,angle:40};const a=model.create(p),b=model.create(p);a.step(15);for(let j=0;j<150;j++)b.step(.1);
  for(const key of ['x','y','vx','vy','flightTime','energy'])near(a.sample()[key],b.sample()[key],2e-6);
  assert.equal(a.t,15);const saved=a.sample();a.step(1);near(a.sample().x,saved.x,0);near(a.t,16,0);a.reset();near(a.t,0,0);near(a.sample().y,2,0);
});
test('vacuum ghost analytic, drag shortens range (absolute ghost 1e-9 m)',()=>{
  const i=model.create({height:2});i.step(2);const p=resolve({height:2}),a=p.angle*Math.PI/180,g=i.geometry();near(g.ghost.x,p.speed*Math.cos(a)*2,1e-9);near(g.ghost.y,2+p.speed*Math.sin(a)*2-.5*p.gravity*4,1e-9);assert.ok(g.position.x<g.ghost.x);
});
test('all presets expose finite state and contract methods; invalid inputs reject',()=>{
  for(const p of model.presets){assert.deepEqual(Object.keys(p.values).sort(),model.params.map(d=>d.key).sort());const i=model.create(p.values);i.step(.25);for(const d of model.observables)assert.ok(Number.isFinite(i.sample()[d.key]),`${p.id}:${d.key}`);assert.ok(i.geometry().radius>0);i.reset();assert.equal(i.t,0);}
  assert.throws(()=>model.create({mass:0}),RangeError);assert.throws(()=>model.create({drag:'magic'}),RangeError);assert.throws(()=>model.create().step(-1),RangeError);assert.throws(()=>model.create().step(Infinity),RangeError);
});
test('lift-dominated light object remains finite and closes energy (absolute .002 J)',()=>{
  const i=model.create({drag:'linear',linear:0,mass:.001,diameter:.5,spin:1000,speed:100,height:100});i.step(.02);
  for(const value of Object.values(i.invariants()))assert.ok(Number.isFinite(value));near(i.invariants().energyError,0,.002);
});
test('tiny positive dt advances physical state too (absolute 1e-24 m)',()=>{
  const i=model.create({drag:'vacuum',height:1,speed:1,angle:0});i.step(1e-13);near(i.sample().x,1e-13,1e-24);assert.equal(i.t,1e-13);
});


test('landing ends the timeline, stops motion and records inelastic impact loss (absolute 1e-6 J)',()=>{
 const i=model.create({drag:'vacuum',speed:20,angle:45});i.step(10);const q=i.sample();assert.equal(q.ended,true);assert.equal(q.vx,0);assert.equal(q.vy,0);assert.equal(q.speed,0);assert.equal(q.ax,0);assert.equal(q.ay,0);assert.ok(Math.abs(q.impactLoss-q.initialEnergy)<1e-6);assert.ok(Math.abs(q.energyError)<1e-6);const x=q.x;i.step(1);assert.equal(i.sample().x,x);assert.equal(i.geometry().velocity.x,0);i.reset();assert.equal(i.sample().ended,false);assert.equal(i.sample().impactLoss,0);
});
