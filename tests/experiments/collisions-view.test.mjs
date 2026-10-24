import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {model,scatteringCurve} from '../../static/js/experiments/collisions/model.js';
import {view,durationFor,scatteringGrid,sectionPoints,comparisonPanels,encounterPreview,forecastObstacles,transportWindow,timelineModel} from '../../static/js/experiments/collisions/view.js';
import {motionBatches,boundsFor,plot,targetChips} from '../../static/js/experiments/orbits/scene.js';
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
  assert.ok(panels[0].rect.y>=60);if(w===320)for(const p of panels)assert.ok(p.rect.h>=150);
  if(w===320)assert.ok(panels[1].rect.y-(panels[0].rect.y+panels[0].rect.h)>=38);
 }
});

test('hard contact preview uses exact event radii; chips avoid both full forecast paths at both widths (1e-9 m)',()=>{
 for(const id of ['exchange','glancing','inelastic']){
  const p=model.presets.find(p=>p.id===id).values;let data;
  for(const batch of motionBatches(model,p,{duration:durationFor(p)}))data=batch;
  const preview=encounterPreview(p,data.rows),b=preview.geometry.frames.cm;
  assert.ok(Math.abs(Math.hypot(b[0].x-b[1].x,b[0].y-b[1].y)-b[0].radius-b[1].radius)<1e-9);
  for(const w of [560,300]){
   const s={w,h:w<460?640:440,line:()=>{}},panes=comparisonPanels(s,data.rows),lab=panes[0].map;
   const nearest=data.rows.reduce((a,b)=>a.sample.separation<b.sample.separation?a:b).geometry.frames.lab,start=data.rows[0].geometry.frames.lab[0];
   const obstacles=forecastObstacles(panes,data.rows);
   targetChips(s,{contact:{x:lab.x((nearest[0].x+nearest[1].x)/2),y:lab.y((nearest[0].y+nearest[1].y)/2)},momentum:{x:lab.x(start.x),y:lab.y(start.y)}},['potential','scattering','cross-section'],null,obstacles);
   for(const rect of s.chipRects.slice(-2))for(const a of obstacles)
    assert.ok(!(rect.x<a.x+a.width&&rect.x+rect.width>a.x&&rect.y<a.y+a.height&&rect.y+rect.height>a.y),id+' '+w+' '+JSON.stringify(rect));
  }
 }
});

test('exact impulse displays approaching u_n and restitution-consistent outgoing u_n at both widths (1e-12 m/s)',()=>{
 const preset=model.presets.find(p=>p.id==='glancing').values;
 for(const e of [1,.4,0]){
  const p={...preset,restitution:e};let data;
  for(const batch of motionBatches(model,p,{duration:durationFor(p)}))data=batch;
  const results=[1280,320].map(width=>{
   const preview=encounterPreview(p,data.rows);assert.ok(preview.impact.before<0);
   assert.ok(Math.abs(preview.impact.after+e*preview.impact.before)<1e-12);
   if(e===1)assert.ok(Math.abs(Math.abs(preview.impact.after)-Math.abs(preview.impact.before))<1e-12);
   const event=data.rows.find(row=>row.geometry.contact).geometry.contact;
   assert.equal(preview.t,event.t);assert.equal(preview.impact.before,event.relativeNormalBefore);
   return {t:preview.t,...preview.impact};
  });
  assert.deepEqual(results[0],results[1]);
 }
});

test('600 repeated draws do not restart the kit forecast; duration is applied after the kit reset',()=>{
 const p={...model.presets.find(p=>p.id==='glancing').values},slider={max:60};let starts=0;
 const shell={params:p,duration:60,q:()=>slider,startForecast(){starts++;this.duration=60;slider.max=60;}};
 for(let i=0;i<600;i++)transportWindow(shell);
 assert.equal(starts,1);assert.equal(shell.duration,durationFor(p));assert.equal(slider.max,durationFor(p));
 shell.params={...p,speed:3};for(let i=0;i<600;i++)transportWindow(shell);
 assert.equal(starts,2);assert.equal(shell.duration,durationFor(shell.params));assert.equal(slider.max,shell.duration);
});
test('kit forecast iterator ends exactly at the collision window rather than the captured 60 s cap (1e-9 s)',async()=>{
 const {timelineBatches}=await import('../../static/js/experiments/kit/state.js');
 for(const speed of [2,3]){
  const p={...model.presets.find(p=>p.id==='glancing').values,speed};let last,count=0;
  for(const rows of timelineBatches(timelineModel,p,{duration:60,batchSize:8})){last=rows.at(-1);count+=rows.length;}
  assert.ok(last.ended);assert.ok(Math.abs(last.t-durationFor(p))<1e-9);assert.ok(count<600);
 }
 assert.ok(!('ended' in model.create().sample()),'the headless core retains unrestricted integration');
});
