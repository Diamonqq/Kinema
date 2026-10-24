import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {model} from '../../static/js/experiments/orbits/model.js';
import {view,orbitBounds,equalTimeSectors,values} from '../../static/js/experiments/orbits/view.js';
import {motionBatches,camera,tex,fmt} from '../../static/js/experiments/orbits/scene.js';
const params=Object.fromEntries(model.params.map(p=>[p.key,p.value]));
test('orbit manifest exactly matches physics descriptors, presets and every authored view target',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('../../static/js/experiments/orbits/manifest.json',import.meta.url)));
 assert.deepEqual(m.params,model.params);assert.deepEqual(m.presets,model.presets);assert.deepEqual(m.closeups,view.closeups);assert.deepEqual(m.graphs,view.graphs);
 for(const graph of view.graphs)for(const series of (graph.series||[]))assert.ok(Number.isFinite(model.create().sample()[series.key]),series.key);
});
test('orbit forecasts are incremental and fixed bounds contain the entire recorded motion (1e-10 m)',()=>{
 for(const id of ['ellipse','escape','precession','lagrange','thrust']){
  const p=model.presets.find(p=>p.id===id).values;let result,previous=0;
  for(const batch of motionBatches(model,p)){assert.ok(batch.rows.length-previous<=8);previous=batch.rows.length;result=batch;}
  assert.equal(result.done,true);assert.ok(Math.abs(result.rows.at(-1).t-60)<1e-10);
  const b=orbitBounds(result.rows,p,p.frame);
  for(const row of result.rows)for(const point of row.geometry.bodies)assert.ok(point.x>=b[0]-1e-10&&point.x<=b[1]+1e-10&&point.y>=b[2]-1e-10&&point.y<=b[3]+1e-10,id);
 }
});
test('large physical bounds retain equal scale without clipping and reset camera deterministically (1e-10 px)',()=>{
 const stage={w:320,h:340,snap:true},bounds=[-10000,10000,-5000,5000],map=camera(stage,bounds),initial={...stage.camera};
 assert.ok(map.x(bounds[0])>=19.999999);assert.ok(map.x(bounds[1])<=300.000001);
 for(let i=0;i<30;i++)camera(stage,bounds);assert.deepEqual(stage.camera,initial);
 stage.camera.cx=100;stage.snap=true;camera(stage,bounds);assert.deepEqual(stage.camera,initial);
});

test('equal-time sectors use equal durations and equal integrated areas (1e-10 relative); scientific equations are mathematical',()=>{
 let result;const p=model.presets.find(p=>p.id==='ellipse').values;
 for(const batch of motionBatches(model,p))result=batch;
 const bands=equalTimeSectors(result.rows,result.rows[0].sample.period),areas=bands.map(rows=>rows.at(-1).sample.sweptArea-rows[0].sample.sweptArea);
 assert.ok(Math.abs((bands[0].at(-1).t-bands[0][0].t)-(bands[1].at(-1).t-bands[1][0].t))<1e-10);
 assert.ok(Math.abs(areas[0]/areas[1]-1)<1e-10);
 assert.equal(tex(-5.52e10),String.raw`-5.52\times10^{10}`);assert.equal(fmt(-5.52e10),'-5.52\u00d710\u00b9\u2070');
 assert.deepEqual(orbitBounds([result.rows[0]],p,p.frame),orbitBounds(result.rows,p,p.frame));
});

test('rotating-frame Breakdown retains inertial velocity and swept-area physics (1e-12 m/s or m2/s)',()=>{
 const sim=model.create({system:'lagrange',frame:'rotating'}),f={geometry:sim.geometry(),sample:sim.sample(),params:{...params,system:'lagrange',frame:'rotating'}};
 const v=values(f);assert.ok(v.vt>2);assert.ok(Math.hypot(f.geometry.relative.vx,f.geometry.relative.vy)<1e-10);
 assert.ok(Math.abs(f.sample.r*v.vt/2-f.sample.areaRate)<1e-12);
});
