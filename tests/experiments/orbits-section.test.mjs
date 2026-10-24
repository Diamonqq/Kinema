import test from 'node:test';
import assert from 'node:assert/strict';
import {sectionBatches,startSection,crossingElapsed} from '../../static/js/experiments/orbits/section.js';
import {plot,sectionTick} from '../../static/js/experiments/orbits/scene.js';

test('chaotic Comet section supplies at least 100 genuine crossings within its bounded horizon (time order tolerance 1e-8 s)',()=>{
 let final,prior=0;
 for(const state of sectionBatches({system:'jupiter-comet'})){
  assert.ok(state.time>=prior-1e-8);assert.ok(state.time-prior<=32+1e-8);prior=state.time;final=state;
 }
 assert.equal(final.done,true);assert.ok(final.points.length>=100&&final.points.length<=320);
 if(final.points.length===320)assert.equal(final.reason,'Complete');
 else {assert.equal(final.reason,'Time limit');assert.ok(Math.abs(final.time-100000)<1e-8);}
 assert.ok(final.time<=100000);
 for(let i=0;i<final.points.length;i++){
  const p=final.points[i];assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.vx));assert.equal(p.y,0);
  if(i)assert.ok(p.t>final.points[i-1].t);
 }
});

test('long section yields before work, cancels on inactive lifecycle, and leaves no scheduled batch',()=>{
 const queue=[],cancelled=[];let active=true;
 const options={schedule:f=>(queue.push(f),queue.length),unschedule:id=>cancelled.push(id),active:()=>active,options:{horizon:1,batch:1,advance:.01}};
 const state=startSection({system:'jupiter-comet'},options);
 assert.equal(state.time,0);queue.shift()();assert.ok(state.time>0);const t=state.time;
 active=false;queue.shift()();assert.equal(state.cancelled,true);assert.equal(state.time,t);assert.equal(queue.length,0);
 for(const reason of ['close','param change','destroy']){
  const job=startSection({system:'jupiter-comet'},options);job.cancel();queue.shift()();assert.equal(job.time,0,reason);assert.equal(job.cancelled,true);
 }
 assert.ok(cancelled.length>=4);
});

test('section point brightness follows time while final axes remain identical (0 tolerance)',()=>{
 const noop=()=>{},colors=[],s={w:320,h:340,text:noop,line:noop,circle:(x,y,r,c)=>colors.push(c)};
 const pts=[{x:1,y:2,t:2},{x:2,y:3,t:100}];
 const first=plot(s,pts,{scatter:true,pointColor:p=>p.t<=60?'bright':'dim'});
 assert.deepEqual(colors,['bright','dim']);
 const second=plot(s,pts,{scatter:true,pointColor:()=> 'bright'});assert.deepEqual(first,second);
});

test('reverse crossing highlighting uses elapsed physical time, matching the positive scrubber (0 tolerance)',()=>{
 assert.equal(crossingElapsed({t:-100}),100);assert.equal(crossingElapsed({t:60}),60);
 assert.ok(crossingElapsed({t:-100})>60);assert.ok(crossingElapsed({t:-2})<=60);
});

test('section tick labels are rounded and occupy a separate row above the caption (at least 6 px)',()=>{
 assert.equal(sectionTick(-303.46),'\u2212300');assert.equal(sectionTick(-1.78),'\u22121.8');assert.equal(sectionTick(1.78),'1.8');
 const labels=[],noop=()=>{},s={w:320,h:280,text:(text,x,y,color,size)=>labels.push({text,y,size}),line:noop,circle:noop};
 plot(s,[{x:-303.46,y:-1.78},{x:51.14,y:1.78}],{scatter:true,tickFormat:sectionTick,label:'264 crossings'});
 const tick=labels.find(l=>l.text==='\u2212300'),caption=labels.find(l=>l.text==='264 crossings');
 assert.ok(caption.y-caption.size/2-(tick.y+tick.size/2)>=6);
});
