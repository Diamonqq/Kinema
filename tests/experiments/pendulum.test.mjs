import test from 'node:test';
import assert from 'node:assert/strict';
import {model,exactPeriod} from '../../static/js/experiments/pendulum/model.js';
const near=(a,b,tol)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}; tolerance ${tol}`);
function measuredPeriod(a){let prev=a.sample(),crossings=[];while(a.t<30&&crossings.length<2){a.step(.004);const s=a.sample();if(prev.theta>0&&s.theta<=0)crossings.push(prev.t+(s.t-prev.t)*prev.theta/(prev.theta-s.theta));prev=s;}assert.equal(crossings.length,2);return crossings[1]-crossings[0];}
test('pendulum: small-angle period, relative tolerance 1e-6',()=>{const T=measuredPeriod(model.create({theta0:.001}));near(T/(2*Math.PI/Math.sqrt(9.81)),1,1e-6);});
test('pendulum: elliptic-integral large-angle periods independently quadrature checked; tolerance 2e-10 s',()=>{
  for(const amplitude of [.1,1,2.6,3.05]){let K=0;const n=40000,k=Math.sin(amplitude/2);for(let i=0;i<n;i++){const u=(i+.5)*Math.PI/(2*n);K+=1/Math.sqrt(1-k*k*Math.sin(u)**2);}near(exactPeriod(amplitude),4/Math.sqrt(9.81)*K*Math.PI/(2*n),2e-10);}
  assert.equal(exactPeriod(Math.PI),Infinity);assert.throws(()=>exactPeriod(NaN));
});
test('pendulum: trajectory matches exact large-angle period; tolerance 1e-5 s',()=>{const a=model.create({theta0:2.6});near(measuredPeriod(a),exactPeriod(2.6),1e-5);});
test('pendulum: conservative energy over 100 s, drift < 2e-5 J',()=>{const a=model.create({theta0:2.6}),E=a.sample().energy;a.step(100);near(a.sample().energy,E,2e-5);});
test('pendulum: damped linear solution and energy balance, tolerances 2e-9 rad / J',()=>{
  const a=model.create({linear:'linear',theta0:.2,damping:.3}),beta=.15,w=Math.sqrt(9.81-beta*beta);a.step(8);near(a.sample().theta,.2*Math.exp(-beta*8)*(Math.cos(w*8)+beta/w*Math.sin(w*8)),2e-9);near(a.invariants().energyBalance,0,2e-9);assert.equal(a.period(),null);
});
test('pendulum: driven steady-state amplitude AND phase, tolerance 2e-9 rad',()=>{
  const Omega=2,b=.8,F=.01,a=model.create({linear:'linear',theta0:0,damping:b,drive:F,driveOmega:Omega});a.step(100);const phase=Math.atan2(b*Omega,9.81-Omega*Omega),A=F/Math.hypot(9.81-Omega*Omega,b*Omega);near(a.sample().theta,A*Math.cos(Omega*100-phase),2e-9);near(a.sample().omega,-Omega*A*Math.sin(Omega*100-phase),2e-9);
});
test('pendulum: Poincare sections are on exact drive cycles (1e-12 s), reset clears them',()=>{
  const a=model.create({drive:.1,driveOmega:2});a.step(10);const points=a.section();assert.equal(points.length,3);points.forEach((p,i)=>near(p.t,(i+1)*Math.PI,1e-12));points[0].theta=123;assert.notEqual(a.section()[0].theta,123);a.reset();assert.equal(a.section().length,0);
});
test('pendulum: chaotic preset shows positive finite-time divergence; >1000-fold over 60 s',()=>{
  const preset=model.presets.find(p=>p.id==='chaos'),a=model.create(preset.values),initial=a.sample().separation;a.step(60);const growth=a.sample().separation/initial;assert.ok(Math.log(growth)/60>Math.log(1000)/60,`growth ${growth}`);
});
test('pendulum: period-doubling preset has two alternating strobe states; repeat < 1e-7 rad, distinct > .1 rad',()=>{
  const a=model.create(model.presets.find(p=>p.id==='period-two').values);a.step(700);const p=a.section().slice(-4);near(p[0].theta,p[2].theta,1e-7);near(p[1].theta,p[3].theta,1e-7);assert.ok(Math.abs(p[0].theta-p[1].theta)>.1);
});
test('pendulum: all presets satisfy contract, rigid-rod geometry and exact reset; length tolerance 1e-12 m',()=>{
  for(const preset of model.presets){const a=model.create(preset.values),initial=a.sample();a.step(.137);near(a.t,.137,1e-14);for(const o of model.observables)assert.ok(Number.isFinite(a.sample()[o.key]),o.key);near(Math.hypot(...a.geometry().bob),preset.values.length,1e-12);a.reset();assert.deepEqual(a.sample(),initial);}
  assert.throws(()=>model.create({length:0}));assert.throws(()=>model.create({linear:.5}));
});
