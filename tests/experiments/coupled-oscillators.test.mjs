import test from 'node:test';
import assert from 'node:assert/strict';
import {model,normalModes,defaults} from '../../static/js/experiments/coupled-oscillators/model.js';
const near=(got,want,tol=1e-9)=>assert.ok(Math.abs(got-want)<=tol,`${got} != ${want} (±${tol})`);
const advance=(s,t,dt=.01)=>{for(let left=t;left>1e-10;left-=dt)s.step(Math.min(left,dt));};
test('two equal masses have analytic in-phase and out-of-phase frequencies',()=>{
 const {modes}=normalModes({m1:2,m2:2,k1:12,k2:3,k3:12});near(modes[0].omega,Math.sqrt(6));near(modes[1].omega,3);near(modes[0].shape[0],modes[0].shape[1]);near(modes[1].shape[0],-modes[1].shape[1]);
});
test('N equal masses match fixed and free chain eigenfrequencies, including translation',()=>{
 for(let n=2;n<=10;n++)for(const ends of ['walls','free']){const p={n,ends};for(let i=1;i<=n;i++)p['m'+i]=1.7;for(let j=1;j<=n+1;j++)p['k'+j]=13;const {modes}=normalModes(p);modes.forEach((o,j)=>near(o.omega,2*Math.sqrt(13/1.7)*Math.sin(Math.PI*(ends==='walls'?j+1:j)/(2*(ends==='walls'?n+1:n))),2e-7));}
});
test('unequal mass modes satisfy K φ = ω² M φ and mass orthogonality',()=>{
 const {modes,masses,springs}=normalModes({n:4,m1:.4,m2:1.7,m3:2.1,m4:.8,k1:3,k2:27,k3:13,k4:15,k5:4});
 for(const o of modes)for(let i=0;i<4;i++)near((springs[i]+springs[i+1])*o.shape[i]-springs[i]*(o.shape[i-1]||0)-springs[i+1]*(o.shape[i+1]||0),o.omega**2*masses[i]*o.shape[i],1e-9);
 for(let j=0;j<4;j++)for(let k=0;k<4;k++)near(masses.reduce((s,m,i)=>s+m*modes[j].shape[i]*modes[k].shape[i],0),+(j===k),1e-10);
});
test('beats transfer the release energy at half the analytic beat period',()=>{
 const p=model.presets.find(p=>p.id==='beats').values,s=model.create(p),[a,b]=s.modes,T=2*Math.PI/(b.omega-a.omega),E=s.invariants().energy;
 near(T,2*Math.PI/(Math.sqrt(24)-Math.sqrt(20)),1e-8);s.step(T/2);const h=s.sample();assert.ok((.5*h.v1**2+10*h.x1**2)/E<.004);s.step(T/2);const r=s.sample();assert.ok((.5*r.v2**2+10*r.x2**2)/E<.004);
});
test('undamped analytic and symplectic chains conserve energy and agree',()=>{
 const p={n:5,m1:.7,m2:1.4,k1:17,k2:9,k3:31,k4:22,k5:6,k6:14,x1:.23,x2:-.11,x3:.07},a=model.create(p),b=model.create({...p,method:'numerical'}),E=a.invariants().energy;let drift=0;
 for(let i=0;i<2000;i++){a.step(.01);b.step(.01);drift=Math.max(drift,Math.abs(b.invariants().energy/E-1));}near(a.invariants().energy,E,1e-10);assert.ok(drift<.0004,`energy drift ${drift}`);for(let i=1;i<=5;i++)near(a.sample()['x'+i],b.sample()['x'+i],.0004);
});
test('damped normal mode follows exp(-gamma t/2) and RK4 agrees',()=>{
 const p={...model.presets[0].values,gamma:.32},a=model.create(p),b=model.create({...p,method:'numerical'}),w=a.modes[0].omega,wd=Math.sqrt(w*w-(p.gamma/2)**2),T=2*Math.PI/wd;
 advance(a,4*T);advance(b,4*T);near(a.sample().x1,.2*Math.exp(-p.gamma*4*T/2),1e-10);near(b.sample().x1,a.sample().x1,1e-8);assert.ok(a.invariants().energy<.2*model.create(p).invariants().energy);
});
test('driven steady state matches analytic complex transfer function',()=>{
 const p={gamma:.6,force:.15,frequency:4.6,x1:0,x2:0},s=model.create(p),O=p.frequency;
 advance(s,60);const transfer=s.modes.reduce((r,o)=>{const d=o.omega**2-O**2,b=p.gamma*O,z=p.force*o.shape[0]**2/(d*d+b*b);return [r[0]+z*d,r[1]+z*b]},[0,0]);
 near(s.sample().x1,transfer[0]*Math.cos(O*s.t)+transfer[1]*Math.sin(O*s.t),2e-9);
 const numerical=model.create({...p,method:'numerical'});advance(numerical,60);near(numerical.sample().x1,s.sample().x1,2e-8);
});
test('reset and exact step duration preserve initial state for all presets and free modes',()=>{
 for(const p of model.presets){const s=model.create(p.values),initial=s.sample();s.step(.123);near(s.t,.123);s.reset();assert.deepEqual(s.sample(),initial);}
 const free=model.create({ends:'free',modeA:1,amplitudeA:.1,v1:.1});free.step(2);assert.ok(Object.values(free.sample()).every(Number.isFinite));assert.equal(defaults.n,2);
});
