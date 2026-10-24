import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {model,eventFor,sumMomentum} from '../../static/js/experiments/rel-kinematics/model.js';
import {view} from '../../static/js/experiments/rel-kinematics/view.js';
import {fakeStage,frame} from './minkowski-view.test.mjs';
test('relativity manifest matches model/view descriptors and scenario Setup stays bounded',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../../static/js/experiments/rel-kinematics/manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(manifest.params,model.params);assert.deepEqual(manifest.presets,model.presets);assert.deepEqual(manifest.closeups,view.closeups);assert.deepEqual(manifest.graphs,view.graphs);
 for(const p of model.presets){const f=frame(model,p.values);assert.ok(model.params.filter(s=>view.paramVisible(s,f.params)).length<=12);}
});
test('relativity exact graph event helper matches instance four-momentum (1e-10 MeV, MeV/c)',()=>{
 for(const p of model.presets){const f=frame(model,p.values),e=eventFor(f.params),g=f.geometry;
  for(const k of ['E','px','py','pz'])assert.ok(Math.abs(sumMomentum(e.final)[k]-sumMomentum(g.lab.final)[k])<1e-10);
 }
});
test('relativity proportional arrows, fixed camera, every preset/close-up/custom graph finite at 320/1280',()=>{
 for(const preset of model.presets)for(const w of [300,650,1200]){
  const f=frame(model,preset.values,.7),s=fakeStage(w);view.draw(s,f);const bounds=[...s.camera.bounds];
  f.instance.step(5);f.t=f.instance.t;f.geometry=f.instance.geometry();view.draw(s,f);assert.deepEqual(s.camera.bounds,bounds);
  f.breakdown=true;view.draw(s,f);assert.ok(view.equations(f).length>=5);
  for(const c of view.closeups){f.closeup=c.id;view.draw(s,f);assert.ok(view.closeupEquation(f).length>=3);}
  for(const graph of view.graphDescriptors(f.params))view.drawGraph(fakeStage(w,170),graph,f);
 }
 const f=frame(model,{reaction:'pp-pion',kinetic:1}),s=fakeStage();view.draw(s,f);assert.match(view.key(f),/below threshold/i);
});

test('pion-rest momentum locus is a screen circle with equal component scales (1e-9 px)',()=>{
 const preset=model.presets.find(p=>p.id==='pion-rest'),f=frame(model,preset.values),s=fakeStage(560,170);
 view.drawGraph(s,view.graphs.find(g=>g.id==='ellipse'),f);
 const curve=s.lines.filter(a=>a[4]==='#8ab9ff'),xs=curve.flatMap(a=>[a[0],a[2]]),ys=curve.flatMap(a=>[a[1],a[3]]);
 assert.ok(curve.length>100);
 assert.ok(Math.abs((Math.max(...xs)-Math.min(...xs))-(Math.max(...ys)-Math.min(...ys)))<1e-9);
});

test('Breakdown conservation sums follow the selected CM frame (1e-8 MeV/c)',()=>{
 const preset=model.presets.find(p=>p.id==='pion-flight'),f=frame(model,{...preset.values,frame:'cm'});
 const e=eventFor(f.params),sum=sumMomentum(e.cmInitial);
 assert.ok(Math.abs(sum.px)<1e-8);
 const equation=view.equations(f).find(x=>x.includes('E_{in}'));
 assert.match(equation,/E_\{in\}=135/);assert.match(equation,/mathrm\{MeV\}/);assert.match(equation,/\(p_x,p_y\)_\{in\}=\(0,0\)/);
});

test('physical angle and fraction graph axes stay within their domains (exact endpoint labels)',()=>{
 const f=frame(model,{reaction:'compton'});
 for(const id of ['compton','energy-angle']){const s=fakeStage(560,170);view.drawGraph(s,view.graphs.find(g=>g.id===id),f);assert.ok(s.labels.some(l=>l.text==='0'));assert.ok(s.labels.some(l=>l.text==='180'));assert.ok(!s.labels.some(l=>l.text==='-12.6'||l.text==='192.6'));}
 for(const variable of ['theta','openingAngle','cosTheta','beta']){const f=frame(model,{xVariable:variable,yVariable:variable}),s=fakeStage(560,170);view.drawGraph(s,view.graphs.find(g=>g.id==='scatter'),f);assert.ok(s.lines.flatMap(a=>a.slice(0,4)).every(Number.isFinite));}
});
test('forbidden event retains visible incoming momentum arrows and thumbnails contain no readouts',()=>{
 const f=frame(model,{reaction:'pp-pion',kinetic:1}),s=fakeStage(300,700);view.draw(s,f);
 assert.equal(s.arrows.length,3);assert.ok(s.arrows.every(a=>a[4]==='#a7b6cc'&&Math.hypot(a[2]-a[0],a[3]-a[1])>20));
 for(const [w,h] of [[280,155],[640,440]]){const s=fakeStage(w,h);view.draw(s,{...f,thumbnail:true});assert.equal(s.labels.length,0);assert.ok(s.arrows.length>0);}
});
test('energy budget groups the required bar value and signed Q within 40 px',()=>{
 const f=frame(model),s=fakeStage(560,800);f.closeup='budget';view.draw(s,f);
 const q=s.labels.find(l=>l.text.startsWith('Q = ')),values=s.labels.filter(l=>/^[0-9].* MeV$/.test(l.text));
 assert.equal(values.length,2);assert.ok(q.y-Math.max(...values.map(l=>l.y))<=40);
});

test('Breakdown units, matching component names, conditional legends and single graph titles',()=>{
 for(const preset of model.presets){const f=frame(model,preset.values),e=eventFor(f.params),text=view.equations(f).join(' ');
  assert.ok(!text.includes('perp'));if(e.final.length){assert.match(text,/p_\{1y\}/);assert.match(text,/mathrm\{MeV\}\/c/);}
  assert.equal(view.key(f).includes('green p3'),e.final.length===3 && e.W-e.requiredMass>=Math.max(1e-6,e.requiredMass*1e-4));
  for(const d of view.graphDescriptors(f.params)){const s=fakeStage(300,170);view.drawGraph(s,d,f);assert.ok(!s.labels.some(l=>l.text===d.label));}
  f.breakdown=true;const s=fakeStage(300,550);view.draw(s,f);assert.ok(!s.labels.some(l=>l.text==='p in'||l.text.includes('\u03b8')));
 }
});

test('captions distinguish absent incoming arrows and coincident threshold products',()=>{
 const rest=frame(model,model.presets.find(p=>p.id==='pion-rest').values);assert.ok(!view.key(rest).includes('incoming'));
 const threshold=frame(model,model.presets.find(p=>p.id==='threshold').values);assert.match(view.key(threshold),/Products move together near threshold/);assert.ok(!view.key(threshold).includes('green p3'));
 for(const p of model.presets){const equations=view.equations(frame(model,p.values));assert.ok(!equations.some(x=>x.includes('Particle units')));assert.ok(equations.some(x=>x.includes('E_{in}')&&x.includes('mathrm{MeV}')));}
});
