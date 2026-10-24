import test from 'node:test';
import assert from 'node:assert/strict';
import {model as mink} from '../../static/js/experiments/minkowski/model.js';
import {view as minkView} from '../../static/js/experiments/minkowski/view.js';
import {model as rel} from '../../static/js/experiments/rel-kinematics/model.js';
import {view as relView} from '../../static/js/experiments/rel-kinematics/view.js';
import {fakeStage,frame} from './minkowski-view.test.mjs';

// Round 7: event letters A and B keep apart and off the lines in Scene and Breakdown; the energy budget starts near the top of its compact stage.
const gap=(a,b)=>Math.max(Math.max(a.left-(b.left+b.width),b.left-(a.left+a.width)),Math.max(a.top-(b.top+b.height),b.top-(a.top+a.height)));
const inBox=(b,[x,y])=>x>=b.left&&x<=b.left+b.width&&y>=b.top&&y<=b.top+b.height;
const sample=(a,n=60)=>Array.from({length:n+1},(_,i)=>[a[0]+(a[2]-a[0])*i/n,a[1]+(a[3]-a[1])*i/n]);

test('default scene and breakdown: letters A and B keep 4 px apart and clear every line, both widths',()=>{
 for(const [w,h] of [[541,520],[300,640]])for(const breakdown of [false,true]){
  const f=frame(mink,{},0);f.breakdown=breakdown;const s=fakeStage(w,h);minkView.draw(s,f);
  for(const key of ['ground','moving']){const d=s.diag[key],[a,b]=d.letters;assert.ok(a&&b,`${w} ${key}: both letters drawn`);
   assert.ok(gap(a,b)>=4,`${w} ${breakdown} ${key}: A and B ${gap(a,b)} px apart`);
   for(const l of d.letters){assert.ok(!l.relaxed);for(const segs of [d.worldlines,d.guides,d.extra,d.own,d.curve])assert.ok(!segs.some(q=>sample(q).some(pt=>inBox(l,pt))),`${w} ${key}: letter on a line`);}}
 }
});

test('letters stay 4 px apart for every preset in Scene and Breakdown',()=>{
 for(const p of mink.presets)for(const w of [330,650,1200])for(const breakdown of [false,true]){
  const f=frame(mink,p.values,.5);f.breakdown=breakdown;const s=fakeStage(w,620);minkView.draw(s,f);
  for(const key of ['ground','moving']){const L=s.diag?.[key]?.letters||[];if(L.length===2)assert.ok(gap(L[0],L[1])>=4,`${p.id} ${w} ${key}: letters touch`);}
 }
});

test('energy budget zoom: the block starts just below the Full scene chip and ends above the key line in a compact stage',()=>{
 for(const preset of rel.presets){
  const f=frame(rel,preset.values,.5);f.closeup='budget';const s=fakeStage(541,380);relView.draw(s,f);
  const own=s.labels.filter(l=>l.y>0),top=Math.min(...own.map(l=>l.y)),bottom=Math.max(...own.map(l=>l.y+l.height));
  assert.ok(top>=48&&top<=90,`${preset.id}: title at ${top}`);assert.ok(bottom<=380-40,`${preset.id}: block ends at ${bottom}`);
 }
});
