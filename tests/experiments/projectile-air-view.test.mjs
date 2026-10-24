import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {model} from '../../static/js/experiments/projectile-air/model.js';
import {view,preview,mapWorld,segmentHitsRect} from '../../static/js/experiments/projectile-air/view.js';
const params=Object.fromEntries(model.params.map(p=>[p.key,p.value]));
test('projectile manifest is exactly synchronized with parameter, preset, graph and close-up descriptors',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('../../static/js/experiments/projectile-air/manifest.json',import.meta.url)));
 assert.equal(m.group,'Mechanics');for(const k of ['params','presets'])assert.deepEqual(m[k],model[k]);for(const k of ['graphs','closeups'])assert.deepEqual(m[k],view[k]);
});
test('fixed preview contains every point of each preset flight and ghost (absolute 1e-9 m)',()=>{
 for(const p of model.presets){const data=preview(p.values),[a,b,c,d]=data.bounds;for(const q of [...data.path,...data.ghost])assert.ok(q.x>=a-1e-9&&q.x<=b+1e-9&&q.y>=c-1e-9&&q.y<=d+1e-9);assert.equal(data.path.at(-1).landed,true,p.id);assert.equal(preview(p.values),data);assert.equal(data.apex.vy,0);const i=model.create(p.values);i.step(data.apex.t);assert.ok(Math.abs(i.sample().vy)<1e-6);}
});
test('symbolic equations retain literal TeX and numerical substitutions',()=>{
 const instance=model.create(),f={params,sample:instance.sample(),geometry:instance.geometry(),instance,t:0};const equations=view.equations(f);assert.ok(equations.some(s=>s.includes('\\cos\\theta')));assert.ok(equations.some(s=>s.includes('30.6')));for(const z of view.closeups){const eq=view.closeupEquation({...f,closeup:z.id});assert.ok(eq.length>=2);assert.ok(eq.every(s=>typeof s==='string'&&!s.includes('NaN')));}
});


test('projectile thumbnail draws apparatus without readouts or captions',()=>{
 const instance=model.create(),ctx=new Proxy({}, {get:(o,k)=>()=>{}});let texts=0;
 const s={w:300,h:155,ctx,line(){},circle(){},text(){texts++;}};
 view.draw(s,{params,instance,sample:instance.sample(),geometry:instance.geometry(),t:0,closeup:'',breakdown:false,thumbnail:true});assert.equal(texts,0);assert.ok(s.camera.scale>0);
});

test('narrow framing reserves drag and velocity tip margins (1e-9 px tolerance)',()=>{
 for(const preset of model.presets)for(const w of [300,370]){
  const data=preview(preset.values),map=mapWorld({w,h:440,snap:true},data.bounds);
  assert.ok(map.x(0)>=54-1e-9,preset.id);
  assert.ok(Math.max(...data.path.map(q=>map.x(q.x)))<=w-22+1e-9,preset.id);
 }
});

test('leader clipping detects crossing and grazing chips, and permits clear routes (1e-9 px parallel tolerance)',()=>{
 const chip={x:20,y:20,width:40,height:32};
 assert.equal(segmentHitsRect(0,30,90,30,chip),true);
 assert.equal(segmentHitsRect(0,20,90,20,chip),true);
 assert.equal(segmentHitsRect(30,30,90,90,chip),true);
 assert.equal(segmentHitsRect(0,10,90,10,chip),false);
 assert.equal(segmentHitsRect(10,0,10,90,chip),false);
});


test('lowered canvas subscripts retain a single full collision rectangle',async()=>{
 const {label}=await import('../../static/js/experiments/projectile-air/labels.js'),drawn=[];
 const ctx={font:'',measureText(t){return {width:t.length*Number(this.font.match(/[0-9.]+/)[0])*.5};},save(){},restore(){},fillText(text,x,y){drawn.push({text,x,y,font:this.font});}};
 const stage={ctx,labels:[],text(){assert.fail('Subscript must use composite drawing');}};
 label(stage,'v_x',40,20,'blue',12);
 assert.deepEqual(drawn.map(d=>d.text),['v','x']);assert.ok(drawn[1].y>drawn[0].y);assert.ok(parseFloat(drawn[1].font)<parseFloat(drawn[0].font));
 assert.equal(stage.labels.length,1);assert.equal(stage.labels[0].text,'v_x');assert.ok(stage.labels[0].y+stage.labels[0].height>drawn[1].y);
});

test('all flight arrows and component labels stay inside 1280/390/320 viewports (1e-7 px tolerance)',async()=>{
 const {VectorStage}=await import('../../static/js/experiments/kit/stage.js');globalThis.devicePixelRatio=1;
 for(const preset of model.presets)for(const width of [566,370,300])for(const t of [0,.05,.5,1.5,preview(preset.values).path.at(-1).t*.75]){
  const ctx=new Proxy({font:'12px system-ui',textAlign:'center',measureText(t){const size=parseFloat(this.font),width=t.length*size*.55;return {width,actualBoundingBoxLeft:this.textAlign==='right'?width:this.textAlign==='left'?0:width/2,actualBoundingBoxRight:this.textAlign==='right'?0:this.textAlign==='left'?width:width/2,actualBoundingBoxAscent:size*.75,actualBoundingBoxDescent:size*.25};}},{get:(o,k)=>k in o?o[k]:(()=>{})});
  const stage=new VectorStage({width,height:440,getBoundingClientRect:()=>({width,height:440}),getContext:()=>ctx}),instance=model.create(preset.values),arrows=[];
  const arrow=stage.arrow.bind(stage);stage.arrow=(x,y,tx,ty,...rest)=>{arrows.push([x,y,tx,ty]);arrow(x,y,tx,ty,...rest);};
  instance.step(t);stage.begin();view.draw(stage,{params:instance.params||preset.values,instance,sample:instance.sample(),geometry:instance.geometry(),t,closeup:'',breakdown:true});
  for(const a of arrows)assert.ok(a.every((v,j)=>v>=-1e-7&&v<=(j%2?440:width)+1e-7),`${preset.id} ${width} ${t}: arrow ${a}`);
  for(const r of stage.labels)assert.ok(r.x>=-1e-7&&r.y>=-1e-7&&r.x+r.width<=width+1e-7&&r.y+r.height<=440+1e-7,`${preset.id} ${width} ${t}: ${r.text}`);
  if(instance.sample().speed>1e-3){assert.ok(stage.labels.some(r=>r.text==='v_x'));if(Math.abs(instance.sample().vy)>1e-3)assert.ok(stage.labels.some(r=>r.text==='v_y'));}
 }
});

test('launch chip stays put between Scene and Breakdown and the velocity resultant is labeled at its tip',()=>{
 const instance=model.create(),ctx=new Proxy({measureText(t){return {width:t.length*6};}}, {get:(o,k)=>k in o?o[k]:(()=>{})});
 const mk=breakdown=>({w:1000,h:500,ctx,labels:[],line(){},circle(){},arrow(){},text(t,x,y){this.labels.push({text:t,x,y});}}),f=b=>({params,instance,sample:instance.sample(),geometry:instance.geometry(),t:0,closeup:'',breakdown:b});
 const a=mk(false),b=mk(true);view.draw(a,f(false));view.draw(b,f(true));
 assert.deepEqual(view.closeupAnchors(a,f(false)).angle,view.closeupAnchors(b,f(true)).angle);
 assert.ok(b.labels.some(l=>l.text==='v'));
});
