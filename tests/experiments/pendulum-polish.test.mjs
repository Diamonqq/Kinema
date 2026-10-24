import test from 'node:test';
import assert from 'node:assert/strict';
import {model as pendulum} from '../../static/js/experiments/pendulum/model.js';
import {view as pendulumView,pendulumBounds,shaftHits} from '../../static/js/experiments/pendulum/view.js';
import {fixedMap,linePlot} from '../../static/js/experiments/motion-generator/view-tools.js';
function stage(w,h){
 const ctx=new Proxy({measureText:t=>({width:t.length*6}),createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{}});
 const s={w,h,ctx,snap:true,labels:[],avoid:[],line(){},circle(){},arrow(){},spring(){},text(text,x,y,color,size=12,align='center'){const width=ctx.measureText(text).width;this.labels.push({text,x:x-(align==='center'?width/2:align==='right'?width:0),y:y-size*.65,width,height:size*1.3});}};return s;
}
function frame(model,values){const params=Object.fromEntries(model.params.map(p=>[p.key,values?.[p.key]??p.value])),instance=model.create(params);return {params,instance,t:0,sample:instance.sample(),geometry:instance.geometry(),samples:[],breakdown:false,closeup:''};}
test('gallery thumbnails contain apparatus only: zero caption or readout labels',async()=>{
 for(const id of ['motion-generator','pendulum','anharmonic']){const {model}=await import('../../static/js/experiments/'+id+'/model.js'),{view}=await import('../../static/js/experiments/'+id+'/view.js'),s=stage(260,112);view.draw(s,{...frame(model),thumbnail:true});assert.equal(s.labels.length,0,id);}
});
test('pendulum force labels clear every shaft and all three terms remain visible at both widths, tolerance 0 px',()=>{
 for(const [w,h] of [[320,500],[570,500],[320,340],[570,340]])for(const closeup of ['', 'gravity']){
  const s=stage(w,h),f={...frame(pendulum),breakdown:!closeup,closeup};pendulumView.draw(s,f);
  for(const term of ['mg','-mg sinθ','mg cosθ']){const rect=s.labels.find(l=>l.text===term);assert.ok(rect,`${w}x${h} ${closeup}: missing ${term}`);for(const a of s.forceArrows)assert.equal(shaftHits(rect,[a.ax,a.ay],[a.x,a.y],2),false,`${w} ${term}`);}
 }
});
test('pendulum focused fixed envelope contains all presets over 60 s, tolerance 1e-6 m',()=>{
 for(const preset of pendulum.presets){const p=preset.values,b=pendulumBounds(p,true),i=pendulum.create(p);
  for(let n=0;n<=120;n++){const q=i.sample();assert.ok(q.x>=b[0]-1e-6&&q.x<=b[1]+1e-6&&q.y>=b[2]-1e-6&&q.y<=b[3]+1e-6,preset.id);if(n<120)i.step(.5);}
 }
});
test('focused small-angle pendulum uses at least 100 px of a 340 px scene; tolerance 1e-10 px',()=>{
 const f=frame(pendulum),s=stage(320,340),m=fixedMap(s,pendulumBounds(f.params,true),{top:34,bottom:190,padding:35});assert.ok(m.scale*f.params.length>=100-1e-10);
});

test('main small-angle view uses the fixed conservative envelope, including initial speed; tolerance 1e-6 m',()=>{
 for(const values of [{theta0:.3},{theta0:.1,omega0:1.2}]){const f=frame(pendulum,values),b=pendulumBounds(f.params),s=stage(320,280),m=fixedMap(s,b,{top:28,bottom:145,padding:35});assert.ok(m.scale*f.params.length>80);
  for(let n=0;n<120;n++){const q=f.instance.sample();assert.ok(q.x>=b[0]-1e-6&&q.x<=b[1]+1e-6&&q.y>=b[2]-1e-6&&q.y<=b[3]+1e-6);f.instance.step(.5);}
 }
});
test('nonnegative spectrum starts at zero and keeps amplitude caption above the curve, tolerance 0 px',()=>{
 for(const w of [260,570]){const s=stage(w,190);s.resize=()=>{};s.begin=()=>{s.labels=[];};linePlot(s,{title:'Angular velocity spectrum',points:[{x:0,y:0},{x:1,y:.32},{x:2,y:.01}],ylabel:'amplitude',yFloor:0});assert.equal(s.plotBounds.ymin,0);const caption=s.labels.find(l=>l.text==='amplitude');assert.ok(caption);assert.ok(caption.y+caption.height<s.plotBounds.top);}
});
