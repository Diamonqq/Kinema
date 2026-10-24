import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {model,C} from '../../static/js/experiments/minkowski/model.js';
import {view,boundsFor} from '../../static/js/experiments/minkowski/view.js';
import {clipLine} from '../../static/js/experiments/minkowski/drawing.js';
export function fakeStage(w=640,h=440){
 const noop=()=>{},s={w,h,snap:true,labels:[],lines:[],ctx:new Proxy({measureText:text=>({width:String(text).length*6})},{get:(o,k)=>o[k]??noop})};
 for(const k of ['line','arrow','circle'])s[k]=(...a)=>{assert.ok(a.slice(0,k==='circle'?3:4).every(Number.isFinite),k+' finite coordinates');if(k==='line')s.lines.push(a);};
 s.text=(text,x,y,color,size=13,align='center')=>{assert.ok(Number.isFinite(x+y));const width=String(text).length*size*.5;s.labels.push({text,x:x-(align==='center'?width/2:align==='right'?width:0),y:y-size/2,width,height:size});};
 return s;
}
export function frame(model,values={},t=0){const params={...Object.fromEntries(model.params.map(a=>[a.key,a.value])),...values},instance=model.create(params);instance.step(t);return {params,instance,t,sample:instance.sample(),geometry:instance.geometry(),breakdown:false,closeup:'',samples:[model.create(params).sample(),instance.sample()]};}
test('minkowski manifest exactly matches model and view descriptors; setup remains scoped',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../../static/js/experiments/minkowski/manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(manifest.params,model.params);assert.deepEqual(manifest.presets,model.presets);assert.deepEqual(manifest.closeups,view.closeups);assert.deepEqual(manifest.graphs,view.graphs);
 for(const p of model.presets){const f=frame(model,p.values);assert.ok(model.params.filter(s=>view.paramVisible(s,f.params)).length<=12,p.id+' scoped fields');}
});
test('minkowski bounds stay fixed, light rays have 45° screen slope (1e-9 px), clipping stays in pane (1e-9 px)',()=>{
 const f=frame(model),s=fakeStage();view.draw(s,f);const initial=[...s.camera.bounds];
 const rays=s.lines.filter(a=>a[4]==='#e9bb8840');assert.ok(rays.length>=2);for(const a of rays)assert.ok(Math.abs(Math.abs(a[2]-a[0])-Math.abs(a[3]-a[1]))<1e-9);
 f.instance.step(4);f.t=4;f.geometry=f.instance.geometry();f.sample=f.instance.sample();view.draw(s,f);assert.deepEqual(s.camera.bounds,initial);
 assert.deepEqual(boundsFor(f.geometry,C),initial);
 const clipped=clipLine(-5,-5,15,15,{left:0,top:0,width:10,height:10});assert.deepEqual(clipped,[0,0,10,10]);
});
test('minkowski all presets, close-ups and graphs draw finite data at 320 and 1280; equations are present',()=>{
 for(const preset of model.presets)for(const w of [300,650,1200]){
  const f=frame(model,preset.values,.7),s=fakeStage(w);view.draw(s,f);f.breakdown=true;view.draw(s,f);assert.ok(view.equations(f).length>=4);
  for(const closeup of view.closeups){f.closeup=closeup.id;view.draw(s,f);assert.ok(view.closeupEquation(f).length>=2);}
  for(const graph of view.graphDescriptors(f.params))if(graph.kind==='custom')view.drawGraph(fakeStage(w,170),graph,f);
 }
 const f=frame(model,{scenario:'objects',betaY:.2});assert.ok(view.equations(f).some(x=>x.includes('boldsymbol')));
});
