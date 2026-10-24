import test from 'node:test';
import assert from 'node:assert/strict';
import {model} from '../../static/js/experiments/collisions/model.js';
import {view,comparisonPanels,impactCaption} from '../../static/js/experiments/collisions/view.js';
import {motionBatches} from '../../static/js/experiments/orbits/scene.js';
test('impact parameter caption is complete, above its bar and contained in Lab at 1280,390,320 (0 px clipping)',()=>{
 const p=Object.fromEntries(model.params.map(d=>[d.key,d.value]));let data;for(const batch of motionBatches(model,p))data=batch;
 for(const w of [560,370,300]){
  const panel=comparisonPanels({w,h:w<460?640:440},data.rows)[0],label=impactCaption(panel,data.rows[0].geometry.frames.lab,p.b),r=panel.rect;
  assert.equal(label.text,'b = 0.500 m');assert.ok(label.x-label.width/2>=r.x&&label.x+label.width/2<=r.x+r.w);assert.ok(label.y+7<label.bar.y);assert.ok(label.y-7>=r.y);
 }
});
test('collision momentum readout retains 3 significant figures and leaves exact zeros unpadded',()=>{
 const params=Object.fromEntries(model.params.map(d=>[d.key,d.value])),sim=model.create(params),eq=view.equations({params,sample:sim.sample(),geometry:sim.geometry()}).join(' ');
 assert.ok(eq.includes(String.raw`P_x=2.00\;\mathrm{kg\,m/s}`));assert.ok(eq.includes(String.raw`P_y=0\;\mathrm{kg\,m/s}`));assert.ok(!eq.includes('+(0)'));
});
