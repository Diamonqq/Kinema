import test from 'node:test';
import assert from 'node:assert/strict';
import {model} from '../../static/js/experiments/collisions/model.js';
import {comparisonPanels,frameLayout,impactCaption,forecastObstacles,durationFor} from '../../static/js/experiments/collisions/view.js';
import {forceTex,massNote,forceScale} from '../../static/js/experiments/orbits/view.js';
import {placeChips} from '../../static/js/experiments/collisions/chips.js';
import {motionBatches,plot,segmentHitsRect} from '../../static/js/experiments/orbits/scene.js';
const hit=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const forecastFor=values=>{let data;for(const batch of motionBatches(model,values,{duration:durationFor(values)}))data=batch;return data;};
const layoutFor=(w,h,rows,params)=>{
 const s={w,h,line:()=>{}},panes=comparisonPanels(s,rows),lab=panes[0].map,cm=panes[1].map,first=rows[0].geometry.frames,end=rows.at(-1).geometry.frames;
 const impact=impactCaption(panes[0],first.lab,params.b),layout=frameLayout(w,h),near=rows.reduce((a,b)=>a.sample.separation<b.sample.separation?a:b).geometry.frames.lab;
 const avoid=[{x:impact.x-impact.width/2,y:impact.y-8,width:impact.width,height:16},{x:impact.bar.x-1,y:impact.bar.y,width:2,height:impact.bar.bottom-impact.bar.y}];
 const targets={contact:{x:lab.x((near[0].x+near[1].x)/2),y:lab.y((near[0].y+near[1].y)/2)},momentum:{x:lab.x(first.lab[0].x),y:lab.y(first.lab[0].y)},
  potential:{x:cm.x(first.cm[1].x),y:cm.y(first.cm[1].y)},scattering:{x:lab.x(end.lab[0].x),y:lab.y(end.lab[0].y)},'cross-section':{x:cm.x(end.cm[0].x),y:cm.y(end.cm[0].y)}};
 const result=placeChips(targets,()=>({w:110,h:32}),{width:w,top:layout.oy+8,bottom:layout.oy+layout.height-58,obstacles:forecastObstacles(panes,rows),avoid});
 s.chipRects=Object.values(result.boxes);s.targetAnchors=Object.fromEntries(Object.entries(result.boxes).map(([k,b])=>[k,{x:b.x+b.width/2,y:b.y}]));
 return {panes,targets,avoid,result,s};
};
test('collision frames re-center with the stage; scale is fixed and each chip keeps its offset from its target',()=>{
 for(const id of ['glancing','exchange']){
  const params=model.presets.find(p=>p.id===id).values,data=forecastFor(params);
  for(const [w,heights] of [[1280,[850,600,420]],[306,[640,600,560]]]){
   const [base,...rest]=heights.map(h=>layoutFor(w,h,data.rows,params));
   for(const other of rest){
    assert.equal(other.panes[0].map.scale,base.panes[0].map.scale);
    const dy=other.panes[0].rect.y-base.panes[0].rect.y;
    assert.deepEqual(other.panes.map(p=>p.rect.h),base.panes.map(p=>p.rect.h));
    for(const [i,k] of Object.keys(other.targets).entries()){
     assert.ok(Math.abs(other.targets[k].y-base.targets[k].y-dy)<1e-9,k+' target moves with the block');
     assert.ok(Math.abs((other.s.chipRects[i].y-other.targets[k].y)-(base.s.chipRects[i].y-base.targets[k].y))<1e-9,k+' chip offset');
     assert.ok(Math.abs(other.s.chipRects[i].x-base.s.chipRects[i].x)<1e-9,k+' chip x');
    }
    const last=other.panes.at(-1).rect,top=other.panes[0].rect.y,bottom=last.y+last.h;assert.ok(Math.abs(top-(heights[rest.indexOf(other)+1]-bottom))<=1.5,'block centered');
   }
  }
 }
});
test('no collision chip row at the top; leaders never cross the b caption, titles or other chips',()=>{
 for(const id of ['glancing','exchange','inelastic']){
  const params=model.presets.find(p=>p.id===id).values,data=forecastFor(params);
  for(const w of [1280,306]){
   const {targets,avoid,s,result}=layoutFor(w,w<460?560:420,data.rows,params);
   assert.equal(s.chipRects.length,5);
   const placed=Object.keys(targets).map((k,i)=>({k,box:s.chipRects[i]}));
   for(const {k,box} of placed){
    assert.ok(box.y>=8+0,k);
    const [x1,y1,x2,y2]=result.leaders[k];
    assert.ok(Math.hypot(x2-x1,y2-y1)<=(w>460?130:360),id+' '+w+' '+k+' leader is short');
    if(w>460)for(const a of avoid)assert.ok(!segmentHitsRect(x1,y1,x2,y2,a,0),id+' '+w+' '+k+' leader crosses a label');
    for(const o of placed)if(o.k!==k)assert.ok(!hit(box,o.box),'chips overlap');
   }
  }
 }
});
test('collision frames are centered with equal side margins',()=>{
 const data=forecastFor(model.presets[0].values);
 for(const w of [1280,306]){const [a,b]=comparisonPanels({w,h:420},data.rows).map(p=>p.rect);
  if(w>460)assert.ok(Math.abs(a.x-(w-(b.x+b.w)))<1e-9);else assert.ok(Math.abs(a.x-(w-(a.x+a.w)))<1e-9);}
});
test('shared graph axes use round ticks, gridlines and label zero',()=>{
 const texts=[],lines=[],s={w:400,h:300,text:(t,x,y,c,size,al)=>texts.push({t,x,y,size,al}),line:(...a)=>lines.push(a),circle:()=>{},ctx:{}};
 plot(s,[{x:-1.3,y:-0.4},{x:2.2,y:1.7}],{scatter:true});
 const labels=texts.map(t=>t.t);assert.ok(labels.includes('0'));assert.ok(texts.filter(t=>t.size===9).length>=4);
 assert.ok(lines.some(l=>l[4]==='rgba(160,180,210,0.10)'));assert.ok(lines.some(l=>l[4]==='rgba(160,180,210,0.24)'));
 for(const t of texts.filter(t=>t.al==='right'))assert.ok(t.x-String(t.t).length*5>=0,'y tick text fits the gutter');
});
test('orbit force reads in SI-prefixed newtons and the caption says so',()=>{
 assert.equal(forceTex(-6.67e10),String.raw`-66.7\;\mathrm{GN}`);assert.equal(forceTex(-2.5),String.raw`-2.50\;\mathrm{N}`);assert.equal(forceTex(-4.2e5),String.raw`-420\;\mathrm{kN}`);
 assert.equal(massNote(6.67e10),'Scaled masses · M₀ = 10¹² kg · 1 GN = 10⁹ N');assert.equal(massNote(3),'Scaled masses · M₀ = 10¹² kg');assert.equal(forceScale(6.67e10),3);
});
