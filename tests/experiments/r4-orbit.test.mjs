import test from 'node:test';
import assert from 'node:assert/strict';
import {model as orbits} from '../../static/js/experiments/orbits/model.js';
import {model as collisions} from '../../static/js/experiments/collisions/model.js';
import {view as orbitView,orbitBounds,orbitCamera,decompositionParts} from '../../static/js/experiments/orbits/view.js';
import {view as collisionView,encounterBounds,durationFor} from '../../static/js/experiments/collisions/view.js';
import {motionBatches,boundsFor,plot} from '../../static/js/experiments/orbits/scene.js';
const forecast=(model,values,duration)=>{let data;for(const b of motionBatches(model,values,{duration}))data=b;return data;};
test('orbit bounds are the bounding box of the drawn ellipses, centered on them rather than on the focus',()=>{
 for(const id of ['ellipse','circular']){
  const p=orbits.presets.find(d=>d.id===id).values,data=forecast(orbits,p,60);
  for(const frame of ['primary','cm']){
   const [x0,x1,y0,y1]=orbitBounds(data.rows,{...p,frame},frame),[a0,a1,b0,b1]=boundsFor(data.rows.map(r=>({geometry:{...r.geometry,frames:r.geometry.frames}})),frame);
   const slack=.1*Math.max(a1-a0,b1-b0);assert.ok(x0<=a0+slack&&x1>=a1-slack&&y0<=b0+slack&&y1>=b1-slack,id+' '+frame+' contains the forecast');
   const spanX=x1-x0,spanY=y1-y0;
   assert.ok(Math.abs((x0+x1)/2-(a0+a1)/2)<=.04*spanX&&Math.abs((y0+y1)/2-(b0+b1)/2)<=.04*spanY,id+' '+frame+' centered on the drawn orbit');
   if(id==='ellipse'&&frame==='primary')assert.ok(Math.abs(spanX-spanY)>.1*spanX,'an ellipse is not framed as a square');
  }
 }
});
test('the orbit fills about 86% of the limiting stage dimension at the Scene, Breakdown and Graphs stage sizes',()=>{
 const p=orbits.presets.find(d=>d.id==='ellipse').values,data=forecast(orbits,p,60),bounds=orbitBounds(data.rows,p,p.frame);
 for(const [w,h] of [[569,685],[569,464],[569,420],[306,690],[306,500]]){
  const s={w,h,snap:true},map=orbitCamera(s,bounds,false),width=(bounds[1]-bounds[0])*map.scale,height=(bounds[3]-bounds[2])*map.scale;
  const share=Math.max(width/w,height/(h-108));assert.ok(Math.abs(share-.86)<.01,w+'x'+h+' share '+share);
  assert.ok(Math.abs(map.x((bounds[0]+bounds[1])/2)-w/2)<1e-6,'centered across');
 }
});
test('the periapsis legend names only the arrows that are drawn',()=>{
 const p=orbits.presets.find(d=>d.id==='ellipse').values,sim=orbits.create(p);
 const at=()=>({params:p,sample:sim.sample(),geometry:sim.geometry(),closeup:'periapsis'});
 let f=at();assert.deepEqual(decompositionParts(f),{radial:false,tangent:false});
 assert.equal(orbitView.key(f),'Blue v · green gravity');
 sim.step(2);f=at();assert.deepEqual(decompositionParts(f),{radial:true,tangent:true});
 assert.equal(orbitView.key(f),'Blue v · amber radial · violet tangent · green gravity');
});
test('collision frames include the outgoing paths for as long as the approach took',()=>{
 for(const id of ['glancing','exchange','heavy']){
  const p=collisions.presets.find(d=>d.id===id).values,data=forecast(collisions,p,durationFor(p)),near=data.rows.reduce((a,b)=>a.sample.separation<b.sample.separation?a:b);
  const late=data.rows.filter(r=>r.t<=2*near.t+1e-9).at(-1);
  for(const frame of ['lab','cm']){
   const [x0,x1,y0,y1]=encounterBounds(data.rows,frame);
   for(const q of late.geometry.frames[frame])assert.ok(q.x>=x0&&q.x<=x1&&q.y>=y0&&q.y<=y1,id+' '+frame+' outgoing body inside the frame');
   for(const q of data.rows[0].geometry.frames[frame])assert.ok(q.x>=x0&&q.x<=x1&&q.y>=y0&&q.y<=y1,id+' '+frame+' start inside the frame');
  }
 }
});
test('graph plots give the y axis its own title at the top-left and keep only the x title under the axis; walls are labeled lines',()=>{
 const texts=[],lines=[],s={w:500,h:340,text:(t,x,y,c,size,al)=>texts.push({t,x,y,al}),line:(...a)=>lines.push(a),circle:()=>{},ctx:{setLineDash:()=>{},beginPath:()=>{},moveTo:()=>{},lineTo:()=>{},stroke:()=>{}}};
 plot(s,[{x:1,y:2},{x:3,y:1},{x:6,y:.5}],{label:'r (m)',ytitle:'Effective potential · J',xmin:.8,walls:[{x:1,text:'hard wall · r = R'}]});
 const y=texts.find(t=>t.t==='Effective potential · J'),x=texts.find(t=>t.t==='r (m)'),wall=texts.find(t=>t.t==='hard wall · r = R');
 assert.ok(y&&y.al==='left'&&y.x===76&&y.y<90,'y title at the top-left');assert.ok(x&&x.y>=300&&x.al===undefined,'x title under the axis');assert.ok(wall,'wall label');
 assert.ok(!texts.some(t=>t.t.includes('(m)')&&t.t.includes('·')),'axis titles are not merged');
});
test('the cross-section caption describes the cross-section graph',()=>{
 const p=collisions.presets.find(d=>d.id==='glancing').values,sim=collisions.create(p);
 const frame=interaction=>({params:{...p,interaction},sample:sim.sample(),geometry:sim.geometry(),closeup:'cross-section'});
 assert.equal(collisionView.key(frame('hard')),'Hard spheres · dσ/dΩ = R²/4 = 0.250 m²/sr, the same at every angle');
 assert.ok(collisionView.key(frame('coulomb')).startsWith('Classical dσ/dΩ'));
});
