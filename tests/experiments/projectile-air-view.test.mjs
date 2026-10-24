import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {model} from '../../static/js/experiments/projectile-air/model.js';
import {view,preview} from '../../static/js/experiments/projectile-air/view.js';
const params=Object.fromEntries(model.params.map(p=>[p.key,p.value]));
test('projectile manifest is exactly synchronized with parameter, preset, graph and close-up descriptors',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('../../static/js/experiments/projectile-air/manifest.json',import.meta.url)));
 assert.equal(m.group,'Mechanics');for(const k of ['params','presets'])assert.deepEqual(m[k],model[k]);for(const k of ['graphs','closeups'])assert.deepEqual(m[k],view[k]);
});
test('fixed preview contains every point of each preset flight and ghost (absolute 1e-9 m)',()=>{
 for(const p of model.presets){const data=preview(p.values),[a,b,c,d]=data.bounds;for(const q of [...data.path,...data.ghost])assert.ok(q.x>=a-1e-9&&q.x<=b+1e-9&&q.y>=c-1e-9&&q.y<=d+1e-9);assert.equal(data.path.at(-1).landed,true,p.id);assert.equal(preview(p.values),data);assert.equal(data.apex.vy,0);const i=model.create(p.values);i.step(data.apex.t);assert.ok(Math.abs(i.sample().vy)<1e-6);}
});
test('symbolic equations retain literal TeX and numerical substitutions',()=>{
 const instance=model.create(),f={params,sample:instance.sample(),geometry:instance.geometry(),instance,t:0};const equations=view.equations(f);assert.ok(equations.some(s=>s.includes('\\cos\\theta')));assert.ok(equations.some(s=>s.includes('30.6')));for(const z of view.closeups){const eq=view.closeupEquation({...f,closeup:z.id});assert.ok(eq.length>=2);assert.ok(eq.every(s=>typeof s==='string'&&!s.includes('NaN')));}
});


test('projectile thumbnail draws apparatus without readouts or captions',()=>{
 const instance=model.create(),ctx=new Proxy({}, {get:(o,k)=>()=>{}});let texts=0;
 const s={w:300,h:155,ctx,line(){},circle(){},text(){texts++;}};
 view.draw(s,{params,instance,sample:instance.sample(),geometry:instance.geometry(),t:0,closeup:'',breakdown:false,thumbnail:true});assert.equal(texts,0);assert.ok(s.camera.scale>0);
});
