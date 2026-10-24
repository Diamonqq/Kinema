import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {model} from '../../static/js/experiments/rel-kinematics/model.js';

const defaults=Object.fromEntries(model.params.map(s=>[s.key,s.value]));
const applies=(spec,p)=>Object.entries(spec.appliesWhen).every(([key,allowed])=>allowed.includes(p[key]));
const changes={beta:.3,parentMass:12,mass1:2,mass2:2,mass3:2,mass4:2,kinetic:800,
  beamMomentum:200,pairFraction:.7,secondaryAngle:60,seed:2,xMin:10,xMax:150,yMin:10,yMax:150};
const contexts=[];
for(const reaction of model.params.find(s=>s.key==='reaction').options.map(o=>o.value))
 for(const inputMode of ['kinetic','momentum'])for(const distribution of ['locus','isotropic'])
  for(const plotRange of ['auto','manual'])contexts.push({...defaults,reaction,inputMode,distribution,plotRange,eventCount:8});

function observations(p){
 const instance=model.create(p),samples=[instance.sample()];
 for(const dt of [.05,.2]){instance.step(dt);samples.push(instance.sample());}
 const geometry=instance.geometry();
 // The requested RNG seed is retained as provenance even when the locus uses no RNG.
 // Compare every computed plot value/range/count, alongside all physical observables.
 delete geometry.scatter.seed;
 return {samples,invariants:instance.invariants(),geometry};
}

test('manifest and model have exactly the same applicability descriptors',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../../static/js/experiments/rel-kinematics/manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(manifest.params,model.params);
 assert.deepEqual(model.params.filter(s=>s.appliesWhen).map(s=>s.key).sort(),Object.keys(changes).sort());
 for(const spec of model.params.filter(s=>s.appliesWhen))for(const [key,values] of Object.entries(spec.appliesWhen)){
  const dependency=model.params.find(s=>s.key===key);assert.ok(dependency?.options);
  assert.ok(values.length>0);for(const value of values)assert.ok(dependency.options.some(o=>o.value===value));
 }
});

for(const spec of model.params.filter(s=>s.appliesWhen))test(`${spec.key}: inactive changes are exactly equal; an active change affects computed results (zero tolerance)`,()=>{
 let inactive=0,active=0;
 for(const p of contexts){
  const changed={...p,[spec.key]:changes[spec.key]};
  assert.notEqual(p[spec.key],changed[spec.key]);
  const a=observations(p),b=observations(changed);
  if(!applies(spec,p)){assert.deepEqual(a,b,`${spec.key} must be inert in ${JSON.stringify({reaction:p.reaction,inputMode:p.inputMode,distribution:p.distribution,plotRange:p.plotRange})}`);inactive++;}
  else if(JSON.stringify(a)!==JSON.stringify(b))active++;
 }
 assert.ok(inactive>0,'At least one non-applicable context was exercised');
 assert.ok(active>0,'At least one applicable context changes computed physics or plots');
});
