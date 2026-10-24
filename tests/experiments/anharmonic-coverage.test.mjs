import test from 'node:test';
import assert from 'node:assert/strict';
import {model,resonanceSweep,parameterSearch,periodTable} from '../../static/js/experiments/anharmonic/model.js';
import {spectrum,testSignal} from '../../static/js/experiments/anharmonic/analysis.js';
const near=(a,b,tol)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}; tolerance ${tol}`);
test('coverage: wall series coefficients, force gradient and sixth-order remainder (absolute 1e-10 N, ratio 50..75)',()=>{
  const a=model.create({potential:'walls-series',k:4,halfSeparation:1.2,restLength:1,x0:.1}),u=a.wallApproximation(.1),v=a.wallApproximation(.2),dx=1e-6;
  near(u.coefficients.quadratic,8*(1-1/1.2),1e-12);near(u.coefficients.quartic,4/1.2**3,1e-12);near(a.restoringForce(.1),-(a.potential(.1+dx)-a.potential(.1-dx))/(2*dx),1e-10);
  const ratio=Math.abs((v.exact-v.approximate)/(u.exact-u.approximate));assert.ok(ratio>50&&ratio<75,`sixth-order ratio ${ratio}`);
});
test('coverage: energy launch preserves selected well/direction and energy; tolerance 1e-12 J',()=>{
  const a=model.create({k:-1,quartic:1,x0:1}),patch=a.energyState(-.1,1,-1),b=model.create({k:-1,quartic:1,...patch});near(b.sample().energy,-.1,1e-12);assert.ok(b.sample().v<0);assert.ok(b.turningPoints()[0]>0);assert.throws(()=>a.energyState(-1,1));
});
test('coverage: buckling equilibria and both-well trajectory; tolerances 1e-10 m / 2e-5 J',()=>{
  const a=model.create({potential:'walls',k:4,halfSeparation:.5,restLength:1}),points=a.equilibria();assert.equal(points.filter(p=>p.stable).length,2);near(points[0].x,-Math.sqrt(.75),1e-10);assert.equal(points.find(p=>p.x===0).stable,false);
  const b=model.create(model.presets.find(p=>p.id==='both-wells').values),E=b.sample().energy;let min=Infinity;for(let i=0;i<1000;i++){b.step(.01);min=Math.min(min,b.sample().x);}assert.ok(min<-1);near(b.sample().energy,E,2e-5);
});
test('coverage: spectra recover DC, amplitude, real/imaginary and phase; absolute tolerance 2e-12',()=>{
  const dt=1/128,n=128,phi=.4,data=Array.from({length:n},(_,i)=>2+3*Math.cos(2*Math.PI*8*i*dt+phi)),s=spectrum(data,dt);
  near(s[0].amplitude,2,2e-12);near(s[8].amplitude,3,2e-12);near(s[8].phase,phi,2e-12);near(s[8].real,1.5*Math.cos(phi),2e-12);near(s[8].imaginary,1.5*Math.sin(phi),2e-12);
  near(spectrum(data,dt,{removeMean:true})[0].amplitude,0,2e-12);
});
test('coverage: three windows suppress distant leakage; sine/square/triangle harmonic ratios (tolerance .025)',()=>{
  const n=512,dt=1/128;
  for(const window of ['sine','sine-squared','triangle']){
    const data=testSignal({count:n,dt,frequency:2.125}),flat=spectrum(data,dt),weighted=spectrum(data,dt,{window});assert.ok(weighted[60].amplitude<flat[60].amplitude,window);
  }
  const sine=spectrum(testSignal({count:n,dt,frequency:2}),dt),square=spectrum(testSignal({shape:'square',count:n,dt,frequency:2,phase:.02}),dt),triangle=spectrum(testSignal({shape:'triangle',count:n,dt,frequency:2}),dt);
  near(sine[8].amplitude,1,1e-12);near(square[24].amplitude/square[8].amplitude,1/3,.025);near(triangle[24].amplitude/triangle[8].amplitude,1/9,.025);
  assert.throws(()=>spectrum([1,2],0));assert.throws(()=>testSignal({count:1}));
});
test('coverage: nonlinear asymmetry gives nonzero mean/DC, tolerance 1e-12 agreement',()=>{
  const a=model.create(model.presets.find(p=>p.id==='asymmetric').values),dt=.02,data=[];for(let i=0;i<1024;i++){data.push(a.sample().x);a.step(dt);}const mean=data.reduce((s,x)=>s+x,0)/data.length;assert.ok(Math.abs(mean)>.01);near(a.frequencyAnalysis(data,dt)[0].real,mean,1e-12);
});
test('coverage: exact multi-phase maps and return velocity pairs; timestamp tolerance 1e-10 s',()=>{
  const a=model.create({drive:.2,phaseCount:8});a.step(40);const frames=a.sections();assert.equal(frames.length,8);for(const f of frames)f.points.slice(1).forEach((p,i)=>near(p.t-f.points[i].t,2*Math.PI,1e-10));const pairs=a.returnMap(3);near(pairs[0].previous,frames[3].points[0].v,1e-12);near(pairs[0].current,frames[3].points[1].v,1e-12);
});
test('coverage: period curves vary stiffness and energy, analytic harmonic tolerance 2e-6 s',()=>{
  const curves=periodTable([{quartic:0,k:1},{quartic:0,k:4}],[.1,.3,.5]);curves.forEach((curve,i)=>curve.points.forEach(p=>near(p.period,2*Math.PI/(i+1),2e-6)));
});
test('coverage: driven resonance sweep matches analytic amplitude/phase at three frequencies; tolerance 2e-5',()=>{
  const points=resonanceSweep({quartic:0,k:4,damping:1,drive:.2,x0:0},[1,2,3],{settleCycles:16,measureCycles:4});points.forEach(p=>{near(p.harmonicAmplitude,.2/Math.hypot(4-p.frequency**2,p.frequency),2e-5);near(p.phaseLag,Math.atan2(p.frequency,4-p.frequency**2),2e-5);assert.equal(p.periodOneSettled,true);});
});
test('coverage: Duffing continuation has distinct settled up/down branches; separation > .7 m',()=>{
  const frequencies=Array.from({length:15},(_,i)=>.8+i*.07),values={k:1,quartic:1,damping:.1,drive:.3,x0:0},options={settleCycles:32,measureCycles:4};
  const up=resonanceSweep(values,frequencies,options),down=resonanceSweep(values,[...frequencies].reverse(),options).reverse();
  assert.ok(up.some((p,i)=>p.periodOneSettled&&down[i].periodOneSettled&&Math.abs(p.harmonicAmplitude-down[i].harmonicAmplitude)>.7));
});
test('coverage: bounded parameter scan returns thirty post-transient Poincare points (exact count)',()=>{
  const result=parameterSearch({quartic:0,k:1,drive:.1,damping:.5},[{drive:.1},{drive:.2}],{transientCycles:2,cycles:30});assert.equal(result.length,2);result.forEach(r=>assert.equal(r.points.length,30));assert.throws(()=>parameterSearch({},Array(17).fill({})));
});
test('coverage: weak Van der Pol period tends to 2pi; tolerance .01 s',()=>{
  const [curve]=periodTable([{potential:'van-der-pol',k:1,x0:1}],[.05],{settle:120,duration:50,dt:.01});near(curve.points[0].period,2*Math.PI,.01);assert.ok(curve.points[0].spread<.01);
});
