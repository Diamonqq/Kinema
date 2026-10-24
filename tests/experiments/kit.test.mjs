import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCandidate,timelineBatches,SeekController} from '../../static/js/experiments/kit/state.js';
import {model} from '../../static/js/experiments/coupled-oscillators/model.js';
import {graphTimeRange,LinkedGraph} from '../../static/js/experiments/kit/graphs.js';
import {ExperimentShell} from '../../static/js/experiments/kit/shell.js';

test('candidate rejection preserves the actual live oscillator and params',()=>{
 const values=Object.fromEntries(model.params.map(p=>[p.key,p.value])),instance=model.create(values);instance.step(.4);
 const before=instance.sample(),params=structuredClone(values);
 assert.throws(()=>prepareCandidate(model,values,{modeA:8}),/available/);
 assert.deepEqual(values,params);assert.deepEqual(instance.sample(),before);
 const candidate=prepareCandidate(model,values,{k2:40});assert.equal(candidate.values.k2,40);assert.equal(candidate.instance.t,0);assert.equal(values.k2,2);
});
test('generic forecast is lazy, bounded per batch and independent of scene state',()=>{
 let steps=0,creates=0;
 const m={create(){creates++;let t=0;return {get t(){return t},step(dt){steps++;t+=dt},sample(){return {t,x:t*t}}}}};
 const batches=timelineBatches(m,{},{});assert.equal(creates,0);assert.equal(steps,0);
 const first=batches.next().value;assert.equal(creates,1);assert.equal(steps,7);assert.equal(first.length,8);
 const samples=[...first];for(const batch of batches){assert.ok(batch.length<=8);samples.push(...batch)}
 assert.equal(samples.length,3601);assert.equal(samples.at(-1).t,60);
});
test('fixed camera envelope includes computed conservative, driven, damped and free motion',()=>{
 for(const values of [...model.presets.map(p=>p.values),{ends:'free',v1:.1}]){
  const s=model.create(values),extent=s.motionExtent(60);
  for(let i=0;i<600;i++){s.step(.1);for(const m of s.geometry().masses)assert.ok(Math.abs(m.displacement)<=extent+1e-8);}
 }
});

test('numerical seek yields between bounded chunks and commits only at the requested time',async()=>{
 const seeker=new SeekController(),calls=[];let turns=0,committed=null;
 const slow={create(){let t=0;return {get t(){return t},step(dt){const until=performance.now()+1;while(performance.now()<until){}calls.push(dt);t+=dt}}}};
 const promise=seeker.run(slow,{},.5,{yieldTurn:async()=>{turns++;await new Promise(resolve=>setTimeout(resolve,0));},onComplete:instance=>{committed=instance}});
 assert.equal(calls.length,0);assert.equal(committed,null);assert.equal(seeker.pending,true);
 let heartbeat=false;setTimeout(()=>{heartbeat=true},0);
 const result=await promise;assert.equal(result.ok,true);assert.equal(heartbeat,true);assert.ok(turns>1);
 assert.ok(calls.every(dt=>dt<=1/60+1e-12));assert.ok(Math.abs(committed.t-.5)<1e-12);assert.equal(seeker.pending,false);
});

test('newer seeks and explicit cancellation fence stale candidates',async()=>{
 const seeker=new SeekController(),commits=[],waiters=[];
 const stub={create(values){let t=0;return {tag:values.tag,get t(){return t},step(dt){t+=dt}}}};
 const old=seeker.run(stub,{tag:'old'},1,{yieldTurn:()=>new Promise(resolve=>waiters.push(resolve)),onComplete:instance=>commits.push(instance.tag)});
 const fresh=await seeker.run(stub,{tag:'new'},0,{onComplete:instance=>commits.push(instance.tag)});
 waiters.shift()();assert.equal((await old).cancelled,true);assert.equal(fresh.ok,true);assert.deepEqual(commits,['new']);
 const cancelled=seeker.run(stub,{tag:'cancelled'},1,{yieldTurn:()=>new Promise(resolve=>waiters.push(resolve)),onComplete:instance=>commits.push(instance.tag)});
 seeker.cancel();waiters.shift()();assert.equal((await cancelled).cancelled,true);assert.deepEqual(commits,['new']);assert.equal(seeker.pending,false);
});

test('analytic coupled seek remains immediate and rejected candidates never commit',async()=>{
 const seeker=new SeekController(),params=Object.fromEntries(model.params.map(p=>[p.key,p.value]));let committed=null;
 const pending=seeker.run(model,params,7.36,{immediate:true,onComplete:instance=>committed=instance});
 assert.equal(committed.t,7.36);assert.equal((await pending).ok,true);
 let error=null;const before=committed;
 assert.equal((await seeker.run(model,{...params,modeA:8},1,{onComplete:instance=>committed=instance,onError:e=>error=e})).ok,false);
 assert.ok(error);assert.equal(committed,before);
});

test('graph ranges keep zero and never pad into the wrong sign', async () => {
  const {valueRange, axisLabel} = await import('../../static/js/experiments/kit/graphs.js');
  const [lo, hi] = valueRange([0.5, 3, 14.49]);
  assert.equal(lo, 0);
  assert.ok(hi > 14.49);
  const [nlo, nhi] = valueRange([-2, -0.5]);
  assert.equal(nhi, 0);
  assert.ok(nlo < -2);
  assert.deepEqual(valueRange([0, 0]), [0, 1.12]);
  assert.equal(axisLabel(6.28e11), '6.3e11');
  assert.equal(axisLabel(2443.84), '2444');
  assert.equal(axisLabel(-1.554), '-1.55');
});

test('time-series window clamps at both ends and excludes phase spectrum and custom',()=>{
 assert.deepEqual(graphTimeRange({window:10},60,2),[0,10]);
 assert.deepEqual(graphTimeRange({window:10},60,30),[25,35]);
 assert.deepEqual(graphTimeRange({window:10},60,59),[50,60]);
 assert.deepEqual(graphTimeRange({window:10},4,3),[0,4]);
 for(const descriptor of [{},{window:0},{window:NaN},...['phase','spectrum','custom'].map(kind=>({window:10,kind}))])assert.deepEqual(graphTimeRange(descriptor,60,30),[0,60]);
});

test('windowed draw keeps full-forecast y range and maps pointer and cursor to the window',()=>{
 const text=[],lines=[],ctx=new Proxy({},{get:(_,key)=>key==='strokeStyle'?undefined:()=>{}});
 const plot=Object.create(LinkedGraph.prototype);plot.descriptor={label:'x',window:4,series:[{key:'x',label:'x'}]};
 plot.stage={w:400,h:180,ctx,resize(){},begin(){text.length=0;lines.length=0},text(...args){text.push(args)},line(...args){lines.push(args)},circle(){}};
 const samples=Array.from({length:21},(_,t)=>({t,x:t===0?100:Math.sin(t)}));
 plot.draw(samples,10);const range=plot.yRange.slice();assert.deepEqual(plot.timeRange,[8,12]);assert.equal(plot.timeAt(42),8);assert.equal(plot.timeAt(386),12);assert.equal(plot.timeAt(214),10);
 assert.ok(lines.some(l=>l[0]===214&&l[2]===214));assert.ok(text.some(l=>l[0]==='8 s'));assert.ok(text.some(l=>l[0]==='12 s'));
 plot.draw(samples,17);assert.deepEqual(plot.yRange,range);assert.deepEqual(plot.timeRange,[15,19]);assert.ok(range[1]>100);
});

const endingModel={create(){let t=0;return {get t(){return t},step(dt){t=Math.min(.37,t+dt)},sample(){return {t,x:t,ended:t>=.37}},reset(){t=0}}}};
test('generic and optimized forecasts stop at the first ended sample including time zero',()=>{
 const samples=[...timelineBatches(endingModel,{})].flat();assert.equal(samples.at(-1).t,.37);assert.equal(samples.at(-1).ended,true);assert.equal(samples.filter(p=>p.ended).length,1);
 let closed=false;const optimized={*sampleBatches(){try{yield [{t:0},{t:.37,ended:true},{t:.4}];throw Error('must not request a later batch')}finally{closed=true}}};
 assert.deepEqual([...timelineBatches(optimized,{})].flat(),[{t:0},{t:.37,ended:true}]);assert.equal(closed,true);
 assert.deepEqual([...timelineBatches({create:()=>({sample:()=>({t:0,ended:true})})},{})].flat(),[{t:0,ended:true}]);
});
test('seek settles at an ended sample before its target without a non-advancing loop',async()=>{
 const result=await new SeekController().run(endingModel,{},30,{yieldTurn:()=>Promise.resolve()});assert.equal(result.ok,true);assert.equal(result.instance.t,.37);
});
test('terminal range settles once, playback restarts at zero and parameter forecasts reset it',()=>{
 const controls={'.exp-time':{},'[data-exp=play]':{setAttribute(){}}};let pauses=0,changes=0;
 const s={endTime:null,duration:60,instance:endingModel.create(),playing:true,q:key=>controls[key],changed(){changes++},cancelSeek(){},seeker:{pending:false},setPlaying(value){pauses++;ExperimentShell.prototype.setPlaying.call(this,value)}};
 s.instance.step(1);ExperimentShell.prototype.observeEnd.call(s,s.instance.sample());assert.equal(s.duration,.37);assert.equal(controls['.exp-time'].max,.37);assert.equal(pauses,1);assert.equal(s.playing,false);
 for(let i=0;i<20;i++)ExperimentShell.prototype.observeEnd.call(s,s.instance.sample());assert.equal(pauses,1);assert.equal(changes,1);
 s.setPlaying(true);assert.equal(s.instance.t,0);assert.equal(s.playing,true);assert.equal(s.duration,.37);
});
