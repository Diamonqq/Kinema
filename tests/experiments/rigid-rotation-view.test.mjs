import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const dir=new URL('../../static/js/experiments/rigid-rotation/',import.meta.url);
const load=async name=>import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL(name,dir),'utf8')).toString('base64'));
const {model}=await load('model.js');
const source=await readFile(new URL('view.js',dir),'utf8');
const modelURL='data:text/javascript;base64,'+Buffer.from(await readFile(new URL('model.js',dir),'utf8')).toString('base64');
// Pure equation/descriptor tests only. Actual three.js is checked by the browser fixture.
const {view,available,sceneLayout,cameraExtentFactor,readoutNumber,graphWindow,finitePatchScale}=await import('data:text/javascript;base64,'+Buffer.from(source.replace(/^import .*;\r?\n/,'const THREE={};\n').replace("'./model.js'",JSON.stringify(modelURL))).toString('base64'));
const manifest=JSON.parse(await readFile(new URL('manifest.json',dir),'utf8'));
const frame=values=>{const instance=model.create(values);return {instance,params:values,sample:instance.sample(),geometry:instance.geometry(),t:0,closeup:''};};
test('manifest matches every model parameter and complete preset exactly (zero tolerance)',()=>{
 assert.equal(manifest.group,'Mechanics');assert.deepEqual(manifest.params,model.params);assert.deepEqual(manifest.presets,model.presets);assert.deepEqual(manifest.closeups,view.closeups);assert.deepEqual(manifest.graphs,view.graphs);
 for(const d of manifest.params)if(d.options)assert.ok(d.options.every(o=>Object.hasOwn(o,'value')&&o.label));
});
test('every graph samples finite physical fields in every preset (zero missing fields)',()=>{
 for(const p of model.presets){const f=frame(p.values);for(const graph of view.graphs)for(const series of graph.series)assert.ok(Number.isFinite(f.sample[series.key]),p.id+' '+series.key);}
});
test('every closeup is reachable and supplies symbolic and live substituted equations',()=>{
 const found=new Set();for(const preset of model.presets){const f=frame(preset.values);for(const id of available(f)){found.add(id);const equations=view.closeupEquation({...f,closeup:id});assert.ok(equations.length>=2,id);assert.ok(equations.every(e=>!e.includes('NaN')&&!e.includes('undefined')&&!e.includes('Infinity')),id);}}
 assert.deepEqual([...found].sort(),view.closeups.map(c=>c.id).sort());
});
test('Euler decomposition uses signed body torque and cyclic principal terms',()=>{
 const p=model.presets.find(p=>p.id==='torque').values,f=frame(p),eq=view.equations(f);assert.equal(eq.length,8);assert.match(eq[0],/I_1.*tau_1.*I_2-I_3/);assert.match(eq[2],/I_2.*tau_2.*I_3-I_1/);assert.match(eq[4],/I_3.*tau_3.*I_1-I_2/);
 const heavy=frame(model.presets.find(p=>p.id==='slow').values);assert.ok(view.equations(heavy).some(e=>e.includes('mathbf r')&&e.includes('times')));
});
test('anchored chip rows remain separate from compact key at 320 and desktop (10 px gap minimum)',()=>{
 for(const width of [300,650])for(const p of model.presets){const f=frame(p.values),a=view.closeupAnchors({w:width,h:470},f);assert.ok(!a.body&&!a.frames);assert.equal(Object.keys(a).length,available(f).length-2);assert.ok(Object.values(a).every(p=>p.x>50&&p.x<width-50&&p.y<=470-62));}
});

test('scene viewport stays above reserved rows at every height from 280 to 850 (1e-12 px)',()=>{
 for(const width of [300,650])for(let height=280;height<=850;height+=5)for(const id of ['',...view.closeups.map(c=>c.id)]){
  const layout=sceneLayout(width,height,id),r=layout.area;
  assert.ok(r.h>0);assert.ok(r.y>=0&&r.y+r.h<=height);
  assert.ok(Math.abs(r.y+r.h+layout.bottom-height)<1e-12);
  assert.equal(layout.compact,height<420);
 }
});
test('280 px scenes retain all zoom targets and a positive body viewport',()=>{
 for(const preset of model.presets){const f=frame(preset.values),anchors=view.closeupAnchors({w:300,h:280},f);assert.equal(Object.keys(anchors).length,available(f).length-2);assert.equal(sceneLayout(300,280).area.h,125);}
});
test('compact desktop magnification preserves the full motion sphere; phone and closeups unchanged (1e-12)',()=>{
 for(const height of [280,340,419]){
  const factor=cameraExtentFactor(569,height);
  assert.ok(Math.abs(factor*1.6-1.04)<1e-12);
  assert.equal(cameraExtentFactor(300,height),1);
  for(const {id} of view.closeups)assert.equal(cameraExtentFactor(569,height,id),1);
  const f=frame(model.presets[0].values),anchors=view.closeupAnchors({w:569,h:height},f);
  assert.ok(Object.values(anchors).every(a=>a.y>=0&&a.y<=height-62));
 }
 assert.equal(cameraExtentFactor(569,470),1);
});
test('learner graphs exclude diagnostics and window the physical motion (zero descriptor mismatch)',()=>{
 assert.ok(!view.graphs.some(g=>g.id==='norm'));
 for(const preset of model.presets){const window=graphWindow(preset.values);assert.ok(window>=.2&&window<=60);for(const g of view.graphDescriptors(preset.values))if(!g.kind)assert.equal(g.window,window);}
 assert.ok(graphWindow(model.presets.find(p=>p.id==='flip').values)<15);
 assert.equal(readoutNumber(.9696),'0.970');assert.equal(readoutNumber(-.9696),'\u22120.970');
});
test('narrow Euler results keep signed values and units on a short separate line',()=>{
 for(const preset of model.presets){const f={...frame(preset.values),narrow:true},eq=view.equations(f);
  for(const i of [1,3,5]){assert.ok(!eq[i].includes('frac'));assert.match(eq[i],/mathrm\{rad\/s\^2\}/);}
  assert.ok(!eq.some(line=>line.includes('NaN')));
 }
});
test('finite tangent patch stays within panel margin around its fixed center (1e-12 NDC)',()=>{
 for(const x of [-.65,0,.65])for(const y of [-.65,0,.65]){const center={x,y},corners=[{x:x-1,y:y-1},{x:x+1,y:y-1},{x:x-1,y:y+1},{x:x+1,y:y+1}],scale=finitePatchScale(center,corners);assert.ok(scale>0);for(const c of corners){assert.ok(Math.abs(x+(c.x-x)*scale)<=.9+1e-12);assert.ok(Math.abs(y+(c.y-y)*scale)<=.9+1e-12);}}
 for(const {id} of view.closeups)assert.ok(sceneLayout(300,280,id).area.y>=96);
});
