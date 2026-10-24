import {model} from './model.js';
import {runBatches} from './work.js';

// A separate trajectory: never advances the visible experiment or its history.
// The maximum time and number of advances bound even escaping/non-crossing cases.
export function* sectionBatches(params,{target=320,horizon=100000,advance=.5,batch=64}={}){
 const sim=model.create(params);
 advance=Math.min(advance,(params.maxStep??.01)*32);
 let points=[];
 while(sim.t<horizon&&points.length<target){
  const started=performance.now();
  for(let i=0;i<batch&&sim.t<horizon&&points.length<target;i++){
   sim.step(Math.min(advance,horizon-sim.t));
   points=sim.geometry().poincare||[];
   if(sim.sample().status!=='running'||performance.now()-started>=6)break;
  }
  const stopped=sim.sample().status!=='running';
  const done=points.length>=target||sim.t>=horizon||stopped;
  yield {points:points.slice(0,target),time:sim.t,done,reason:stopped?'Close encounter':points.length>=target?'Complete':'Time limit'};
  if(done)return;
 }
}

export function startSection(params,{options,...lifecycle}={}){
 return runBatches(sectionBatches(params,options),{points:[],time:0,done:false,cancelled:false,error:''},lifecycle);
}

// Crossing timestamps are physical (negative in reverse); the scrubber is elapsed.
export const crossingElapsed=p=>Math.abs(p.t);
