import test from 'node:test';
import assert from 'node:assert/strict';
import {model} from '../../static/js/experiments/orbits/model.js';
import {view,ENERGY_UNIT,FORCE_UNIT} from '../../static/js/experiments/orbits/view.js';
import {motionBatches,targetChips} from '../../static/js/experiments/orbits/scene.js';

test('default trail matches integrated separation at every snapshot, with displaced ellipse center (1e-10 m)',()=>{
 let final;for(const state of motionBatches(model,{}))final=state;
 const radii=[],xs=[];
 for(const row of final.rows){
  const [a,b]=row.geometry.frames.primary,r=Math.hypot(b.x-a.x,b.y-a.y);radii.push(r);xs.push(b.x);
  assert.ok(Math.abs(r-row.sample.r)<1e-10);
 }
 assert.ok(Math.min(...radii)<3.4&&Math.max(...radii)>9.99);
 const initial=final.rows[0].sample;assert.ok(initial.eccentricity>.5);
 assert.ok(Math.abs((Math.max(...xs)+Math.min(...xs))/2)>3);
 assert.ok(Math.abs(initial.energy/ENERGY_UNIT)<1);
 assert.ok(Math.hypot(final.rows[0].geometry.force.x,final.rows[0].geometry.force.y)/FORCE_UNIT<1);
});

test('target chips fit narrow and desktop stages; abstract chips use one wrapping row',()=>{
 for(const w of [300,600]){
  const s={w,h:520,line:()=>{}},targets={a:{x:w*.8,y:250},b:{x:w*.5,y:250},c:{x:w*.5,y:250}};
  const q=targetChips(s,targets,['potential','poincare'],{q:()=>({offsetWidth:100,offsetHeight:32})});
  for(const b of s.chipRects)assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=w&&b.y+b.height<=520);
  assert.equal(q.potential.y,q.poincare.y);assert.ok(q.a.y>q.potential.y+32);
  for(let i=0;i<s.chipRects.length;i++)for(let j=i+1;j<s.chipRects.length;j++){
   const a=s.chipRects[i],b=s.chipRects[j];assert.ok(!(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y));
  }
 }
});

test('graph chips have names without units; windows span at most five periods',()=>{
 const period=model.create().sample().period;
 for(const d of view.graphDescriptors(Object.fromEntries(model.params.map(d=>[d.key,d.value])))){
  assert.ok(!/[()·]/.test(d.label));assert.ok(d.window<=5*period+1e-10);assert.ok(d.unit);
 }
});
