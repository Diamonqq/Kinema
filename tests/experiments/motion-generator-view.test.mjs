import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {model as motion} from '../../static/js/experiments/motion-generator/model.js';
import {motionBounds} from '../../static/js/experiments/motion-generator/view.js';
import {decomposition} from '../../static/js/experiments/pendulum/view.js';
import {wellBounds} from '../../static/js/experiments/anharmonic/view.js';
import {fixedMap} from '../../static/js/experiments/motion-generator/view-tools.js';
const near=(a,b,tol)=>assert.ok(Math.abs(a-b)<=tol,`${a} versus ${b}; tolerance ${tol}`);
test('views: fixed camera reserves the requested top and bottom caption rows; tolerance 1e-10 px',()=>{
 for(const w of [320,570])for(const h of [340,685]){const s={w,h,snap:true},bounds=[-1.4,1.4,-1.45,1.15],m=fixedMap(s,bounds,{top:28,bottom:170,padding:35});assert.ok(m.y(bounds[3])>=28-1e-10);assert.ok(m.y(bounds[2])<=h-170+1e-10);assert.ok(m.x(bounds[0])>=35-1e-10);assert.ok(m.x(bounds[1])<=w-35+1e-10);}
});
test('views: manifest descriptors exactly match every parameter, preset, graph and closeup',async()=>{
 for(const id of ['motion-generator','pendulum','anharmonic']){
  const root='../../static/js/experiments/'+id+'/',{model}=await import(root+'model.js'),{view}=await import(root+'view.js'),manifest=JSON.parse(fs.readFileSync(new URL(root+'manifest.json',import.meta.url)));
  assert.equal(manifest.id,id);assert.equal(manifest.group,'Mechanics');assert.deepEqual(manifest.params,model.params);assert.deepEqual(manifest.presets,model.presets);assert.deepEqual(manifest.graphs,view.graphs);assert.deepEqual(manifest.closeups,view.closeups);
  for(const key of ['graphs','closeups'])assert.equal(new Set(manifest[key].map(p=>p.id)).size,manifest[key].length);
 }
});
test('views: fixed motion envelopes contain every preset over the 60-second transport; tolerance 1e-5 m',()=>{
 for(const preset of motion.presets){const p=preset.values,b=motionBounds(p),a=motion.create(p);
  for(let i=0;i<=120;i++){
   const g=a.geometry(),[x,y,z]=g.position,q=p.dimensions==='1d'&&p.gravity?[0,x]:[x+(p.dimensions==='3d'?.45*z:0),y+(p.dimensions==='3d'?.25*z:0)];
   assert.ok(q[0]>=b[0]-1e-5&&q[0]<=b[1]+1e-5&&q[1]>=b[2]-1e-5&&q[1]<=b[3]+1e-5,`${preset.id}, ${a.t}, ${q}, ${b}`);if(i<120)a.step(.5);
  }
 }
});
test('views: radial and tangential gravity vectors sum to weight; torque r cross F, tolerance 2e-13',()=>{
 for(const theta of [-3,-2,-.3,0,.3,2,3]){const p={mass:1.7,gravity:9.81,length:1.3},d=decomposition(p,{theta});
  near(d.tangential*d.et[0]+d.radial*d.er[0],0,2e-13);near(d.tangential*d.et[1]+d.radial*d.er[1],-p.mass*p.gravity,2e-13);
  near(d.torque,p.length*d.er[0]*(-p.mass*p.gravity),2e-13);
 }
});
test('views: potential diagram fixed bounds include initial connected turning points; tolerance 1e-10 m',async()=>{
 const {model}=await import('../../static/js/experiments/anharmonic/model.js');
 for(const preset of model.presets){const instance=model.create(preset.values),frame={instance,params:preset.values,sample:instance.sample()},b=wellBounds(frame);assert.ok(b[0]<b[1]);
  for(const root of instance.turningPoints().filter(Number.isFinite))assert.ok(root>=b[0]-1e-10&&root<=b[1]+1e-10,preset.id);
 }
});
