import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../static/js/experiments/minkowski/model.js',import.meta.url),'utf8');
const {model,C,gamma,boost,interval,addVelocity}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
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
      m.step(dt);assert.ok(Object.values(m.sample()).every(Number.isFinite));
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
