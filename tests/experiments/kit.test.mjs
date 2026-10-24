import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCandidate,timelineBatches} from '../../static/js/experiments/kit/state.js';
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
