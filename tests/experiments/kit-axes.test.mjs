import test from 'node:test';
import assert from 'node:assert/strict';
import {LinkedGraph} from '../../static/js/experiments/kit/graphs.js';
import {ExperimentShell} from '../../static/js/experiments/kit/shell.js';

const draw=(descriptor,samples,time=0,size={w:400,h:180})=>{
 const texts=[],lines=[],ctx=new Proxy({measureText:t=>({width:String(t).length*5})},{get:(o,k)=>o[k]||(()=>{})});
 const plot=Object.create(LinkedGraph.prototype);plot.descriptor=descriptor;
 plot.stage={...size,dpr:1,ctx,labels:[],resize(){},begin(){},text(...a){texts.push(a)},line(...a){lines.push(a)},circle(){}};
 plot.draw(samples,time);return {texts,lines,plot};
};
const wave=Array.from({length:101},(_,i)=>({t:i/10,x:.7*Math.sin(i/5),v:.7*Math.cos(i/5)}));

test('a time-series axis shows round ticks with zero, not the padded extremes',()=>{
 const {texts,lines}=draw({label:'Position',unit:'m',series:[{key:'x',label:'x'}]},wave,2);
 const left=texts.filter(l=>l[5]==='right').map(l=>l[0]);
 assert.ok(left.includes('0'),left.join());assert.ok(left.length>=3);
 assert.ok(!left.includes('0.868')&&!left.includes('\u22120.868'),'no padded extreme labels');
 assert.ok(left.includes('\u22120.5')&&left.includes('0.5'));
 assert.ok(lines.some(l=>l[4]==='rgba(160,180,210,0.10)'),'faint gridlines');assert.ok(lines.some(l=>l[4]==='rgba(160,180,210,0.24)'),'zero line');
 for(const l of texts)if(l[3]==='#7b8a9e')assert.equal(l[4],9);
});
test('the time axis has interior ticks and the unit on the last one',()=>{
 const {texts}=draw({label:'Position',series:[{key:'x',label:'x'}]},wave,2);
 const bottom=texts.filter(l=>l[2]>140&&l[2]<165).map(l=>l[0]);
 assert.ok(bottom.includes('0')&&bottom.includes('4')&&bottom.at(-1).endsWith(' s'),bottom.join());
});
test('phase mode labels both axes with round ticks and zero',()=>{
 const {texts}=draw({label:'Phase',kind:'phase',series:[{key:'x',label:'x'},{key:'v',label:'v'}]},wave,2);
 assert.ok(texts.filter(l=>l[5]==='right').some(l=>l[0]==='0'));
 assert.ok(texts.filter(l=>l[2]>140&&l[2]<165).some(l=>l[0]==='0'));
});
test('legends are at least 10px and tick text never leaves the canvas',()=>{
 const {texts}=draw({label:'Position',series:[{key:'x',label:'position'},{key:'v',label:'velocity'}]},wave,2,{w:320,h:180});
 for(const l of texts.filter(l=>l[0]==='position'||l[0]==='velocity'))assert.ok(l[4]>=10);
 for(const l of texts)assert.ok(l[1]>=0&&l[1]<=320);
});

const fakeShell=()=>{
 const panel={hidden:true},button={set(){}},calls={changed:0};
 const shell={enabledGraphs:new Set(),host:{scrollTop:0},q:s=>s==='.exp-graph-panel'?panel:{setAttribute(){}},graphDescriptors:()=>[{id:'a'},{id:'b'},{id:'c'}],syncGraphVisibility(){},revealGraph(){},changed(){calls.changed++},instance:{sample:()=>({}),t:0},params:{},playing:false,closeup:'',breakdown:false};
 return {shell,panel,calls};
};
test('opening and closing the Graphs panel is saved and part of the snapshot',()=>{
 const {shell,panel,calls}=fakeShell();
 ExperimentShell.prototype.setGraphsOpen.call(shell,true);panel.hidden=false;
 assert.equal(calls.changed,1);assert.equal(ExperimentShell.prototype.snapshot.call(shell).graphsOpen,true);
 ExperimentShell.prototype.setGraphsOpen.call(shell,false);panel.hidden=true;
 assert.equal(calls.changed,2);const closed=ExperimentShell.prototype.snapshot.call(shell);
 assert.equal(closed.graphsOpen,false);assert.deepEqual(closed.graphs,['a','b']);
});
