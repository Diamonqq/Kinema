import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {model} from '../../static/js/experiments/race-track/model.js';
import {view,bankSnapshot} from '../../static/js/experiments/race-track/view.js';
test('race manifest exactly mirrors all model and view descriptors',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('../../static/js/experiments/race-track/manifest.json',import.meta.url)));assert.equal(m.group,'Mechanics');for(const k of ['params','presets'])assert.deepEqual(m[k],model[k]);for(const k of ['graphs','closeups'])assert.deepEqual(m[k],view[k]);
});
test('corner preview uses configured bank and radius, even while scene is on a straight (absolute 1e-7 N)',()=>{
 const params=Object.fromEntries(model.params.map(p=>[p.key,p.value]));params.bank=20;const instance=model.create(params),f={params,instance,sample:instance.sample(),geometry:instance.geometry()};assert.equal(f.sample.bank,0);const a=bankSnapshot(f);assert.ok(Math.abs(a.inward-params.mass*params.speed**2/params.radius)<1e-7);assert.ok(Math.abs(a.vertical-params.mass*params.gravity)<1e-7);assert.ok(view.equations(f).some(s=>s.includes('\\sin\\theta')));
});
test('short gallery thumbnail produces positive physical scale and car dimensions',()=>{
 const params=Object.fromEntries(model.params.map(p=>[p.key,p.value])),instance=model.create(params),ctx=new Proxy({roundRect(x,y,w,h,r){assert.ok(w>0&&h>0&&r>=0);}}, {get:(o,k)=>k in o?o[k]:(()=>{})}),s={w:300,h:155,ctx,line(){},circle(){},text(){}};
 view.draw(s,{params,instance,sample:instance.sample(),geometry:instance.geometry(),t:0,closeup:'',breakdown:false});assert.ok(s.camera.scale>0);
});
