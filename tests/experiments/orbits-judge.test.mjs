import test from 'node:test';
import assert from 'node:assert/strict';
import {model} from '../../static/js/experiments/orbits/model.js';
import {view,orbitBounds,orbitChipLayout} from '../../static/js/experiments/orbits/view.js';
import {motionBatches,camera,targetChips,sceneHeight} from '../../static/js/experiments/orbits/scene.js';
const hit=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
test('three scene chips clear every preset trajectory and Breakdown arrow at 1280,390,320 layouts (0 px overlap)',()=>{
 assert.equal(view.closeups.length,3);assert.ok(view.graphs.some(g=>g.id==='potential'));assert.ok(view.graphs.some(g=>g.id==='poincare'));
 for(const preset of model.presets){let data;for(const batch of motionBatches(model,preset.values))data=batch;
  for(const w of [560,370,300]){
   const narrow=w<460,s={w,h:narrow?500:420,line:()=>{}},p=preset.values,map=camera(s,orbitBounds(data.rows,p,p.frame),narrow?160:85,narrow?160:95),layout=orbitChipLayout(data.rows,p,map,w);
   targetChips(s,layout.targets,[],null,layout.obstacles);
   for(const rect of s.chipRects){assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=s.w&&rect.y+rect.height<=s.h);assert.ok(!layout.obstacles.some(o=>hit(rect,o)),preset.id+' '+w);}
  }
 }
});
test('Breakdown defines tangential speed as a scalar magnitude and gives force directly in SI (3 significant figures)',()=>{
 const params=Object.fromEntries(model.params.map(d=>[d.key,d.value])),sim=model.create(params),frame={params,sample:sim.sample(),geometry:sim.geometry()};
 const equations=view.equations(frame).join(' ');
 assert.ok(equations.includes(String.raw`v_t=\frac{|\mathbf r\times\mathbf v|}{r}`));
 assert.ok(equations.includes(String.raw`F_r=-66.7\;\mathrm{GN}`));assert.ok(!equations.includes('F_0'));
 const reverse=model.create({...params,vy0:-params.vy0}),rev=view.equations({...frame,sample:reverse.sample(),geometry:reverse.geometry()}).join(' ');
 assert.ok(rev.includes('=1.90'));assert.ok(rev.includes(String.raw`|\dot A|`));
});
test('capped orbit scene has no flex growth or unbounded empty bands on phone Graphs',()=>{
 const scene={style:{}},stage={w:300,resize:()=>{}},shell={scene,stage};
 sceneHeight(shell,500,false,true);assert.equal(scene.style.flexGrow,'0');assert.equal(scene.style.maxHeight,'500px');assert.equal(scene.style.flexBasis,'500px');
 sceneHeight(shell,500,true,true);assert.equal(scene.style.maxHeight,'360px');
});
