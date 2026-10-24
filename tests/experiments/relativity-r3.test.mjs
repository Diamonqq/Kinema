import test from 'node:test';
import assert from 'node:assert/strict';
import {model as mink} from '../../static/js/experiments/minkowski/model.js';
import {view as minkView} from '../../static/js/experiments/minkowski/view.js';
import {model as rel} from '../../static/js/experiments/rel-kinematics/model.js';
import {view as relView} from '../../static/js/experiments/rel-kinematics/view.js';
import {fakeStage,frame} from './minkowski-view.test.mjs';

// Round 3: displayed substitutions recompute, CM symbols are starred, labels clear every drawn line, graph axes carry units.
const NUM='(-?[\\d.]+(?:\\\\times10\\^\\{-?\\d+\\})?)';
const read=t=>Number(t.replace(/\\times10\^\{(-?\d+)\}/,'e$1'));
const sigFigs=t=>t.replace(/\\times.*$/,'').replace(/[-.]/g,'').replace(/^0+/,'').length;
const component=new RegExp('=\\('+NUM+'\\\\,\\\\mathrm\\{MeV\\}/c\\)\\\\(cos|sin)\\('+NUM+'\\^\\\\circ\\)='+NUM+'\\\\,\\\\mathrm\\{MeV\\}/c');

test('every substituted component line recomputes from its displayed numbers, in both frames',()=>{
 let lines=0;
 for(const preset of rel.presets)for(const frameName of ['lab','cm']){
  const f=frame(rel,{...preset.values,frame:frameName},.5);
  for(const t of relView.equations(f).filter(t=>t.includes('\\circ)'))){
   const m=component.exec(t.replace('\\\\&=','='));assert.ok(m,`${preset.id} ${frameName} parses: ${t}`);
   const [,P,fn,A,R]=m,got=read(P)*Math[fn](read(A)*Math.PI/180);
   for(const n of [P,A,R])assert.ok(sigFigs(n)<=4,`${preset.id} ${frameName}: ${n} has more than 4 significant figures`);
   assert.ok(Math.abs(got-read(R))<=.001*Math.abs(read(R))+1e-9,`${preset.id} ${frameName}: ${P} ${fn}(${A} deg) = ${got}, shown ${R}`);lines++;
  }
 }
 assert.ok(lines>=32,'checked '+lines);
 assert.ok(relView.equations(frame(rel,{reaction:'pion-decay',frame:'lab'},.5)).some(t=>/32\.20\^/.test(t)),'the lab angle shows 4 significant figures');
});

test('CM equations and drawing use starred symbols, lab ones stay plain',()=>{
 const cm=relView.equations(frame(rel,{frame:'cm'},.5)).join(' '),lab=relView.equations(frame(rel,{frame:'lab'},.5)).join(' ');
 for(const part of ['p^{*}_{1x}','\\theta^{*}_{1}','p^{*}_{1y}'])assert.ok(cm.includes(part),'CM equations use '+part);
 assert.ok(!lab.includes('^{*}'),'lab equations are plain');
 const f=frame(rel,{});f.breakdown=true;const s=fakeStage(1200,620);relView.draw(s,f);
 assert.ok(s.labels.some(l=>l.text==='p*')&&s.labels.some(l=>l.text==='θ*'),'CM pane labels are starred');
 assert.ok(s.labels.some(l=>l.text==='θ'),'lab pane keeps the plain theta');
});

const sample=(a,n=48)=>Array.from({length:n+1},(_,i)=>[a[0]+(a[2]-a[0])*i/n,a[1]+(a[3]-a[1])*i/n]);
const inBox=(b,[x,y])=>x>=b.left&&x<=b.left+b.width&&y>=b.top&&y<=b.top+b.height;
test('minkowski axis and interval labels do not touch any worldline or hyperbola segment',()=>{
 let boxes=0;
 for(const p of mink.presets)for(const w of [330,650,1200])for(const breakdown of [false,true]){
  const f=frame(mink,p.values,.5);f.breakdown=breakdown;const s=fakeStage(w,620);minkView.draw(s,f);
  for(const key of ['ground','moving']){const d=s.diag?.[key];if(!d)continue;
   for(const b of [...d.names,...(d.interval?[d.interval]:[])]){boxes++;
    for(const [what,segs] of [['worldline',d.worldlines],['hyperbola',d.curve]])assert.ok(!segs.some(a=>sample(a).some(q=>inBox(b,q))),`${p.id} ${w} ${key} breakdown=${breakdown}: label box touches ${what}`);}
  }
 }
 assert.ok(boxes>50,'checked '+boxes);
});

test('graph axes carry units that agree with the diagram',()=>{
 const f=frame(mink,{},1),d=minkView.graphDescriptors(f.params).find(g=>g.id==='worldlines'),s=fakeStage(560,220);minkView.drawGraph(s,d,f);
 assert.ok(s.labels.some(l=>l.text==='ct / L')&&!s.labels.some(l=>/coordinate time/.test(l.text)),'time axis is ct / L like the diagram');
 const r=frame(rel,{},1),flight=relView.graphDescriptors(r.params).find(g=>g.id==='flight'),t=fakeStage(560,220);relView.drawGraph(t,flight,r);
 assert.ok(t.labels.some(l=>/coordinate time/.test(l.text)&&/· s$/.test(l.text)),'flight x axis has seconds');
 assert.ok(t.labels.some(l=>/light-s$/.test(l.text)),'flight y axis has light-seconds');
});
