import test from 'node:test';
import assert from 'node:assert/strict';
import {view as coupled} from '../../static/js/experiments/coupled-oscillators/view.js';
import {model} from '../../static/js/experiments/coupled-oscillators/model.js';
import {linePlot,sparseTicks} from '../../static/js/experiments/motion-generator/view-tools.js';
import {VectorStage} from '../../static/js/experiments/kit/stage.js';

const fakeCtx=()=>new Proxy({font:'11px system-ui',measureText(text){const size=Number.parseFloat(this.font)||11;return {width:String(text).length*size*.58}}},{get:(obj,key)=>obj[key]||(()=>{})});
const stage=(w,h)=>Object.assign(Object.create(VectorStage.prototype),{ctx:fakeCtx(),w,h,labels:[],snap:true,texts:[],resize(){},begin(){this.labels=[];this.texts=[];},text(t){this.texts.push(String(t));},circle(){},line(){}});

test('coupled oscillators: narrow k labels stay on one line or fall back to names only', () => {
  const instance=model.create({}),frame={instance,geometry:instance.geometry(),params:instance.params,sample:instance.sample(),t:0,breakdown:false,closeup:''};
  for(const width of [225,260,320,568]){
    const s=stage(width,156);coupled.draw(s,frame);
    assert.ok(!s.texts.some(t=>t==='N/m'),'no stand-alone unit line at '+width);
    for(const t of s.texts.filter(t=>/N\/m/.test(t)))assert.match(t,/^\S+ N\/m$|^k[₀-₉] = \S+ N\/m$/);
  }
});

test('phase plots can ask for four round ticks and a tighter margin', () => {
  const orbit=Array.from({length:200},(_,i)=>({theta:Math.cos(i/10)*.2,omega:-Math.sin(i/10)*.9}));
  const s=stage(290,170);linePlot(s,{title:'p',points:orbit,xkey:'theta',ykey:'omega',yTicks:3,pad:.08});
  const ticks=s.texts.filter(t=>/^[−0-9.]+$/.test(t));
  assert.ok(s.plotBounds.ymax<1.05&&s.plotBounds.ymin>-1.05);
  assert.ok(ticks.includes('0'),ticks.join(','));
});

test('speed-axis ticks: at most three, at least 18 px apart, fall back to the largest round value each side',()=>{
  const gap=(t,px,lo,hi)=>Math.min(...t.ticks.slice(1).map((v,i)=>(v-t.ticks[i])*px/(hi-lo)));
  for(const [lo,hi] of [[-.45,.45],[-.6,.6],[-.7,.7],[-1.3,1.3],[-.12,.31]]){const t=sparseTicks(lo,hi,55);assert.ok(t.ticks.length>=2&&t.ticks.length<=3,JSON.stringify(t));assert.ok(gap(t,55,lo,hi)>=18,JSON.stringify(t));}
  assert.deepEqual(sparseTicks(-.45,.45,55).ticks,[-.4,0,.4].map(v=>v));
  const t=sparseTicks(-.7,.7,20);assert.deepEqual(t.ticks,[-.5,0,.5]);
});
