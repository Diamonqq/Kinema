import test from 'node:test';
import assert from 'node:assert/strict';
import {model as mink} from '../../static/js/experiments/minkowski/model.js';
import {view as minkView} from '../../static/js/experiments/minkowski/view.js';
import {model as rel} from '../../static/js/experiments/rel-kinematics/model.js';
import {view as relView} from '../../static/js/experiments/rel-kinematics/view.js';
import {fakeStage,frame} from './minkowski-view.test.mjs';

// Round 6: both events framed in the transform zoom, interval caption clear of event letters, energy budget reads as one group.
const gap=(a,b)=>Math.max(Math.max(a.left-(b.left+b.width),b.left-(a.left+a.width)),Math.max(a.top-(b.top+b.height),b.top-(a.top+a.height)));

test('transform zoom draws both events A and B, with letters, in both panels',()=>{
 let checked=0;
 for(const p of mink.presets.filter(p=>!['four-vector','tensor'].includes(p.values.scenario)))for(const [w,h] of [[541,520],[300,640],[650,620]]){
  const f=frame(mink,p.values,.5);if(!f.geometry.ground.events.length)continue;f.closeup='transform';const s=fakeStage(w,h);minkView.draw(s,f);
  for(const key of ['ground','moving']){const d=s.diag?.[key];if(!d)continue;
   const names=(d.letters||[]).length;assert.ok(names===2||names===0&&f.geometry.ground.events.length<2,`${p.id} ${w}: ${key} letters ${names}`);checked+=names;}
 }
 assert.ok(checked>=4,'checked '+checked);
});

test('default transform zoom keeps equal axis scales and 45 degree light lines',()=>{
 const f=frame(mink,{},0);f.closeup='transform';const s=fakeStage(541,520);minkView.draw(s,f);
 const lines=s.lines.filter(l=>Math.abs(Math.abs(l[2]-l[0])-Math.abs(l[3]-l[1]))<1e-6&&Math.abs(l[2]-l[0])>20);
 assert.ok(lines.length>=2,'diagonal cone lines are exactly 45 degrees on screen');
});

test('invariant interval caption keeps a gap from every event letter and off the hyperbola',()=>{
 let n=0;
 for(const p of mink.presets)for(const w of [300,330,650,1200]){
  const f=frame(mink,p.values,.5);f.breakdown=true;const s=fakeStage(w,620);minkView.draw(s,f);
  for(const key of ['ground','moving']){const d=s.diag?.[key];if(!d?.interval)continue;n++;
   for(const l of d.letters||[])assert.ok(gap(d.interval,l)>=4,`${p.id} ${w} ${key}: caption ${gap(d.interval,l)} px from a letter`);
   for(const a of d.curve){const hit=!(a[0]<d.interval.left&&a[2]<d.interval.left||a[0]>d.interval.left+d.interval.width&&a[2]>d.interval.left+d.interval.width||a[1]<d.interval.top&&a[3]<d.interval.top||a[1]>d.interval.top+d.interval.height&&a[3]>d.interval.top+d.interval.height);
    if(hit){const steps=40;for(let i=0;i<=steps;i++){const x=a[0]+(a[2]-a[0])*i/steps,y=a[1]+(a[3]-a[1])*i/steps;assert.ok(!(x>=d.interval.left&&x<=d.interval.left+d.interval.width&&y>=d.interval.top&&y<=d.interval.top+d.interval.height),`${p.id} ${w} ${key}: caption on the hyperbola`);}}}
  }
 }
 assert.ok(n>10,'checked '+n);
});

test('energy budget block fills enough of the stage to read as one group',()=>{
 for(const [w,h] of [[541,700],[300,560],[650,450]])for(const preset of rel.presets){
  const f=frame(rel,preset.values,.5);f.closeup='budget';const s=fakeStage(w,h);relView.draw(s,f);
  const own=s.labels.filter(l=>l.y>0),top=Math.min(...own.map(l=>l.y)),bottom=Math.max(...own.map(l=>l.y+l.height));
  assert.ok(Math.abs(top-(h-bottom))<=Math.max(30,h*.08),`${preset.id} ${w}x${h} centered`);
  assert.ok(bottom-top>=Math.min(h*.42,260),`${preset.id} ${w}x${h}: block ${bottom-top}px tall`);
 }
});
