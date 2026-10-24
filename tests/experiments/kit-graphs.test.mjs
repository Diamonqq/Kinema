import test from 'node:test';
import assert from 'node:assert/strict';
import {axisLabel,decimate,LinkedGraph} from '../../static/js/experiments/kit/graphs.js';
import {num} from '../../static/js/experiments/kit/format.js';

test('axis labels use shared significant figures, minus and powers of ten',()=>{
 for(const v of [-.25,-1.108e-4,6.28e11,2443.84,0])assert.equal(axisLabel(v),num(v));
 assert.equal(axisLabel(-.25),'\u22120.250');assert.equal(axisLabel(-1.108e-4),'\u22121.11\u00d710\u207b\u2074');
});
test('decimation retains gaps and finite endpoints even within a single pixel column',()=>{
 const samples=[0,2,1,NaN,NaN,4,3,Infinity,-Infinity,6,5,NaN].map((x,t)=>({t,x}));
 const result=decimate(samples,'x',0,11,1);
 assert.deepEqual(result.map(p=>p.t),[0,1,2,3,5,6,7,9,10,11]);
 assert.ok(Number.isNaN(result[3].x));assert.equal(result[6].x,Infinity);
 for(let i=1;i<result.length;i++)assert.ok(result[i].t>result[i-1].t);
 assert.ok(decimate([{t:0,x:NaN},{t:1,x:NaN}],'x',0,1,10).every(p=>Number.isNaN(p.x)));
});
test('a wrapped time-series draws independent paths, never a chord across a NaN',()=>{
 const paths=[];let current=[];
 const ctx=new Proxy({beginPath(){current=[]},moveTo(x,y){current.push(['M',x,y])},lineTo(x,y){current.push(['L',x,y])},stroke(){paths.push(current.slice())}},{get:(o,k)=>o[k]||(()=>{})});
 const plot=Object.create(LinkedGraph.prototype);plot.descriptor={label:'Angle',unit:'rad',series:[{key:'x',label:'\u03b8'}]};
 plot.stage={w:400,h:180,dpr:1,ctx,labels:[],resize(){},begin(){},text(){},line(){},circle(){}};
 plot.draw([0,1,NaN,-1,0].map((x,t)=>({t,x})),0);
 assert.equal(paths.length,1);assert.deepEqual(paths[0].map(p=>p[0]),['M','L','M','L']);
 assert.ok(paths[0].every(p=>p.slice(1).every(Number.isFinite)));
});
