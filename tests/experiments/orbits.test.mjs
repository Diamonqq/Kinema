import test from 'node:test';
import assert from 'node:assert/strict';
import {model,G} from '../../static/js/experiments/orbits/model.js';

const close=(a,b,tol,message='')=>assert.ok(Math.abs(a-b)<=tol,`${message}: ${a} vs ${b}, tolerance ${tol}`);
const run=(s,total,dt)=>{for(let t=0;t<total;) {const h=Math.min(dt,total-t);s.step(h);t+=h;}};
const base={m1:1e12,m2:1e11,r0:10};
const mu=G*(base.m1+base.m2);

test('Kepler period measured from integrated circle: T ∝ a^(3/2), tolerance 2e-5 relative',()=>{
  const measured=[];
  for(const r0 of [5,10,20]) {
    const s=model.create({...base,r0,launch:'circular'}),expected=2*Math.PI*Math.sqrt(r0**3/mu);
    const dt=expected/1200;let lastY=0,lastT=0,crossing=0;
    for(let i=0;i<1250;i++) {
      s.step(dt);const y=s.geometry().relative.y;
      if(i>1100 && lastY<0 && y>=0) {crossing=lastT+dt*(-lastY)/(y-lastY);break;}
      lastY=y;lastT=s.t;
    }
    close(crossing/expected,1,2e-5,'measured circular period');measured.push(crossing);
  }
  close(measured[2]/measured[0],8,1e-4,'radius ratio four gives period ratio eight');
});

test('initial conditions give analytic eccentricity, apsides and semimajor axis (1e-11)',()=>{
  const a=12,e=.6,r0=a*(1-e),vy0=Math.sqrt(mu*(1+e)/r0);
  const s=model.create({...base,r0,vy0}),v=s.sample();
  close(v.eccentricity,e,1e-11);close(v.semiMajorAxis,a,1e-11);
  close(v.periapsis,r0,1e-11);close(v.apoapsis,a*(1+e),1e-11);
  const arbitrary=model.create({...base,vx0:.7,vy0:2}).sample();
  const eps=(.7**2+2**2)/2-mu/10,h=20;
  close(arbitrary.eccentricity,Math.sqrt(1+2*eps*h*h/(mu*mu)),1e-12);
});

test('50 eccentric orbits: bounded energy error <3e-6, angular momentum <2e-12 relative',()=>{
  const s=model.create({...base,r0:5,vy0:Math.sqrt(mu*1.6/5)}),initial=s.invariants(),T=s.sample().period;
  let worst=0;
  for(let i=0;i<5000;i++) {
    s.step(T/100);const inv=s.invariants();
    worst=Math.max(worst,Math.abs((inv.energy-initial.energy)/initial.energy));
    close(inv.angularMomentum/initial.angularMomentum,1,2e-12);
  }
  assert.ok(worst<3e-6,`relative energy envelope ${worst}, tolerance 3e-6`);
});

test('equal-time swept areas constant to 2e-10 relative, frame transforms to 1e-12 m',()=>{
  const s=model.create(),areaRate=s.sample().areaRate,dt=.2;
  let prior=0;
  for(let i=0;i<100;i++) {
    s.step(dt);const value=s.sample().sweptArea;
    close((value-prior)/(areaRate*dt),1,2e-10);prior=value;
    const g=s.geometry(),[a,b]=g.frames.cm;
    close((base.m1*a.x+base.m2*b.x)/(base.m1+base.m2),0,1e-12);
    close(b.x-a.x,g.frames.primary[1].x,1e-12);
    close(b.vy-a.vy,g.frames.primary[1].vy,1e-12);
  }
});

test('escape threshold E=0 within 0.001 J; slower bound and faster unbound',()=>{
  const s=model.create({...base,launch:'escape'}),v=Math.sqrt(2*mu/base.r0);
  close(s.sample().speed,v,1e-12);close(s.sample().energy,0,.001);
  assert.equal(s.sample().bound,false);assert.equal(s.sample().period,0);
  assert.equal(model.create({...base,vy0:v*.99}).sample().bound,true);
  assert.equal(model.create({...base,vy0:v*1.01}).sample().bound,false);
  run(s,20,.1);assert.ok(s.sample().r>base.r0);
});

test('Hohmann transfer reaches target after half period within 3e-5 m; no second burn',()=>{
  const s=model.create({...base,launch:'transfer',targetRadius:20}),T=s.sample().period;
  run(s,T/2,.05);close(s.sample().r,20,3e-5);
  assert.ok(s.sample().speed<Math.sqrt(mu/20),'still on transfer ellipse, not circularised');
});

test('inverse-cube perturbation: apsidal advance agrees with Binet formula within 0.002 rad',()=>{
  const alpha=.6,s=model.create({...base,alpha}),initial=s.invariants(),g=s.geometry().relative;
  const h=g.x*g.vy-g.y*g.vx,expected=2*Math.PI/Math.sqrt(1-mu*alpha/(h*h));
  let lastRadial=g.x*g.vx+g.y*g.vy,angle=0,lastAngle=0,periAngles=[];
  let worst=0;
  for(let i=0;i<12000;i++) {
    s.step(.01);const q=s.geometry().relative,a=Math.atan2(q.y,q.x);
    angle+=Math.atan2(Math.sin(a-lastAngle),Math.cos(a-lastAngle));lastAngle=a;
    const radial=q.x*q.vx+q.y*q.vy;
    if(lastRadial<0 && radial>=0) periAngles.push(angle);
    lastRadial=radial;worst=Math.max(worst,Math.abs(s.invariants().energy/initial.energy-1));
  }
  assert.ok(periAngles.length>=3);
  for(let i=1;i<periAngles.length;i++) close(periAngles[i]-periAngles[i-1],expected,.002);
  assert.ok(worst<5e-6,`perturbed energy error ${worst}, tolerance 5e-6`);
  assert.equal(s.sample().keplerExact,false);
});

test('all presets finite and reset deterministic; invalid input rejects before advancing',()=>{
  for(const preset of model.presets) {
    const s=model.create(preset.values),initial=s.sample();s.step(.1);s.reset();assert.deepEqual(s.sample(),initial);
    for(const d of model.observables) assert.ok(Number.isFinite(s.sample()[d.key]),`${preset.id}/${d.key}`);
    s.step(.123);close(s.t,.123,0);
  }
  assert.throws(()=>model.create({m1:NaN}),RangeError);
  assert.throws(()=>model.create({frame:'unknown'}),RangeError);
  assert.throws(()=>model.create({bad:1}),RangeError);
  const s=model.create();for(const dt of [-1,NaN,Infinity,61]) assert.throws(()=>s.step(dt),RangeError);
  assert.equal(s.t,0);
});

test('radial plunge halts before the point singularity; finite frozen state and exact clock (1e-12)',()=>{
  const s=model.create({...base,vy0:0});run(s,6,.1);
  assert.equal(s.sample().status,'close-encounter');
  assert.ok(s.sample().r>=.02);
  const g=s.geometry().relative;s.step(.25);assert.deepEqual(s.geometry().relative,g);
  close(s.t,6.25,1e-12);
  for(const d of model.observables) assert.ok(Number.isFinite(s.sample()[d.key]),d.key);
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
