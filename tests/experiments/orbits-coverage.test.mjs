import test from 'node:test';
import assert from 'node:assert/strict';
import {model,G,createNBody,stateFromElements,orbitalElements,replicateBodies} from '../../static/js/experiments/orbits/model.js';
const close=(a,b,tol,label='')=>assert.ok(Math.abs(a-b)<=tol,`${label}: ${a} vs ${b}, tolerance ${tol}`);
const run=(s,time,dt=.05)=>{for(let t=0;t<time;){const h=Math.min(dt,time-t);s.step(h);t+=h;}};
const binary=()=>{
  const w=Math.sqrt(G*2e12/10**3);
  return [{mass:1e12,x:-5,y:0,vx:0,vy:-5*w},{mass:1e12,x:5,y:0,vx:0,vy:5*w}];
};

test('three equal masses: exact equilateral rotating solution after five periods (0.0004 m, energy 3e-6)',()=>{
  const d=10,R=d/Math.sqrt(3),omega=Math.sqrt(3*G*1e12/d**3),T=2*Math.PI/omega;
  const bodies=Array.from({length:3},(_,i)=>{const a=i*2*Math.PI/3,x=R*Math.cos(a),y=R*Math.sin(a);
    return {mass:1e12,x,y,vx:-omega*y,vy:omega*x};});
  const s=createNBody({bodies,maxStep:.001}),start=s.invariants();run(s,5*T);
  for(let i=0;i<3;i++) {const q=s.geometry().frames.universe[i];close(q.x,bodies[i].x,.0004);close(q.y,bodies[i].y,.0004);}
  close(s.invariants().energy/start.energy,1,3e-6);
  close(s.invariants().angularMomentum/start.angularMomentum,1,3e-12);
});

test('five massive bodies exchange momentum while conserving E/L (relative 1e-5 / 3e-12)',()=>{
  const R=10,mass=1e11,n=5;
  const omega=Math.sqrt(G*mass/(4*R**3)*Array.from({length:n-1},(_,i)=>1/Math.sin(Math.PI*(i+1)/n)).reduce((a,b)=>a+b));
  const bodies=Array.from({length:n},(_,i)=>{const x=R*Math.cos(2*Math.PI*i/n),y=R*Math.sin(2*Math.PI*i/n);
    return {mass,x,y,vx:-omega*y,vy:omega*x};});
  const s=createNBody({bodies}),start=s.invariants();run(s,30);
  const end=s.invariants();close(end.energy/start.energy,1,1e-5);close(end.angularMomentum/start.angularMomentum,1,3e-12);
  close(end.momentum.x,0,.02);close(end.momentum.y,0,.02);
  assert.equal(s.sample().bodyCount,5);assert.equal(s.sample().keplerExact,false);
});

test('zero-mass test particle has no backreaction; finite third mass changes primary (1e-12 m comparison)',()=>{
  const probe={mass:0,x:15,y:2,vx:0,vy:3},a=createNBody({bodies:binary(),maxStep:.0001}),
    b=createNBody({bodies:[...binary(),probe],maxStep:.0001}),
    c=createNBody({bodies:[...binary(),{...probe,mass:1e11}],maxStep:.0001});
  for(const s of [a,b,c])run(s,2);
  for(let i=0;i<2;i++)for(const key of ['x','y','vx','vy'])
    close(a.geometry().frames.universe[i][key],b.geometry().frames.universe[i][key],1e-12,key);
  assert.ok(Math.abs(c.geometry().frames.universe[0].x-a.geometry().frames.universe[0].x)>.001);
});

test('restricted L4 stays fixed in rotating frame, Jacobi constant within 3e-6 relative',()=>{
  const s=model.create({system:'lagrange'}),initial=s.geometry().frames.rotating[2],C=s.sample().jacobi,T=s.sample().period;
  assert.equal(s.sample().jacobiApplicable,true);run(s,3*T);
  const end=s.geometry().frames.rotating[2];close(end.x,initial.x,.0003);close(end.y,initial.y,.0003);
  close(s.sample().jacobi/C,1,3e-6);close(Math.hypot(end.vx,end.vy),0,.0001);
});

test('inertial and velocity-aligned thrust: analytic free flight and E/work, P/impulse, L/torque balances (1e-8)',()=>{
  const bodies=[{mass:2,x:-10,y:0,vx:0,vy:0},{mass:3,x:0,y:2,vx:1,vy:0}];
  for(const frame of ['inertial','velocity']) {
    const s=createNBody({bodies,gravity:0,thrust:{body:1,along:.2,normal:0,frame}}),start=s.invariants();run(s,5);
    const q=s.geometry().frames.universe[1],end=s.invariants();close(q.x,7.5,1e-8);close(q.vx,2,1e-8);
    close(end.energy-start.energy,end.work,1e-8);close(end.momentum.x-start.momentum.x,end.externalImpulse.x,1e-8);
    close(end.angularMomentum-start.angularMomentum,end.externalAngularImpulse,1e-8);
  }
  const s=model.create({launch:'circular',thrustAlong:.01}),start=s.invariants();run(s,10);
  const end=s.invariants();assert.ok(end.work>0);close((end.energy-start.energy)/end.work,1,1e-8);
  assert.throws(()=>model.create({thrustAlong:.01,thrustBody:5}),RangeError);
  const turn=createNBody({bodies,gravity:0,maxStep:.01,thrust:{body:1,along:0,normal:.2,frame:'velocity'}});
  run(turn,5);const q=turn.geometry().frames.universe[1];
  close(q.x,5*Math.sin(1),1e-8);close(q.y,2+5*(1-Math.cos(1)),1e-8);
  close(Math.hypot(q.vx,q.vy),1,1e-8);close(turn.invariants().work,0,1e-8);
});

test('orbital element input round-trips ellipse and hyperbola, incl. clockwise (1e-10)',()=>{
  const primary={mass:1e12,x:2,y:3,vx:.2,vy:-.1};
  for(const [a,e] of [[12,.6],[-12,1.5]])for(const clockwise of [false,true]) {
    const body=stateFromElements({a,e,mass:1e10,trueAnomaly:.7,periapseAngle:.4,clockwise},primary);
    const out=orbitalElements(primary,body);close(out.a,a,1e-10);close(out.e,e,1e-10);close(out.periapseAngle,.4,1e-10);
    close(out.trueAnomaly,.7,1e-10);
  }
  assert.throws(()=>stateFromElements({a:1,e:1},primary),RangeError);
});

test('physical time reversal retraces an N-body state (2e-9 m/s or m); default two-body reversal agrees',()=>{
  const original=binary(),s=createNBody({bodies:original,maxStep:.001});run(s,2,.02);
  const reverse=createNBody({bodies:s.geometry().frames.universe,maxStep:.001,direction:-1});run(reverse,2,.02);
  for(let i=0;i<2;i++)for(const key of ['x','y','vx','vy'])close(reverse.geometry().frames.universe[i][key],original[i][key],2e-9);
  const a=model.create(),b=model.create({timeDirection:'reverse'});a.step(1);b.step(1);
  close(a.geometry().relative.x,b.geometry().relative.x,1e-12);close(a.geometry().relative.y,-b.geometry().relative.y,1e-12);
});

test('all eight original examples are distinct finite trajectories, reset exactly; probes preserve source (0 tolerance)',()=>{
  const systems=['sun-earth-moon','solar-system','docking','jupiter-comet','jupiter-moons','lagrange','binary-comet','retrograde'];
  for(const system of systems) {
    const s=model.create({system}),initial=s.geometry();run(s,1,.1);
    for(const o of model.observables)assert.ok(Number.isFinite(s.sample()[o.key]),`${system}/${o.key}`);
    assert.equal(s.sample().status,'running');assert.ok(s.sample().bodyCount>=3);s.reset();assert.deepEqual(s.geometry(),initial);
  }
  const source=binary(),clones=replicateBodies(source,1,3,{dx:.01,dvy:.001});
  assert.equal(source.length,2);assert.equal(clones.length,5);assert.equal(clones[4].mass,0);close(clones[4].x,5.03,1e-12);
  const s=model.create({system:'custom-nbody',bodyCount:5,replicas:3});assert.equal(s.sample().bodyCount,8);
});

test('Poincaré section retains upward crossings in rotating coordinates; retrograde rate changes sign',()=>{
  const bodies=[{mass:1e12,x:0,y:0,vx:0,vy:0},stateFromElements({mass:0,a:10}, {mass:1e12,x:0,y:0,vx:0,vy:0}),
    stateFromElements({mass:0,a:6,trueAnomaly:-.4},{mass:1e12,x:0,y:0,vx:0,vy:0})];
  const s=createNBody({bodies,maxStep:.001});run(s,60);
  const points=s.geometry().poincare;assert.ok(points.length>=3);
  for(let i=0;i<points.length;i++) {close(points[i].y,0,0);assert.ok(Number.isFinite(points[i].vx));if(i)assert.ok(points[i].t>points[i-1].t);}
  const r=model.create({system:'retrograde'}),rates=[];
  for(let i=0;i<400;i++){r.step(.1);rates.push(r.sample().lineOfSightRate);}
  assert.ok(Math.min(...rates)<0&&Math.max(...rates)>0,'genuine apparent reversal');
});

test('burn starts/stops at exact physical boundaries; Galilean boost and per-body energies are consistent (1e-8)',()=>{
  const bodies=[{mass:2,x:-10,y:0,vx:0,vy:0},{mass:3,x:0,y:2,vx:1,vy:0}];
  const s=createNBody({bodies,gravity:0,thrust:{body:1,along:.2,normal:0,frame:'inertial',start:1,duration:2}});
  run(s,5,.07);const q=s.geometry().frames.universe[1];close(q.x,6.2,1e-8);close(q.vx,1.4,1e-8);
  close(s.invariants().work,1.44,1e-8);
  const a=model.create({frame:'universe'}),b=model.create({frame:'universe',boostX:.3,boostY:-.2});run(a,2);run(b,2);
  for(let i=0;i<2;i++) {const u=a.geometry().frames.universe[i],v=b.geometry().frames.universe[i];
    close(v.x-u.x,.6,1e-10);close(v.y-u.y,-.4,1e-10);}
  const energy=b.geometry().energyByBody.reduce((sum,e)=>sum+e.kinetic+e.potential/2,0);
  close(energy/b.invariants().energy,1,1e-12);
});

test('N-body rejects invalid/overlapping state and marks actual close encounters without nonfinite output',()=>{
  assert.throws(()=>createNBody({bodies:[{...binary()[0],mass:0},binary()[1]]}),RangeError);
  assert.throws(()=>createNBody({bodies:[binary()[0],{...binary()[1],x:-5}]}),RangeError);
  const s=createNBody({bodies:[{mass:1e12,x:0,y:0,vx:0,vy:0},{mass:0,x:1,y:0,vx:0,vy:0}]});run(s,.5,.01);
  assert.equal(s.sample().status,'close-encounter');
  for(const o of model.observables)assert.ok(Number.isFinite(s.sample()[o.key]),o.key);
});

test('rotating velocities differentiate positions and selected-frame geometry stays coherent (2e-5 m/s, 1e-10 m)',()=>{
  const s=model.create({system:'lagrange',frame:'rotating'}),g=s.geometry(),h=1e-5;
  s.step(h);const next=s.geometry();
  for(let i=0;i<g.bodies.length;i++)for(const [position,velocity] of [['x','vx'],['y','vy']])
    close((next.bodies[i][position]-g.bodies[i][position])/h,g.bodies[i][velocity],2e-5);
  close(g.relative.x,g.bodies[1].x-g.bodies[0].x,1e-10);
  close(g.relative.y,0,1e-10);close(g.force.y,0,1e-10);
  const primary=model.create({system:'lagrange',frame:'primary'}).geometry();
  close(primary.bodies[0].x,0,0);close(primary.bodies[0].y,0,0);
  close(primary.centreOfMass.x,primary.inertialCentreOfMass.x-primary.frames.universe[0].x,1e-10);
});
