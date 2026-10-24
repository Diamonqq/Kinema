import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {model,scatteringCurve} from '../../static/js/experiments/collisions/model.js';
import {view,durationFor,scatteringGrid,sectionPoints,comparisonPanels} from '../../static/js/experiments/collisions/view.js';
import {motionBatches,boundsFor,plot} from '../../static/js/experiments/orbits/scene.js';
test('collision manifest matches every descriptor, preset, close-up and graph',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('../../static/js/experiments/collisions/manifest.json',import.meta.url)));
 assert.deepEqual(m.params,model.params);assert.deepEqual(m.presets,model.presets);assert.deepEqual(m.closeups,view.closeups);assert.deepEqual(m.graphs,view.graphs);
 for(const graph of view.graphs)for(const series of (graph.series||[]))assert.ok(Number.isFinite(model.create().sample()[series.key]),series.key);
});
test('lab and CM envelopes frame the full 60 s actual motion; histories are independent (1e-10 m)',()=>{
 for(const id of ['exchange','glancing','inelastic','rutherford']){
  const preset=model.presets.find(p=>p.id===id);assert.ok(preset,id);let result;
  for(const batch of motionBatches(model,preset.values))result=batch;
  for(const frame of ['lab','cm']){const b=boundsFor(result.rows,frame);for(const row of result.rows)for(const p of row.geometry.frames[frame])assert.ok(p.x>=b[0]-1e-10&&p.x<=b[1]+1e-10&&p.y>=b[2]-1e-10&&p.y<=b[3]+1e-10);}
  const first=result.rows[0].geometry.frames.lab[0];assert.equal(first.x,-preset.values.distance);assert.equal(first.y,preset.values.b);
 }
});


test('collision transport and forecast share the declared encounter window (0 tolerance)',()=>{
 const p=model.presets.find(p=>p.id==='glancing').values,control={max:60};let starts=0;
 const shell={params:p,duration:60,stage:{},q:()=>control,startForecast:()=>starts++};
 assert.equal(view.mount(shell),undefined);assert.equal(shell.duration,9.6);assert.equal(control.max,9.6);assert.equal(starts,1);
 assert.equal(durationFor({...p,distance:100}),60);
 let result;for(const batch of motionBatches(model,p,{duration:shell.duration}))result=batch;
 assert.ok(Math.abs(result.rows.at(-1).t-shell.duration)<1e-10);
});

test('Rutherford preset completes its finite encounter within its declared playback window',()=>{
 const p=model.presets.find(p=>p.id==='rutherford').values;
 assert.equal(scatteringCurve(p,[p.b],{duration:durationFor(p)})[0].complete,true);
});

test('displayed hard-sphere cross section is the numerical R2/4 plateau within 0.001 m2, not a grazing-grid artifact',()=>{
 const p=model.presets.find(p=>p.id==='glancing').values,points=scatteringGrid(p).flatMap(b=>scatteringCurve(p,[b],{duration:30,dt:.2})),section=sectionPoints(p,points);
 assert.equal(section.length,81);for(const row of section)assert.ok(Math.abs(row.sigma-p.radius**2/4)<.001);
});

test('cross-section axes include zero so sub-percent differentiation noise is not magnified into apparent physics',()=>{
 const noop=()=>{},s={w:320,h:170,text:noop,line:noop,ctx:{beginPath:noop,moveTo:noop,lineTo:noop,stroke:noop}};
 const b=plot(s,[{x:1,y:.2499},{x:2,y:.25}],{zero:true});assert.equal(b.lo,0);assert.ok(b.hi-b.lo>=.25);
});

test('Lab and CM share one physical pixel scale and separate header rows at desktop and narrow widths (1e-10 px)',()=>{
 let result;const p=model.presets.find(p=>p.id==='glancing').values;
 for(const batch of motionBatches(model,p,{duration:durationFor(p)}))result=batch;
 for(const w of [1280,320]){
  const panels=comparisonPanels({w,h:w===320?620:460},result.rows);
  assert.equal(panels[0].map.scale,panels[1].map.scale);assert.ok(panels[0].map.scale>0);
  for(const [i,frame] of ['lab','cm'].entries())for(const row of result.rows)for(const b of row.geometry.frames[frame]){
   const {rect,map}=panels[i];assert.ok(map.x(b.x)>=rect.x-1e-10&&map.x(b.x)<=rect.x+rect.w+1e-10);
   assert.ok(map.y(b.y)>=rect.y-1e-10&&map.y(b.y)<=rect.y+rect.h+1e-10);
  }
  assert.ok(panels[0].rect.y>=112);if(w===320)for(const p of panels)assert.ok(p.rect.h>=150);
  if(w===320)assert.ok(panels[1].rect.y-(panels[0].rect.y+panels[0].rect.h)>=38);
 }
});
