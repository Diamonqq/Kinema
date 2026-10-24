import test from 'node:test';
import assert from 'node:assert/strict';
import {model} from '../../static/js/experiments/collisions/model.js';
import {energySeries} from '../../static/js/experiments/collisions/view.js';
import {graphLegend,title} from '../../static/js/experiments/orbits/scene.js';
const preset=id=>model.presets.find(p=>p.id===id).values;
test('collisions Energy legend drops hidden curves and names the identity',()=>{
 assert.deepEqual(energySeries(preset('exchange')).map(v=>v.label),['K = E + Q (U = 0, Q = 0)']);
 const spring=energySeries(preset('spring')).map(v=>v.label);
 assert.deepEqual(spring,['K (Q = 0)','U','E + Q']);
 const inel=energySeries(preset('inelastic')).map(v=>v.label);
 assert.ok(inel.includes('Q')&&!inel.some(l=>l.startsWith('K =')));
});
test('orbits Energy legend uses the kit legend geometry',()=>{
 const calls=[];const s={h:200,circle:(...a)=>calls.push(['c',...a]),text:(...a)=>calls.push(['t',...a])};
 graphLegend(s,[{label:'K',color:'a'},{label:'U',color:'b'},{label:'E',color:'c'}]);
 assert.deepEqual(calls.filter(c=>c[0]==='t').map(c=>c[1]),['K','U','E']);
 assert.ok(calls.every(c=>c[0]==='c'?c[2]===194:c[3]===194));
 const xs=calls.filter(c=>c[0]==='c').map(c=>c[1]);assert.ok(xs[1]-xs[0]>=46);
});
test('zoom titles sit lower on a narrow stage so the Full scene button has clearance',()=>{
 const y=w=>{let v;title({w,text:(t,x,yy)=>{v=yy;}},'t');return v;};
 assert.equal(y(320),52);assert.equal(y(390),52);assert.equal(y(569),48);
});
