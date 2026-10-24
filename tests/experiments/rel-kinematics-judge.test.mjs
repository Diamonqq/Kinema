import test from 'node:test';
import assert from 'node:assert/strict';
import {model as minkowski,C,boost} from '../../static/js/experiments/minkowski/model.js';
import {view as minkowskiView,namedEvents,eventReadouts} from '../../static/js/experiments/minkowski/view.js';
import {model} from '../../static/js/experiments/rel-kinematics/model.js';
import {view} from '../../static/js/experiments/rel-kinematics/view.js';
import {num} from '../../static/js/experiments/kit/format.js';
import {fakeStage,frame} from './minkowski-view.test.mjs';

test('A and B are distinct physical events with coordinates in both frames, formatted by the shared formatter',()=>{
 const f=frame(minkowski),records=namedEvents(f),rows=eventReadouts(f);
 assert.deepEqual(records.map(r=>r.name),['A','B']);assert.notEqual(records[0].event.id,records[1].event.id);
 records.forEach(({name,event},i)=>{const b=boost(event,f.params.beta),L=f.params.length;
  assert.equal(rows[i*2],`${name}  S: (x, ct) = (${num(event.x/L)}, ${num(C*event.t/L)}) L`);
  assert.equal(rows[i*2+1],`${name}  S\u2032: (x\u2032, ct\u2032) = (${num(b.x/L)}, ${num(C*b.t/L)}) L`);
 });
});

test('A/B letters and all four coordinate rows are unclipped and non-overlapping at desktop and narrow sizes (zero px overflow)',()=>{
 for(const width of [300,560,1280]){const s=fakeStage(width,620);minkowskiView.draw(s,frame(minkowski));
  assert.equal(s.labels.filter(l=>l.text==='A').length,2);assert.equal(s.labels.filter(l=>l.text==='B').length,2);
  const eventLabels=s.labels.filter(l=>/^[AB](?:$|  S)/.test(l.text));assert.equal(eventLabels.length,8);
  for(const a of eventLabels){assert.ok(a.x>=0&&a.y>=0&&a.x+a.width<=s.w&&a.y+a.height<=s.h,JSON.stringify(a));
   for(const b of s.labels)if(a!==b)assert.ok(!(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y),`${a.text} overlaps ${b.text}`);
  }
 }
});

test('momentum indices are typeset subscripts of at least 10 px, lowered beside their letter',()=>{
 const f=frame(model);f.breakdown=true;const s=fakeStage(560,620);view.draw(s,f);
 assert.ok(!s.labels.some(l=>/[₀-₟ᵢ-ᵪ]/.test(l.text)));
 assert.ok(s.labels.every(l=>l.height>=10),'no text under 10 px');
 for(const [base,sub] of [['p','1'],['p','2'],['θ','1'],['p','y'],['p','x']]){
  assert.ok(s.labels.some((l,i)=>l.text===sub&&s.labels[i-1]?.text===base&&l.y>s.labels[i-1].y&&l.y-s.labels[i-1].y<6),base+sub+' is a lowered subscript');
 }
});
test('scene labels p1 and p2 sit just past their arrow tips without breakdown',()=>{
 const f=frame(model),s=fakeStage(560,620);view.draw(s,f);
 for(const [index,sub] of [[0,'1'],[1,'2']]){const label=s.labels.find((l,i)=>l.text===sub&&s.labels[i-1]?.text==='p'),arrow=s.arrows.filter(a=>a[4]!=='#a7b6cc')[index];
  assert.ok(label&&arrow);assert.ok(Math.hypot(label.x-arrow[2],label.y-arrow[3])<28,'p'+sub+' within 28 px of its tip');}
});

test('custom graph canvas has no repeated card title or header units',()=>{
 const f=frame(model,{reaction:'compton'});
 for(const d of view.graphDescriptors(f.params)){const s=fakeStage(560,200);view.drawGraph(s,d,f);
  assert.ok(!s.labels.some(l=>l.text===d.label));
  if(d.unit&&!['scatter','histogram'].includes(d.id))assert.ok(!s.labels.some(l=>/MeV|light-seconds|\u00b0/.test(l.text)));
 }
});
