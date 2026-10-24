import test from 'node:test';
import assert from 'node:assert/strict';
import {SeekController,timelineBatches,yieldTask} from '../../static/js/experiments/kit/state.js';
import {LinkedGraph,decimate,sampleBound,nearestSample} from '../../static/js/experiments/kit/graphs.js';
import {ExperimentShell,equationDue} from '../../static/js/experiments/kit/shell.js';

for(const id of ['pendulum','orbits','rigid-rotation']){
 test(id+': posted-task seeks are bit-identical to the original 1/60 stepping',async()=>{
  const {model}=await import('../../static/js/experiments/'+id+'/model.js');
  for(const target of [6,30,54]){
   const old=model.create({});while(old.t<target-1e-12&&old.sample().ended!==true){const next=Math.min(target,old.t+1/60);old.step(next-old.t);}
   const fresh=await new SeekController().run(model,{},target,{budgetMs:2});assert.equal(fresh.ok,true);
   assert.deepEqual(fresh.instance.sample(),old.sample());assert.deepEqual(fresh.instance.geometry(),old.geometry());assert.deepEqual(fresh.instance.invariants(),old.invariants());
  }
 });
 test(id+': forecast batching preserves every sample bit for bit',async()=>{
  const physics=await import('../../static/js/experiments/'+id+'/model.js'),model={...physics.model,sampleBatches:physics.sampleBatches};
  const old=[...timelineBatches(model,{},{duration:3.25,batchSize:8})].flat();
  const fresh=[...timelineBatches(model,{},{duration:3.25,batchSize:1})].flat();assert.deepEqual(fresh,old);
 });
}

test('posted-task queue yields asynchronously and drains multiple callers',async()=>{
 const order=[];const first=yieldTask().then(()=>order.push(1)),second=yieldTask().then(()=>order.push(2));
 assert.deepEqual(order,[]);await Promise.all([first,second]);assert.deepEqual(order,[1,2]);await yieldTask();
});

test('budgeted seek cancellation and newest-wins leave the live instance untouched',async()=>{
 const seeker=new SeekController(),waiters=[],commits=[],m={create:()=>({t:0,step(dt){this.t+=dt},sample(){return {t:this.t}}})};
 const old=seeker.run(m,{},54,{yieldTurn:()=>new Promise(resolve=>waiters.push(resolve)),onComplete:s=>commits.push(s.t)});
 const fresh=await seeker.run(m,{},.37,{onComplete:s=>commits.push(s.t)});waiters.shift()();assert.equal((await old).cancelled,true);assert.equal(fresh.ok,true);assert.deepEqual(commits,[.37]);
 const cancelled=seeker.run(m,{},54,{yieldTurn:()=>new Promise(resolve=>waiters.push(resolve)),onComplete:s=>commits.push(s.t)});seeker.cancel();waiters.shift()();assert.equal((await cancelled).cancelled,true);assert.deepEqual(commits,[.37]);
});

test('window decimation preserves column extrema, chronological order and boundary neighbours',()=>{
 const samples=Array.from({length:10001},(_,i)=>({t:i/100,x:i%23===0?100:i%29===0?-200:Math.sin(i)})),points=decimate(samples,'x',25,35,100);
 assert.ok(points.length<=202);assert.ok(points[0].t<=25);assert.ok(points.at(-1).t>=35);
 assert.equal(Math.min(...points.map(p=>p.x)),-200);assert.equal(Math.max(...points.map(p=>p.x)),100);
 for(let i=1;i<points.length;i++)assert.ok(points[i].t>points[i-1].t);
 for(let col=0;col<100;col++){
  const inside=samples.filter(p=>Math.max(0,Math.min(99,Math.floor((p.t-25)/10*100)))===col&&p.t>=24.99&&p.t<=35.01);
  for(const value of [Math.min(...inside.map(p=>p.x)),Math.max(...inside.map(p=>p.x))])assert.ok(points.some(p=>p.x===value&&inside.includes(p)));
 }
 assert.equal(sampleBound(samples,30),3000);assert.equal(sampleBound(samples,30,true),3001);assert.equal(nearestSample(samples,30.004),samples[3000]);
});

test('static graph layer is reused and invalidates on samples, window, descriptor and resize',()=>{
 const original=globalThis.OffscreenCanvas;let snapshots=0,blits=0,paths=0;
 globalThis.OffscreenCanvas=class {constructor(w,h){this.width=w;this.height=h;}getContext(){return {clearRect(){},drawImage(){snapshots++}}}};
 try{
  const ctx=new Proxy({drawImage(){blits++},beginPath(){paths++}},{get:(o,k)=>o[k]||(()=>{})});
  const plot=Object.create(LinkedGraph.prototype);plot.descriptor={label:'Position',window:10,series:[{key:'x',label:'x'}]};plot.canvas={width:800,height:360};
  plot.stage={w:400,h:180,dpr:2,ctx,labels:[],resize(){},begin(){this.labels=[]},text(text){this.labels.push({text})},line(){},circle(){}};
  const samples=Array.from({length:601},(_,i)=>({t:i/10,x:Math.sin(i/10)}));
  plot.draw(samples,1);const labels=plot.stage.labels.slice(),beforePaths=paths;assert.equal(snapshots,1);
  plot.draw(samples,2);assert.equal(snapshots,1);assert.equal(blits,1);assert.equal(paths,beforePaths+1);assert.deepEqual(plot.stage.labels,labels);
  plot.draw(samples,30);assert.equal(snapshots,2);const range=plot.yRange.slice();
  samples.push({t:60.1,x:200});plot.draw(samples,30);assert.equal(snapshots,3);assert.ok(plot.yRange[1]>range[1]);
  plot.stage.w=500;plot.draw(samples,30);assert.equal(snapshots,4);
  plot.descriptor.label='Changed';plot.draw(samples,30);assert.equal(snapshots,5);
  const replaced=samples.map(p=>({...p,x:-p.x}));plot.draw(replaced,30);assert.equal(snapshots,6);
  plot.descriptor.kind='phase';plot.descriptor.series.push({key:'t',label:'t'});plot.draw(samples,1);const phase=paths;plot.draw(samples,2);assert.equal(paths,phase);
 }finally{globalThis.OffscreenCanvas=original;}
});

test('equations throttle only playback; pausing and direct changes render immediately',()=>{
 assert.equal(equationDue(true,100,349),false);assert.equal(equationDue(true,100,350),true);assert.equal(equationDue(true,undefined,100),true);assert.equal(equationDue(false,100,101),true);
 let renders=0;const el={dataset:{},set innerHTML(value){renders++;this.html=value}};
 const original=globalThis.window;globalThis.window={};try{ExperimentShell.prototype.equation(el,['x=1']);ExperimentShell.prototype.equation(el,['x=1']);assert.equal(renders,1);ExperimentShell.prototype.equation(el,['x=2']);assert.equal(renders,2);}finally{globalThis.window=original;}
 let draws=0;const shell={playing:true,q:()=>({setAttribute(){}}),draw(){draws++},changed(){}};ExperimentShell.prototype.setPlaying.call(shell,false);assert.equal(draws,1);
});

test('equation blocks retain unchanged DOM, spread playback work, and flush on pause',()=>{
 const originalWindow=globalThis.window,originalDocument=globalThis.document;let renders=0,wakes=0;
 globalThis.window={renderMathInElement(){renders++}};globalThis.document={createElement:()=>({dataset:{},innerHTML:''})};
 try{
  const el={dataset:{},children:[],append(row){this.children.push(row)}},shell={playing:true,invalidate(){wakes++}};
  ExperimentShell.prototype.equation.call(shell,el,['a=1','b=2']);assert.equal(renders,1);assert.ok(el.equationPending);assert.equal(wakes,1);const first=el.children[0];
  ExperimentShell.prototype.equation.call(shell,el,['a=3','b=4']);assert.equal(renders,2);assert.equal(el.equationPending,null);assert.equal(el.dataset.signature,JSON.stringify(['a=1','b=2']));
  shell.playing=false;ExperimentShell.prototype.equation.call(shell,el,['a=1','b=4']);assert.equal(renders,3);assert.equal(el.children[0],first);assert.equal(el.dataset.signature,JSON.stringify(['a=1','b=4']));
 }finally{globalThis.window=originalWindow;globalThis.document=originalDocument;}
});

test('clean paused frames and hidden panes or documents do no drawing or stepping',()=>{
 const oldDocument=globalThis.document,oldRAF=globalThis.requestAnimationFrame;let draws=0,steps=0,requests=0,rects=true;
 globalThis.document={hidden:false};globalThis.requestAnimationFrame=()=>++requests;
 try{
  const shell=Object.assign(Object.create(ExperimentShell.prototype),{host:{isConnected:true,getClientRects:()=>rects?[{}]:[]},tickReady:true,dirty:false,playing:false,last:0,speed:1,duration:60,instance:{t:0,step(){steps++},sample:()=>({})},observeEnd(){},draw(){draws++;this.dirty=false;}});
  for(let i=0;i<600;i++)shell.tick(i*16);assert.equal(draws,0);assert.equal(requests,0);
  shell.invalidate();assert.equal(requests,1);shell.tick(10000);assert.equal(draws,1);
  shell.playing=true;rects=false;for(let i=0;i<600;i++)shell.tick(11000+i*16);assert.equal(draws,1);assert.equal(steps,0);
  rects=true;document.hidden=true;for(let i=0;i<600;i++)shell.tick(21000+i*16);assert.equal(draws,1);assert.equal(steps,0);
  document.hidden=false;shell.invalidate();shell.tick(32000);assert.equal(draws,2);assert.equal(steps,1);
 }finally{globalThis.document=oldDocument;globalThis.requestAnimationFrame=oldRAF;}
});

test('view cleanup signals abort once on forecast restart and destroy',()=>{
 const oldRAF=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame;globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 try{
  let cleanups=0;const shell=Object.assign(Object.create(ExperimentShell.prototype),{lifecycle:new AbortController(),model:{create(){return {sample:()=>({t:0})}}},params:{},instance:{sample:()=>({t:0})},q:()=>({}),observeEnd(){},graphStatus(){},cancelSeek(){},observer:{disconnect(){}},host:{replaceChildren(){}},custom:null});
  shell.startForecast();const first=shell.signal;shell.onCleanup(()=>cleanups++);const unregister=shell.onCleanup(()=>cleanups+=100);unregister();
  shell.startForecast();assert.equal(first.aborted,true);assert.equal(shell.signal.aborted,false);assert.equal(cleanups,1);
  const second=shell.signal;shell.onCleanup(()=>cleanups++);shell.destroy();shell.destroy();assert.equal(second.aborted,true);assert.equal(cleanups,2);assert.equal(shell.lifecycle.signal.aborted,true);
 }finally{globalThis.requestAnimationFrame=oldRAF;globalThis.cancelAnimationFrame=oldCancel;}
});
