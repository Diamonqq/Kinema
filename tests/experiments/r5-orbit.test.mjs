import test from 'node:test';
import assert from 'node:assert/strict';
import {model as orbits} from '../../static/js/experiments/orbits/model.js';
import {model as collisions} from '../../static/js/experiments/collisions/model.js';
import {orbitChipLayout,orbitBounds,orbitCamera,equalTimeSectors,ORBIT_ANCHORS,ORBIT_GAPS} from '../../static/js/experiments/orbits/view.js';
import {momentumArrows,comparisonPanels,durationFor} from '../../static/js/experiments/collisions/view.js';
import {motionBatches} from '../../static/js/experiments/orbits/scene.js';
import {placeChips} from '../../static/js/experiments/collisions/chips.js';
const forecast=(model,values,duration)=>{let data;for(const b of motionBatches(model,values,{duration}))data=b;return data;};
test('momentum arrows keep their true proportion and their heads stay clear of the CM marker',()=>{
 for(const id of ['glancing','exchange','heavy','inelastic']){
  const p=collisions.presets.find(d=>d.id===id).values,data=forecast(collisions,p,durationFor(p)),panes=comparisonPanels({w:306,h:560},data.rows);
  for(const [i,frame] of ['lab','cm'].entries()){
   const {map,rect}=panes[i],bodies=data.rows[0].geometry.frames[frame],total=bodies[0].mass+bodies[1].mass,
    cx=map.x((bodies[0].mass*bodies[0].x+bodies[1].mass*bodies[1].x)/total),cy=map.y((bodies[0].mass*bodies[0].y+bodies[1].mass*bodies[1].y)/total),arrows=momentumArrows(bodies,map,rect);
   arrows.forEach(a=>{const len=Math.hypot(a.ex-a.x,a.ey-a.y);if(len<1)return;
    const ux=(a.ex-a.x)/len,uy=(a.ey-a.y)/len,t=(cx-a.x)*ux+(cy-a.y)*uy,off=Math.abs((cx-a.x)*uy-(cy-a.y)*ux);
    assert.ok(!(off<10&&t>=24)||len<=t-11.5,id+' '+frame+' '+a.id+' head clear of the CM: '+len+' vs '+t);});
   const p1=bodies[0].mass*Math.hypot(bodies[0].vx,bodies[0].vy),p2=bodies[1].mass*Math.hypot(bodies[1].vx,bodies[1].vy),l=arrows.map(a=>Math.hypot(a.ex-a.x,a.ey-a.y));
   if(l[0]>1&&l[1]>1)assert.ok(Math.abs(l[0]/l[1]-p1/p2)<1e-6*Math.max(1,p1/p2),id+' '+frame+' arrows share one scale');
  }
 }
});
const inside=(poly,x,y)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;};
test('orbit zoom chips stay out of the shaded sectors, beside their target',()=>{
 const p=Object.fromEntries(orbits.params.map(d=>[d.key,d.value])),data=forecast(orbits,p,60),rows=data.rows;
 for(const [w,h,cw,ch] of [[306,500,[84,75,67],24],[569,464,[85,86.5,77.8],32]]){
  const map=orbitCamera({w,h},orbitBounds(rows,p,p.frame),false),L=orbitChipLayout(rows,p,map,w),ids=['periapsis','area','barycentre'];
  const sizes=id=>({w:cw[ids.indexOf(id)],h:ch}),placed=placeChips(L.targets,sizes,{width:w,top:8,bottom:h-100,rects:L.rects,segments:L.segments,prefer:ORBIT_ANCHORS,gaps:ORBIT_GAPS}),f=rows[0].geometry.bodies[0];
  const polys=equalTimeSectors(rows,rows[0].sample.period||12).filter(b=>b.length>1).map(b=>[[map.x(f.x),map.y(f.y)],...b.map(q=>{const r=q.geometry.relativeInertial||q.geometry.relative;return [map.x(f.x+r.x),map.y(f.y+r.y)];})]);
  for(const [id,b] of Object.entries(placed.boxes))for(let x=b.x;x<=b.x+b.width;x+=3)for(let y=b.y;y<=b.y+b.height;y+=3)
   for(const poly of polys)assert.ok(!inside(poly,x,y),w+' '+id+' chip is not inside a shaded sector at '+x+','+y);
 }
});
