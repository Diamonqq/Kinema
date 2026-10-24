import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const dir=new URL('../../static/js/experiments/rigid-rotation/',import.meta.url);
const load=async name=>import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL(name,dir),'utf8')).toString('base64'));
const {model}=await load('model.js');
const source=await readFile(new URL('view.js',dir),'utf8');
// Pure equation/descriptor tests only. Actual three.js is checked by the browser fixture.
const {view,available,sceneLayout}=await import('data:text/javascript;base64,'+Buffer.from(source.replace(/^import .*;\r?\n/,'const THREE={};\n')).toString('base64'));
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
 for(const width of [300,650])for(const p of model.presets){const f=frame(p.values),a=view.closeupAnchors({w:width,h:470},f);assert.ok(Object.values(a).every(p=>p.x>50&&p.x<width-50&&p.y<=470-70));}
});

test('scene viewport stays above reserved rows at every height from 280 to 850 (1e-12 px)',()=>{
 for(const width of [300,650])for(let height=280;height<=850;height+=5)for(const id of ['',...view.closeups.map(c=>c.id)]){
  const layout=sceneLayout(width,height,id),r=layout.area;
  assert.ok(r.h>0);assert.ok(r.y>=0&&r.y+r.h<=height);
  assert.ok(Math.abs(r.y+r.h+layout.bottom-height)<1e-12);
  assert.equal(layout.compact,height<420);
 }
});
test('280 px scenes keep one target-chip row and a full positive body viewport',()=>{
 for(const preset of model.presets){const f=frame(preset.values),anchors=view.closeupAnchors({w:300,h:280},f);assert.ok(Object.keys(anchors).length<=2);assert.ok(Object.values(anchors).every(a=>a.y===226));assert.equal(sceneLayout(300,280).area.h,164);}
});
