import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCandidate,timelineBatches,SeekController} from '../../static/js/experiments/kit/state.js';
import {model} from '../../static/js/experiments/coupled-oscillators/model.js';

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
