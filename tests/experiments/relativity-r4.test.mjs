import test from 'node:test';
import assert from 'node:assert/strict';
import {model as mink} from '../../static/js/experiments/minkowski/model.js';
import {view as minkView} from '../../static/js/experiments/minkowski/view.js';
import {model as rel} from '../../static/js/experiments/rel-kinematics/model.js';
import {view as relView} from '../../static/js/experiments/rel-kinematics/view.js';
import {fakeStage,frame} from './minkowski-view.test.mjs';

// Round 4: three significant figures in the Minkowski equations, interval caption clear of every line, angle and incoming labels off the axis.
const sig=t=>t.replace(/\\times.*$/,'').replace(/[-.]/g,'').replace(/^0+/,'').length;

test('Minkowski breakdown and transform zoom show 3 significant figures',()=>{
 const f=frame(mink,{},.5),eq=minkView.equations(f).join(' ');
 assert.ok(/\\beta=0\.600/.test(eq),'beta shows 0.600: '+eq);
 assert.ok(/x\/L=2\.50/.test(eq)&&/ct\/L=2\.50/.test(eq)&&/x'\/L=1\.25/.test(eq),'coordinates show 3 figures');
 const half=frame(mink,{beta:.5},.5),s=fakeStage(1200,620);half.closeup='transform';minkView.draw(s,half);
 assert.ok(s.labels.some(l=>/^β = 0\.500/.test(l.text)),'zoom caption shows 0.500: '+s.labels.map(l=>l.text).join('|'));
 for(const p of mink.presets){
  const g=frame(mink,p.values,.5);
  for(const line of [...minkView.equations(g),...minkView.closeupEquation(g)])for(const n of line.match(/(?<![A-Za-z_{^\\])-?\d+\.\d+/g)||[])assert.equal(sig(n),3,`${p.id}: ${n} in ${line}`);
 }
});

const inBox=(b,[x,y])=>x>=b.left&&x<=b.left+b.width&&y>=b.top&&y<=b.top+b.height;
const sample=(a,n=60)=>Array.from({length:n+1},(_,i)=>[a[0]+(a[2]-a[0])*i/n,a[1]+(a[3]-a[1])*i/n]);
test('interval caption and axis names touch no worldline, hyperbola, guide, cone or axis line',()=>{
 let boxes=0;
 for(const p of mink.presets)for(const w of [330,650,1200])for(const breakdown of [false,true]){
  const f=frame(mink,p.values,.5);f.breakdown=breakdown;const s=fakeStage(w,620);minkView.draw(s,f);
  for(const key of ['ground','moving']){const d=s.diag?.[key];if(!d)continue;
   for(const b of [...d.names,...(d.interval?[d.interval]:[])]){boxes++;
    const caption=b===d.interval&&!b.relaxed;for(const [what,segs] of [['worldline',d.worldlines],['hyperbola',d.curve],['guide',d.guides],['axis',d.own],...(caption?[['event or cone line',d.extra]]:[])])assert.ok(!segs.some(a=>sample(a).some(q=>inBox(b,q))),`${p.id} ${w} ${key} breakdown=${breakdown}: label touches ${what}`);}
  }
 }
 assert.ok(boxes>20,'checked '+boxes);
});

test('rel lab and CM angle labels sit above the axis inside the arc; incoming label is lifted off the axis',()=>{
 let angles=0,incoming=0;
 for(const p of rel.presets)for(const w of [330,650,1200]){
  const f=frame(rel,p.values,.5);f.breakdown=true;const s=fakeStage(w,620),raw=[];const text=s.text;s.text=(t,x,y,...r)=>{raw.push({t,x,y});return text(t,x,y,...r);};relView.draw(s,f);
  if(w<470)continue;
  const origins=s.arrows.map(a=>[a[0],a[1],a[2],a[3]]);
  for(const label of raw.filter(r=>r.t==='θ'||r.t==='θ*')){
   const origin=origins.map(a=>[a[0],a[1]]).sort((u,v)=>Math.abs(u[0]-label.x)-Math.abs(v[0]-label.x))[0],py=f.geometry[label.t==='θ'?'lab':'cm'].final[0].py;
   assert.ok(py>0?label.y<origin[1]:label.y>origin[1],`${p.id} ${w}: ${label.t} on the vector's side of the axis (${label.y} vs ${origin[1]}, py ${py})`);angles++;
  }
  for(const label of raw.filter(r=>r.t==='p in')){
   const axisY=origins.find(a=>a[3]===a[1]&&Math.abs(a[2]-label.x)<30);if(!axisY)continue;
   assert.ok(Math.abs(label.y-axisY[1])>=8,`${p.id} ${w}: p in lifted off the axis (${label.y} vs ${axisY[1]})`);incoming++;
  }
 }
 assert.ok(angles>0&&incoming>0,`checked ${angles} angles, ${incoming} incoming labels`);
});
