import test from 'node:test';
import assert from 'node:assert/strict';
import {model} from '../../static/js/experiments/collisions/model.js';
import {comparisonPanels,frameLayout,impactCaption,forecastObstacles,forecastSegments,exitPoint,durationFor,view} from '../../static/js/experiments/collisions/view.js';
import {placeChips} from '../../static/js/experiments/collisions/chips.js';
import {forceTex,massNote,forceScale} from '../../static/js/experiments/orbits/view.js';
import {motionBatches,plot,segmentHitsRect} from '../../static/js/experiments/orbits/scene.js';
const hit=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const forecastFor=values=>{let data;for(const batch of motionBatches(model,values,{duration:durationFor(values)}))data=batch;return data;};
const gap=(p,r)=>Math.hypot(p.x-Math.max(r.x,Math.min(r.x+r.width,p.x)),p.y-Math.max(r.y,Math.min(r.y+r.height,p.y)));
const layoutFor=(w,h,rows,params)=>{
 const s={w,h,line:()=>{}},panes=comparisonPanels(s,rows),lab=panes[0].map,cm=panes[1].map,first=rows[0].geometry.frames,layout=frameLayout(w,h),near=rows.reduce((a,b)=>a.sample.separation<b.sample.separation?a:b).geometry.frames.lab;
 const impact=impactCaption(panes[0],first.lab,params.b);
 const avoid=[{x:impact.x-impact.width/2,y:impact.y-8,width:impact.width,height:16},{x:impact.bar.x-1,y:impact.bar.y,width:2,height:impact.bar.bottom-impact.bar.y},...panes.map(({rect})=>({x:rect.x+rect.w/2-48,y:rect.y-17,width:96,height:17}))];
 const targets={contact:{x:lab.x((near[0].x+near[1].x)/2),y:lab.y((near[0].y+near[1].y)/2)},momentum:{x:lab.x(first.lab[0].x),y:lab.y(first.lab[0].y)},
  potential:{x:cm.x(first.cm[1].x),y:cm.y(first.cm[1].y)},scattering:exitPoint(rows,panes[0],'lab',0),'cross-section':exitPoint(rows,panes[1],'cm',0)};
 const rects=forecastObstacles(panes,rows),segments=forecastSegments(panes,rows);
 const result=placeChips(targets,()=>({w:w<460?100:110,h:w<460?24:32}),{width:w,top:layout.oy+8,bottom:layout.oy+layout.height-58,rects,segments,avoid});
 s.chipRects=Object.values(result.boxes);
 return {panes,targets,avoid,rects,segments,result,s};
};
test('collision frames re-center with the stage; scale is fixed and each chip keeps its offset from its target',()=>{
 for(const id of ['glancing','exchange']){
  const params=model.presets.find(p=>p.id===id).values,data=forecastFor(params);
  for(const [w,heights] of [[569,[850,600,520]],[306,[640,600,560]]]){
   const [base,...rest]=heights.map(h=>layoutFor(w,h,data.rows,params));
   for(const [n,other] of rest.entries()){
    assert.equal(other.panes[0].map.scale,base.panes[0].map.scale);
    const dy=other.panes[0].rect.y-base.panes[0].rect.y;
    assert.deepEqual(other.panes.map(p=>p.rect.h),base.panes.map(p=>p.rect.h));
    for(const [i,k] of Object.keys(other.targets).entries()){
     assert.ok(Math.abs(other.targets[k].y-base.targets[k].y-dy)<1e-9,k+' target moves with the block');
     assert.ok(Math.abs((other.s.chipRects[i].y-other.targets[k].y)-(base.s.chipRects[i].y-base.targets[k].y))<1e-9,k+' chip offset');
     assert.ok(Math.abs(other.s.chipRects[i].x-base.s.chipRects[i].x)<1e-9,k+' chip x');
    }
    const last=other.panes.at(-1).rect,top=other.panes[0].rect.y,bottom=last.y+last.h;assert.ok(Math.abs(top-(heights[n+1]-bottom))<=1.5,'block centered');
   }
  }
 }
});
test('each zoom chip sits beside its own target (about 40 px) with no leader, off the drawing and every label',()=>{
 for(const id of ['glancing','exchange','inelastic','rutherford']){
  const params=model.presets.find(p=>p.id===id).values,data=forecastFor(params);
  for(const w of [569,306]){
   const {targets,avoid,rects,segments,s}=layoutFor(w,w<460?560:520,data.rows,params);
   assert.equal(s.chipRects.length,5);
   for(const [i,k] of Object.keys(targets).entries()){
    const box=s.chipRects[i];
    assert.ok(box.y>=8&&box.x>=8&&box.x+box.width<=w-8,id+' '+w+' '+k+' inside the stage');
    assert.ok(gap(targets[k],box)<=48,id+' '+w+' '+k+' within reach of its target: '+gap(targets[k],box));
    assert.ok(gap(targets[k],box)>=8,id+' '+w+' '+k+' does not cover its target');
    for(const a of [...avoid,...rects])assert.ok(!hit(box,a),id+' '+w+' '+k+' covers the drawing or a label');
    for(const l of segments)assert.ok(!segmentHitsRect(l[0],l[1],l[2],l[3],box,0),id+' '+w+' '+k+' sits on a drawn line');
    for(const [j,o] of s.chipRects.entries())if(j!==i)assert.ok(!hit(box,o),'chips overlap');
   }
  }
 }
});
test('frames are drawn around the encounter: both bodies at the start and at closest approach sit well inside, centered',()=>{
 for(const id of ['glancing','exchange','inelastic']){
  const params=model.presets.find(p=>p.id===id).values,data=forecastFor(params),near=data.rows.reduce((a,b)=>a.sample.separation<b.sample.separation?a:b);
  for(const w of [569,306]){
   const panes=comparisonPanels({w,h:w<460?560:520},data.rows);
   for(const [i,frame] of ['lab','cm'].entries()){
    const {rect,map}=panes[i],pts=[...data.rows[0].geometry.frames[frame],...near.geometry.frames[frame]].map(q=>({x:map.x(q.x),y:map.y(q.y)}));
    const x0=Math.min(...pts.map(p=>p.x)),x1=Math.max(...pts.map(p=>p.x)),y0=Math.min(...pts.map(p=>p.y)),y1=Math.max(...pts.map(p=>p.y));
    assert.ok(x0>=rect.x+8&&x1<=rect.x+rect.w-8&&y0>=rect.y+8&&y1<=rect.y+rect.h-8,id+' '+w+' '+frame+' inside');
    assert.ok(Math.abs((x0+x1)/2-(rect.x+rect.w/2))<=rect.w*.1&&Math.abs((y0+y1)/2-(rect.y+rect.h/2))<=rect.h*.1,id+' '+w+' '+frame+' centered');
    assert.ok(x1-x0>=rect.w*.3,id+' '+w+' '+frame+' large share: '+(x1-x0)/rect.w);
   }
  }
 }
});
test('Breakdown momentum lines carry units and drop a vanishing term',()=>{
 const params=model.presets.find(p=>p.id==='glancing').values,sim=model.create(params),q=sim.sample();
 const lines=view.equations({params,sample:q});
 assert.ok(lines.every(l=>!/\+\s*\(/.test(l)),'no + (0)');
 assert.ok(lines.filter(l=>/^P_[xy]/.test(l)).every(l=>l.includes('kg\\,m/s')),'every P line carries its unit');
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
