import test from 'node:test';
import assert from 'node:assert/strict';
import {model as mink,C} from '../../static/js/experiments/minkowski/model.js';
import {view as minkView,boundsFor} from '../../static/js/experiments/minkowski/view.js';
import {model as rel} from '../../static/js/experiments/rel-kinematics/model.js';
import {view as relView} from '../../static/js/experiments/rel-kinematics/view.js';
import {clipLine} from '../../static/js/experiments/minkowski/drawing.js';
import {fakeStage,frame} from './minkowski-view.test.mjs';
const labs=[['minkowski',mink,minkView],['rel-kinematics',rel,relView]];
const lowest=s=>Math.max(...s.lines.flatMap(a=>[a[1],a[3]]),...s.arrows.flatMap(a=>[a[1],a[3]]));

test('minkowski desktop bounds are centered on each origin for every preset',()=>{
 for(const p of mink.presets){const f=frame(mink,p.values),b=boundsFor(f.geometry,f.params.length);assert.ok(Math.abs(b[0]+b[1])<1e-9,p.id+' x bounds symmetric '+b);}
});
test('zoom chips sit just under their panes and ignore the stage height that Breakdown changes',()=>{
 for(const [name,model,view] of labs)for(const preset of model.presets){
  const f=frame(model,preset.values,.5);
  for(const w of [330,650,1200]){
   const tall=fakeStage(w,620),short=fakeStage(w,w<470?620:555);view.draw(tall,f);view.draw(short,f);
   const a=view.closeupAnchors(tall,f),b=view.closeupAnchors(short,f),ids=Object.keys(a);
   for(const id of ids){
    const gap=a[id].y-lowest(tall);
    assert.ok(gap>=-1&&gap<=(name==='minkowski'?14:150),`${name} ${preset.id} ${w} chip ${id} gap ${gap}`);
    // Panes wider than the stage is tall (expanded view) legitimately grow with it.
    if(w<=650){assert.ok(Math.abs(gap-(b[id].y-lowest(short)))<1e-6,`${name} ${preset.id} ${w} chip ${id} keeps its offset from the pane when the stage is shorter`);assert.equal(a[id].x,b[id].x);}
   }
  }
 }
});
test('scene and breakdown text is at least 10 px with no underscore markup or Unicode subscripts',()=>{
 for(const [name,model,view] of labs)for(const preset of model.presets)for(const w of [330,650,1200]){
  const f=frame(model,preset.values,.5),s=fakeStage(w,620);view.draw(s,f);f.breakdown=true;view.draw(s,f);
  for(const l of s.labels){assert.ok(l.height>=10,`${name} ${preset.id} ${w} "${l.text}" ${l.height}px`);assert.ok(!/[_\u2080-\u209f\u1d62-\u1d6a]/.test(l.text),`"${l.text}" is typeset`);}
 }
});
test('custom graphs use round ticks: faint grid, brighter zero line, 9 px tick text and a 0 label',()=>{
 for(const [name,model,view] of labs){
  const f=frame(model,{},1);
  for(const d of view.graphDescriptors(f.params).filter(g=>name==='minkowski'?g.id==='worldlines':g.kind==='custom'&&!['scatter','histogram'].includes(g.id))){
   const s=fakeStage(560,220);view.drawGraph(s,d,f);
   const ticks=s.labels.filter(l=>l.height===9);assert.ok(ticks.length>=3,`${name} ${d.id} tick labels`);
   assert.ok(s.lines.some(a=>a[4]==='rgba(160,180,210,0.10)'),`${name} ${d.id} faint grid`);
   assert.ok(ticks.some(l=>l.text==='0'),`${name} ${d.id} labels 0`);
   assert.ok(s.lines.some(a=>a[4]==='rgba(160,180,210,0.28)'),`${name} ${d.id} zero line`);
   assert.ok(!ticks.some(l=>/-/.test(l.text)),`${name} ${d.id} typeset minus`);
  }
 }
});
test('minkowski Breakdown captions the invariant-interval hyperbola and keeps B clear of it',()=>{
 const f=frame(mink,mink.presets[0].values),s=fakeStage(650,620);f.breakdown=true;view_draw(s,f);
 assert.ok(s.labels.some(l=>l.text==='invariant interval'));
 const curve=s.lines.filter(a=>a[4]==='#b0c9ad');assert.ok(curve.length>20);
 for(const b of s.labels.filter(l=>l.text==='B')){const box={left:b.x,top:b.y,width:b.width,height:b.height};assert.ok(!curve.some(a=>clipLine(a[0],a[1],a[2],a[3],box)),'B label is clear of the hyperbola');}
});
function view_draw(s,f){minkView.draw(s,f);}
test('rel-kinematics scene labels p1 and p2 sit just past their arrow tips',()=>{
 for(const w of [330,650,1200]){const f=frame(rel,{}),s=fakeStage(w,620);relView.draw(s,f);
  const arrows=s.arrows.filter(a=>a[4]!=='#a7b6cc');
  for(const a of arrows.slice(0,2)){const near=s.labels.filter(l=>l.text==='p'&&Math.hypot(l.x-a[2],l.y-a[3])<30);assert.ok(near.length,`label within 30 px of tip ${a} at ${w}`);}
 }
});
