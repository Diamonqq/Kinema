import test from 'node:test';
import assert from 'node:assert/strict';
import {model as mink} from '../../static/js/experiments/minkowski/model.js';
import {view as minkView} from '../../static/js/experiments/minkowski/view.js';
import {model as rel} from '../../static/js/experiments/rel-kinematics/model.js';
import {view as relView} from '../../static/js/experiments/rel-kinematics/view.js';
import {fakeStage,frame} from './minkowski-view.test.mjs';

// Round 5: event letters clear of every line, centered energy budget, visible head-to-tail arrows.
const inBox=(b,[x,y])=>x>=b.left&&x<=b.left+b.width&&y>=b.top&&y<=b.top+b.height;
const sample=(a,n=60)=>Array.from({length:n+1},(_,i)=>[a[0]+(a[2]-a[0])*i/n,a[1]+(a[3]-a[1])*i/n]);

test('event letters sit on no worldline, dashed axis, cone line or axis, in the scene and the zoom views',()=>{
 let letters=0,relaxed=0;
 for(const p of mink.presets)for(const w of [330,650,1200])for(const closeup of [null,'event','transform']){
  const f=frame(mink,p.values,.5);if(closeup)f.closeup=closeup;const s=fakeStage(w,620);minkView.draw(s,f);
  for(const key of ['ground','moving']){const d=s.diag?.[key];for(const b of d?.letters||[]){
   letters++;if(b.relaxed){relaxed++;}
   const lines=[['worldline',d.worldlines],['hyperbola',d.curve],['axis',d.own],...(b.relaxed?[]:[['dashed axis',d.guides],['event or cone line',d.extra]])];
   for(const [what,segs] of lines)assert.ok(!segs.some(a=>sample(a).some(q=>inBox(b,q))),`${p.id} ${w} ${closeup} ${key}: letter touches ${what}`);
  }}
 }
 assert.ok(letters>20,'checked '+letters);
 assert.ok(relaxed<letters/4,`only a few letters relax in crowded scenes (${relaxed} of ${letters})`);
});

test('the default scene letters and the transform zoom letter clear every line at 1280 and 320',()=>{
 for(const [w,h] of [[541,520],[300,640]])for(const closeup of [null,'transform']){
  const f=frame(mink,{},0);if(closeup)f.closeup=closeup;const s=fakeStage(w,h);minkView.draw(s,f);
  const boxes=Object.values(s.diag).flatMap(d=>(d.letters||[]).map(b=>({b,d})));assert.ok(boxes.length>=2,'letters drawn');
  for(const {b,d} of boxes){assert.ok(!b.relaxed,'not relaxed');for(const segs of [d.worldlines,d.guides,d.extra,d.own,d.curve])assert.ok(!segs.some(a=>sample(a).some(q=>inBox(b,q))),`${w} ${closeup}: letter on a line`);}
 }
});

test('energy budget block is centered in the stage, vertically and horizontally',()=>{
 for(const [w,h] of [[541,520],[300,560],[650,450]])for(const preset of rel.presets){
  const f=frame(rel,preset.values,.5);f.closeup='budget';const s=fakeStage(w,h);relView.draw(s,f);
  const own=s.labels.filter(l=>l.y>0);assert.ok(own.length>=4,'budget labels drawn');
  const top=Math.min(...own.map(l=>l.y)),bottom=Math.max(...own.map(l=>l.y+l.height));
  assert.ok(Math.abs(top-(h-bottom))<=Math.max(30,h*.08),`${preset.id} ${w}x${h}: block centered vertically (top ${top}, bottom gap ${h-bottom})`);
  const left=Math.min(...own.map(l=>l.x)),right=Math.max(...own.map(l=>l.x+l.width));
  assert.ok(left>=0&&right<=w,'inside the stage');
 }
});

const overlap=(a,b)=>{const len=Math.hypot(a[2]-a[0],a[3]-a[1]);if(len<1)return false;
 const near=(px,py)=>Math.abs((px-a[0])*(a[3]-a[1])-(py-a[1])*(a[2]-a[0]))/len<1.5;if(!near(b[0],b[1])||!near(b[2],b[3]))return false;
 const ts=[((b[0]-a[0])*(a[2]-a[0])+(b[1]-a[1])*(a[3]-a[1]))/len,((b[2]-a[0])*(a[2]-a[0])+(b[3]-a[1])*(a[3]-a[1]))/len];
 return Math.min(len,Math.max(...ts))-Math.max(0,Math.min(...ts))>3;};
test('head-to-tail zoom draws every product arrow separately in both frames',()=>{
 let pairs=0;
 for(const preset of rel.presets)for(const w of [330,650,1200]){
  const f=frame(rel,preset.values,.5);f.closeup='balance';const s=fakeStage(w,620);relView.draw(s,f);
  const arrows=s.arrows.filter(a=>a[4]!=='#a7b6cc'&&Math.hypot(a[2]-a[0],a[3]-a[1])>8);
  for(let i=0;i<arrows.length;i++)for(let j=i+1;j<arrows.length;j++){pairs++;assert.ok(!overlap(arrows[i],arrows[j]),`${preset.id} ${w}: arrows ${i} and ${j} overlap`);}
 }
 assert.ok(pairs>0);
});
