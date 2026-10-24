import {runBatches} from './work.js';
import {easeCamera} from '../kit/stage.js';
// Shared by these two experiments only. Coordinates are SI; plot pixels are uniform.
export const C={blue:'#8ab9ff',pale:'#e1e5ed',green:'#b0d8ad',amber:'#e9bb88',purple:'#bcabef',muted:'#8496ae',grid:'#334256'};
const scientific=n=>Math.abs(n)>=1e5||Math.abs(n)>0&&Math.abs(n)<.001;
export const fmt=n=>(scientific(n)?n.toExponential(2).replace(/e([+-]?)(\d+)/,(_,sign,power)=>'×10'+(sign==='-'?'⁻':'')+String(Number(power)).replace(/\d/g,d=>'⁰¹²³⁴⁵⁶⁷⁸⁹'[d])):String(Number(n.toPrecision(3)))).replace(/^-/, '−');
export const tex=n=>scientific(n)?n.toExponential(2).replace(/e([+-]?)(\d+)/,(_,sign,power)=>String.raw`\times10^{${sign==='-'?'-':''}${Number(power)}}`):fmt(n).replace('−','-');
export const sectionTick=n=>String(Number(n.toPrecision(2))).replace(/^-/, '−');
export function sceneHeight(shell,narrowHeight,closeup,cap=false){
 if(!shell?.scene)return;
 const height=closeup?360:shell.stage.w<460?narrowHeight:420;
 if(cap){shell.scene.style.flexGrow='0';shell.scene.style.maxHeight=height+'px';}
 if(shell.scene.style.minHeight!==height+'px'){
  shell.scene.style.minHeight=height+'px';shell.scene.style.flexBasis=height+'px';shell.stage.resize();
 }
}
// Target chips use fixed forecast landmarks, not the moving body. Nonphysical
// views share a measured wrapping row. Sizes remain entirely kit controlled.
const chipLayouts=new WeakMap(),noObstacles=Object.freeze([]);
export function targetChips(s,targets,rowIds,shell,obstacles=noObstacles){
 const signature=JSON.stringify([s.w,s.h,targets,rowIds]),cached=chipLayouts.get(s);
 const draw=layout=>{
  s.chipRects=layout.boxes;s.targetAnchors=layout.anchors;
  for(const [id,p] of Object.entries(targets)){const a=layout.anchors[id],b=layout.targetBoxes[id];s.line(p.x,p.y,a.x,b.y+(p.y>b.y?b.height:0),C.grid,1);}
  return layout.anchors;
 };
 if(cached&&cached.signature===signature&&cached.params===shell?.params&&cached.obstacles===obstacles)return draw(cached);
 const targetBoxes={};
 const sizes=id=>{const b=shell?.q('[data-exp="closeup"][data-id="'+id+'"]');return {w:b?.offsetWidth||112,h:b?.offsetHeight||32};};
 const anchors={},boxes=[];let row=[],width=0,y=12;
 const flush=()=>{let x=(s.w-width)/2;for(const id of row){const b=sizes(id);anchors[id]={x:x+b.w/2,y};boxes.push({x,y,width:b.w,height:b.h});x+=b.w+6;}row=[];width=0;y+=38;};
 for(const id of rowIds){const b=sizes(id);if(row.length&&width+6+b.w>s.w-16)flush();width+=b.w+(row.length?6:0);row.push(id);}if(row.length)flush();
 for(const [id,p] of Object.entries(targets)){
  const b=sizes(id),preferred=p.offsets||[[0,-48],[65,28],[-65,28],[0,54],[90,-42],[-90,-42]];
  const search=[];if(obstacles.length)for(let yy=y+8;yy<=s.h-100-b.h;yy+=8)for(let xx=8;xx<=s.w-b.w-8;xx+=8)search.push([xx+b.w/2-p.x,yy-p.y]);
  search.sort((a,b)=>Math.hypot(...a)-Math.hypot(...b));const candidates=[...preferred,...search];
  let box;
  for(const [dx,dy] of candidates){
   const x=Math.max(8,Math.min(s.w-b.w-8,p.x+dx-b.w/2)),yy=Math.max(y+8,Math.min(s.h-100-b.h,p.y+dy));
   const q={x,y:yy,width:b.w,height:b.h};
   if(![...boxes,...obstacles].some(a=>a.x<q.x+q.width+8&&a.x+a.width+8>q.x&&a.y<q.y+q.height+8&&a.y+a.height+8>q.y)){box=q;break;}
  }
  if(!box)box={x:8,y:y+Object.keys(anchors).length*38,width:b.w,height:b.h};
  anchors[id]={x:box.x+b.w/2,y:box.y};boxes.push(box);
  targetBoxes[id]=box;
 }
 const layout={signature,params:shell?.params,obstacles,anchors,boxes,targetBoxes};chipLayouts.set(s,layout);return draw(layout);
}
export function camera(s,bounds,top=100,bottom=58){
 const [a,b,c,d]=bounds,scale=Math.min((s.w-40)/Math.max(.01,b-a),(s.h-top-bottom)/Math.max(.01,d-c));
 const target={cx:(a+b)/2,cy:(c+d)/2,scale};
 if(!s.camera||s.snap)s.camera=target;else if(easeCamera(s.camera,target))s.animating=true;
 s.snap=false;const q=s.camera,cy=top+(s.h-top-bottom)/2;
 return {x:v=>s.w/2+(v-q.cx)*q.scale,y:v=>cy-(v-q.cy)*q.scale,scale:q.scale};
}
export function linePath(s,points,map,color,width=1.2){if(!points.length)return;const c=s.ctx;c.beginPath();points.forEach((p,i)=>i?c.lineTo(map.x(p.x),map.y(p.y)):c.moveTo(map.x(p.x),map.y(p.y)));c.strokeStyle=color;c.lineWidth=width;c.stroke();}
export function boundsFor(rows,frame){let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
 for(const row of rows)for(const q of (row.geometry.frames[frame]||row.geometry.bodies)) {xmin=Math.min(xmin,q.x);xmax=Math.max(xmax,q.x);ymin=Math.min(ymin,q.y);ymax=Math.max(ymax,q.y);}
 const pad=Math.max(.5,(xmax-xmin)*.07,(ymax-ymin)*.07);return [xmin-pad,xmax+pad,ymin-pad,ymax+pad];
}
export function* motionBatches(model,params,{duration=60,interval=.1}={}){
 const sim=model.create(params),rows=[{t:0,sample:sim.sample(),geometry:sim.geometry()}];
 yield {rows,done:false};
 while(sim.t<duration-1e-9){for(let i=0;i<8&&sim.t<duration-1e-9;i++) {sim.step(Math.min(interval,duration-sim.t));rows.push({t:sim.t,sample:sim.sample(),geometry:sim.geometry()});}yield {rows,done:sim.t>=duration-1e-9};}
}
const forecasts=new WeakMap();
export function forecast(model,params,options={}){
 let state=forecasts.get(params);
 if(state&&!state.cancelled&&state.signal===options.signal)return state;
 state?.cancel?.();
 state={rows:[],done:false,error:''};forecasts.set(params,state);
 function* batches(){for(const batch of motionBatches(model,params,options))yield {...batch,rows:batch.rows.slice()};}
 return runBatches(batches(),state,{...options,immediate:true});
}

export function chipAnchors(s,ids){const cols=s.w<460?2:3,rows=Math.ceil(ids.length/cols);return Object.fromEntries(ids.map((id,i)=>[id,{x:s.w*((i%cols)+.5)/cols,y:12+Math.floor(i/cols)*30}]));}
export function title(s,text){s.text(text,s.w/2,48,C.pale,s.w<380?12:14);}
export function label(s,text,x,y,color=C.pale){
 const c=s.ctx;c.font='12px system-ui';const width=c.measureText(text).width,yy=Math.max(38,Math.min(s.h-40,y));
 x=Math.max(width/2+8,Math.min(s.w-width/2-8,x));
 for(const delta of [0,16,-16,32,-32]){const box={x:x-width/2,y:yy+delta-7,width,height:14};
  if(box.y<35||box.y+14>s.h-35)continue;
  if([...s.labels,...(s.chipRects||[]),...(s.labelObstacles||[])].every(a=>!(a.x<box.x+width+3&&a.x+a.width+3>box.x&&a.y<box.y+14+3&&a.y+a.height+3>box.y))){s.text(text,x,yy+delta,color,12);return true;}}
 return false;
}
export function vector(s,x,y,dx,dy,color,text){if(Math.hypot(dx,dy)<.05)return;s.arrow(x,y,x+dx,y+dy,color,2);if(text)label(s,text,x+dx+Math.sign(dx||1)*12,y+dy-10,color);}
export function plot(s,points,{xkey='x',ykey='y',energy,cursor,label:caption='',scatter=false,zero=false,pointColor=()=>C.blue,tickFormat=fmt}={}){
 const compact=s.h<220,left=76,right=s.w-28,top=compact?32:90,bottom=s.h-(compact?32:scatter?84:68),values=points.filter(p=>Number.isFinite(p[xkey])&&Number.isFinite(p[ykey]));
 if(!values.length){s.text('No completed points yet',s.w/2,s.h/2,C.muted,13);return;}
 let xmin=Math.min(...values.map(p=>p[xkey])),xmax=Math.max(...values.map(p=>p[xkey])),lo=Math.min(...values.map(p=>p[ykey])),hi=Math.max(...values.map(p=>p[ykey]));
 if(zero){lo=Math.min(0,lo);hi=Math.max(0,hi);}
 if(Number.isFinite(energy)){lo=Math.min(lo,energy);hi=Math.max(hi,energy);}
 // A lone section crossing needs a visible neighbourhood, not a zero-width axis.
 if(scatter){
  const minX=Math.max(.1,Math.abs((xmin+xmax)/2)*.1),minY=Math.max(.1,Math.abs((lo+hi)/2)*.1);
  if(xmax-xmin<minX){const centre=(xmin+xmax)/2;xmin=centre-minX/2;xmax=centre+minX/2;}
  if(hi-lo<minY){const centre=(lo+hi)/2;lo=centre-minY/2;hi=centre+minY/2;}
 }
 const span=Math.max(1e-9,hi-lo),xspan=Math.max(.01,xmax-xmin);lo-=span*.12;hi+=span*.12;
 if(zero&&values.every(p=>p[ykey]>=0)&&!(energy<0))lo=0;
 const x=v=>left+(v-xmin)/xspan*(right-left),y=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
 s.line(left,top,left,bottom,C.grid);s.line(left,bottom,right,bottom,C.grid);
 s.text(tickFormat(xmin),left,bottom+17,C.muted,10);s.text(tickFormat(xmax),right,bottom+17,C.muted,10);
 s.text(tickFormat(hi),left-5,top,C.muted,10,'right');s.text(tickFormat(lo),left-5,bottom,C.muted,10,'right');
 if(scatter)values.forEach(p=>s.circle(x(p[xkey]),y(p[ykey]),2.5,pointColor(p)));else linePath(s,values.map(p=>({x:p[xkey],y:p[ykey]})),{x,y},C.blue,2);
 if(Number.isFinite(energy)){s.line(left,y(energy),right,y(energy),C.amber,1.5);s.text('E',right-5,y(energy)-10,C.amber,12);}
 if(cursor&&cursor.x>=xmin&&cursor.x<=xmax){s.line(x(cursor.x),top,x(cursor.x),bottom,C.pale,1);if(Number.isFinite(cursor.y)&&cursor.y>=lo&&cursor.y<=hi)s.circle(x(cursor.x),y(cursor.y),4,C.pale);}
 if(!compact)s.text(caption,s.w/2,s.h-40,C.muted,12);
 return {xmin,xmax,lo,hi};
}
