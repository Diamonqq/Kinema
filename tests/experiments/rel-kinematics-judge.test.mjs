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

test('momentum indices are Unicode subscripts and component letters are smaller and lowered',()=>{
 const f=frame(model);f.breakdown=true;const s=fakeStage(560,620);view.draw(s,f);
 assert.ok(s.labels.some(l=>l.text==='p\u2081'));assert.ok(s.labels.some(l=>l.text==='p\u2082'));
 assert.ok(s.labels.some(l=>l.text==='\u03b8\u2081'));assert.ok(!s.labels.some(l=>/p[123]|\u03b81/.test(l.text)));
 for(const y of s.labels.filter(l=>l.text==='y')){assert.equal(y.height,8);assert.ok(s.labels.some(l=>l.text==='p\u2081'&&y.y>l.y&&Math.abs(y.y-l.y)<7));}
 assert.ok(s.labels.some(l=>l.text==='y'));
});

test('custom graph canvas has no repeated card title or header units',()=>{
 const f=frame(model,{reaction:'compton'});
 for(const d of view.graphDescriptors(f.params)){const s=fakeStage(560,200);view.drawGraph(s,d,f);
  assert.ok(!s.labels.some(l=>l.text===d.label));
  if(d.unit&&!['scatter','histogram'].includes(d.id))assert.ok(!s.labels.some(l=>/MeV|light-seconds|\u00b0/.test(l.text)));
 }
});
