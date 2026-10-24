import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const dir=new URL('../../static/js/experiments/rigid-rotation/',import.meta.url);
const threeURL=new URL('../../static/vendor/three/build/three.module.js',import.meta.url).href;
const formatURL=new URL('../../static/js/experiments/kit/format.js',import.meta.url).href;
const modelURL='data:text/javascript;base64,'+Buffer.from(await readFile(new URL('model.js',dir),'utf8')).toString('base64');
const source=(await readFile(new URL('view.js',dir),'utf8')).replace("'/vendor/three/build/three.module.js'",JSON.stringify(threeURL)).replace("'./model.js'",JSON.stringify(modelURL)).replace("'../kit/format.js'",JSON.stringify(formatURL));
const {view}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const {model}=await import(modelURL);
const frame=params=>{const instance=model.create(params);return {instance,params,sample:instance.sample(),geometry:instance.geometry(),t:0,closeup:''};};
const recorder=()=>{const log=[];const ctx=new Proxy({},{get:(_,k)=>k==='log'?log:(...a)=>log.push([k,...a]),set:(_,k,v)=>{log.push(['set',k,v]);return true;}});return {ctx,log};};
test('gallery thumbnail draws filled, shaded faces like the scene body, not a wireframe',()=>{
 for(const preset of model.presets){
  const {ctx,log}=recorder(),f=frame(preset.values);view.draw({w:320,h:150,ctx},f);
  const fills=log.filter(e=>e[0]==='fill').length,fillStyles=new Set(log.filter(e=>e[0]==='set'&&e[1]==='fillStyle').map(e=>e[2]));
  assert.ok(fills>=2&&fills<=3,preset.id+' visible faces');
  assert.ok(fillStyles.size>=2,preset.id+' faces are lit differently');
  const xs=log.filter(e=>e[0]==='lineTo'||e[0]==='moveTo');assert.ok(xs.every(e=>e[1]>=0&&e[1]<=320&&e[2]>=0&&e[2]<=150),preset.id+' stays inside the card');
 }
});
test('fallback chip anchors stay inside the stage at phone and desktop widths',()=>{
 for(const width of [300,650])for(const preset of model.presets){const a=view.closeupAnchors({w:width,h:470},frame(preset.values));for(const p of Object.values(a)){assert.ok(p.x>=0&&p.x<=width&&p.y>=0&&p.y<=470);}}
});
test('arrow labels are placed along the arrow direction with a sticky choice and no smoothing',async()=>{
 const text=await readFile(new URL('view.js',dir),'utf8');
 assert.match(text,/LABEL_TURNS/);assert.match(text,/entry\.choice/);assert.ok(!/previous\.x\+\(target\.x-previous\.x\)/.test(text));
 assert.match(text,/textAt\('e'\+\['₁','₂','₃'\]\[i\]/);
});
test('labels avoid every recorded arrow, chips use one rule, and Scene and Breakdown share one camera scale',async()=>{
 const text=await readFile(new URL('view.js',dir),'utf8');
 assert.match(text,/hitsArrow=a=>/);assert.match(text,/const A=\(o,vec,len,color,role,order\)=>/);assert.match(text,/shell\.rotationArrows=/);
 assert.match(text,/LABEL_SIDE=/);assert.match(text,/later\(0,\(\)=>textAt\(label/);
 assert.ok(!/f\.breakdown&&!f\.closeup\?\.7/.test(text),'Breakdown no longer has its own camera factor');
 assert.ok(!/rr-breakdown \.exp-scene\{min-height:520px/.test(text),'Breakdown no longer has a taller scene');
 assert.equal((text.match(/function chipLayout\(/g)||[]).length,1);assert.ok(!/SQRT1_2/.test(text),'no diagonal chip branch');
 assert.match(text,/refH=Math\.min\(height,width<=500\?465:470\)/);
});
