import test from 'node:test';
import assert from 'node:assert/strict';
import {model as orbitModel} from '../../static/js/experiments/orbits/model.js';
import {model as collisionModel} from '../../static/js/experiments/collisions/model.js';
import {forecast,targetChips} from '../../static/js/experiments/orbits/scene.js';
import {startSection} from '../../static/js/experiments/orbits/section.js';
import {curveFor} from '../../static/js/experiments/collisions/view.js';

const defaults=model=>Object.fromEntries(model.params.map(p=>[p.key,p.value]));
const jobs=[
 ['orbit forecast',(p,o)=>forecast(orbitModel,p,{...o,duration:.4}),()=>({...defaults(orbitModel)})],
 ['Poincare section',(p,o)=>startSection(p,{...o,options:{horizon:.1,batch:1,advance:.01}}),()=>({system:'jupiter-comet'})],
 ['collision scattering',(p,o)=>curveFor(p,o),()=>({...defaults(collisionModel)})]
];
function harness(){
 const controller=new AbortController(),queue=[],removed=[];let publications=0;
 return {controller,queue,removed,get publications(){return publications;},
  options:{signal:controller.signal,schedule:f=>(queue.push(f),queue.length),unschedule:id=>removed.push(id),invalidate:()=>publications++},
  run(){const f=queue.shift();if(f)f();}};
}
for(const [name,start,params] of jobs){
 test(name+': abort stops all later publication and wakes the paused view on progress',()=>{
  const h=harness(),state=start(params(),h.options);if(!h.publications)h.run();
  assert.ok(h.publications>0,'every progress publication invalidates');
  const before=h.publications,rows=state.rows?.length,points=state.points?.length,time=state.time;
  h.controller.abort();assert.equal(state.cancelled,true);assert.ok(h.removed.length);
  // Exercise already-queued callbacks even after clearTimeout: they must be inert.
  while(h.queue.length)h.run();
  assert.equal(h.publications,before);assert.equal(state.rows?.length,rows);assert.equal(state.points?.length,points);assert.equal(state.time,time);
 });
 test(name+': a restarted setup cannot be overwritten by old queued callbacks',()=>{
  const p=params(),old=harness(),a=start(p,old.options);if(!old.publications)old.run();
  old.controller.abort();const fresh=harness(),b=start(p,fresh.options);
  assert.notEqual(a,b);while(fresh.queue.length)fresh.run();assert.equal(b.done,true);
  const snapshot=JSON.stringify({rows:b.rows,points:b.points,time:b.time}),count=fresh.publications;
  while(old.queue.length)old.run();assert.equal(fresh.publications,count);
  assert.equal(JSON.stringify({rows:b.rows,points:b.points,time:b.time}),snapshot);
  assert.ok(!b.cancelled);assert.ok(b.rows?.length||b.points?.length||b.time>0);
 });
}
test('chip layout is reused for identical geometry, dimensions and setup; changes invalidate the cache',()=>{
 let reads=0;const shell={params:{},q:()=>{reads++;return {offsetWidth:100,offsetHeight:32};}};
 const s={w:560,h:440,line:()=>{}},targets={contact:{x:220,y:220}},ids=['potential'];
 const a=targetChips(s,targets,ids,shell),before=reads;
 assert.equal(targetChips(s,{contact:{x:220,y:220}},ids,shell),a);assert.equal(reads,before);
 s.w=320;const b=targetChips(s,targets,ids,shell);assert.notEqual(a,b);
 shell.params={};assert.notEqual(targetChips(s,targets,ids,shell),b);
});
