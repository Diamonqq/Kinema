import {model} from './model.js';
import {easeCamera} from '../kit/stage.js';
import {num,texNum} from '../kit/format.js';
import {label,labelWidth} from './labels.js';
const blue='#8ab9ff',green='#b0c9ad',orange='#e9bb88',purple='#bcabef',muted='#8c9cb2';
const cache=new Map(),rad=Math.PI/180;

export const closeups=[{id:'angle',label:'Zoom · launch'},{id:'air-force',label:'Zoom · ball & air'},{id:'apex',label:'Zoom · apex'}];
export const graphs=[
 {id:'motion',label:'Position',unit:'m',series:[{key:'x',label:'x',color:blue},{key:'y',label:'y',color:green}]},
 {id:'velocity',label:'Velocity',unit:'m/s',series:[{key:'vx',label:'Horizontal',color:blue},{key:'vy',label:'Vertical',color:green}]},
 {id:'energy',label:'Energy ledger',unit:'J',series:[{key:'energy',label:'E',color:blue},{key:'dissipatedWork',label:'D',color:orange},{key:'windWork',label:'W',color:purple},{key:'impactLoss',label:'Q',color:green}]},
];
// A per-setup preview, independent of live time/instance, fixes the camera for
// the entire 60 s transport. All shipped presets land inside that horizon.
export function preview(p){
 const key=JSON.stringify(p);if(cache.has(key))return cache.get(key);
 const i=model.create(p),path=[i.sample()],ghost=[];let apex=path[0];
 for(let j=0;j<600&&!path.at(-1).landed;j++){
  const previous=path.at(-1);i.step(.1);const q=i.sample();path.push(q);if(q.y>apex.y)apex=q;
  if(previous.vy>0&&q.vy<=0)apex={...q,x:q.apexX,y:q.apex,vx:q.apexVx,vy:0,t:q.apexTime};
 }
 const vx=p.speed*Math.cos(p.angle*rad),vy=p.speed*Math.sin(p.angle*rad),flight=(vy+Math.sqrt(vy*vy+2*p.gravity*p.height))/p.gravity;
 for(let j=0;j<=120;j++){const t=Math.min(60,flight)*j/120;ghost.push({x:vx*t,y:Math.max(0,p.height+vy*t-.5*p.gravity*t*t)});}
 const xs=[0,...path.map(q=>q.x),...ghost.map(q=>q.x)],ys=[0,...path.map(q=>q.y),...ghost.map(q=>q.y)];
 const xmin=Math.min(...xs),xmax=Math.max(1,...xs),ymax=Math.max(1,...ys),span=Math.max(xmax-xmin,ymax),pad=span*.06;
 const probe=model.create(p);probe.step(apex.t);const fa=probe.geometry().forces,result={path,ghost,apex,apexDrag:fa.drag.x,apexWeight:-fa.gravity.y,bounds:[xmin-pad,xmax+pad,-pad,ymax+pad]};
 if(cache.size>30)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}
export function mapWorld(stage,bounds,top=50,bottom=stage.h-150,padding=stage.w<440?{left:54,right:22}:72){
 const [a,b,c,d]=bounds,w=stage.w,h=Math.max(30,bottom-top),left=typeof padding==='number'?padding:padding.left,right=typeof padding==='number'?padding:padding.right,target={cx:(a+b)/2,cy:(c+d)/2,scale:Math.min((w-left-right)/(b-a),h/(d-c))};
 if(!stage.camera||stage.snap)stage.camera={...target};else if(easeCamera(stage.camera,target))stage.animating=true;
 stage.snap=false;const cam=stage.camera;
 return {x:q=>left+(w-left-right)/2+(q-cam.cx)*cam.scale,y:q=>(top+bottom)/2-(q-cam.cy)*cam.scale,scale:cam.scale};
}
function path(s,points,map,color,dashed=false){s.ctx.setLineDash(dashed?[4,6]:[]);s.ctx.beginPath();points.forEach((q,j)=>j?s.ctx.lineTo(map.x(q.x),map.y(q.y)):s.ctx.moveTo(map.x(q.x),map.y(q.y)));s.ctx.strokeStyle=color;s.ctx.lineWidth=dashed?1.3:2;s.ctx.stroke();s.ctx.setLineDash([]);}
// Segment/rectangle clipping also keeps caption leaders out of close-up chips.
export function segmentHitsRect(x0,y0,x1,y1,r){
 let lo=0,hi=1;const dx=x1-x0,dy=y1-y0;
 for(const [p,q] of [[-dx,x0-r.x],[dx,r.x+r.width-x0],[-dy,y0-r.y],[dy,r.y+r.height-y0]]){
  if(Math.abs(p)<1e-9){if(q<0)return false;continue;}
  const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return false;
 }
 return true;
}
// A vector shorter than MIN_ARROW px is neither drawn nor labeled; its value stays in the equations.
const MIN_ARROW=14;let drawn=new Set();
// Registers every shaft of a diagram first so no label lands on another vector.
function plan(s,list){s.shafts=list.filter(([,,dx,dy,k=1])=>Math.hypot(dx,dy)*k>=MIN_ARROW).map(([x,y,dx,dy,k=1])=>({x0:x,y0:y,x1:x+dx*k,y1:y-dy*k}));}
function vector(s,x,y,dx,dy,term,color,scale=1,labelOffset,place,min=MIN_ARROW){
 if(Math.hypot(dx,dy)*scale<min)return;drawn.add(term);
 const tx=x+dx*scale,ty=y-dy*scale;s.arrow(x,y,tx,ty,color,2);
 const c=s.ctx;c.font='12px system-ui,sans-serif';const width=labelWidth(c,term);
 const baseX=tx+(dx>0?12:dx<0?-12:0),baseY=ty+(labelOffset??(dy>=0?-15:16));
 const clear=(px,py)=>{
  if(py<10||py>s.h-15)return false;
  const rect={x:px-width/2-4,y:py-9,width:width+8,height:18};
  if([...(s.labels||[]),...(s.vectorObstacles||[])].some(a=>rect.x<a.x+a.width+5&&rect.x+rect.width>a.x-5&&rect.y<a.y+a.height+5&&rect.y+rect.height>a.y-5))return false;
  // A vertical downward force keeps its label beyond the tip or beside it, never on its shaft.
  if(dy<0&&Math.abs(dx)<1e-9&&py<ty+12&&Math.abs(px-x)<width/2+4)return false;
  if(segmentHitsRect(x,y,tx,ty,rect))return false;
  if((s.shafts||[]).some(a=>!(Math.abs(a.x0-x)+Math.abs(a.y0-y)+Math.abs(a.x1-tx)+Math.abs(a.y1-ty)<1e-6)&&segmentHitsRect(a.x0,a.y0,a.x1,a.y1,rect)))return false;
  return !(s.vectorChips||[]).some(a=>segmentHitsRect(tx,ty,px,py,a));
 };
 let selected;
 // A vertical downward force prefers the spot just right of its own tip.
 if(!place&&dy<0&&Math.abs(dx)<1e-9){for(const gap of [8,5])for(const oy of [0,-8,-16]){const px=tx+width/2+gap;if(!selected&&clear(px,ty+oy))selected={px,py:ty+oy};}}
 const spots=[];for(const oy of [0,10,-10,20,-20,34,-34,52,-52,72,-72,90,-90])for(const ox of [0,12,-12,24,-24,40,-40,60,-60,90,-90])spots.push([ox,oy]);
 spots.sort((a,b)=>Math.hypot(a[0],a[1])-Math.hypot(b[0],b[1]));
 for(const [ox,oy] of selected?[]:spots){
  const px=Math.max(width/2+7,Math.min(s.w-width/2-7,baseX+ox)),py=baseY+oy;
  if(clear(px,py)){selected={px,py};break;}
 }
 const {px,py}=place?{px:place[0],py:place[1]}:selected||{px:Math.max(width/2+7,Math.min(s.w-width/2-7,baseX)),py:Math.max(10,Math.min(s.h-15,baseY))};
 if(!place&&Math.hypot(px-tx,py-ty)>27)s.line(tx,ty,px,py,color+'80',.8);label(s,term,px,py,color,12,place?.[2]);
}
function triangle(s,f,live=false){
 const p=f.params,q=f.sample,top=s.w<440?85:55,bottom=s.h-62,cx=s.w*.3,cy=(top+bottom)/2+15;
 const vx=live?q.vx:p.speed*Math.cos(p.angle*rad),vy=live?q.vy:p.speed*Math.sin(p.angle*rad),v=Math.hypot(vx,vy);
 const length=Math.min(s.w*.43,(bottom-top)*.58),scale=length/Math.max(1,v),x2=cx+vx*scale,y2=cy-vy*scale;
 s.line(cx,cy,cx+length+10,cy,'#455164',1);s.circle(cx,cy,6,blue);
 s.ctx.setLineDash([3,5]);s.line(x2,cy,x2,y2,green,1);s.ctx.setLineDash([]);
 plan(s,[[cx,cy,vx,0,scale],[x2,cy,0,vy,scale],[cx,cy,vx,vy,scale]]);
 // Each label sits beside its own segment: under the horizontal leg, right of the vertical leg, above the hypotenuse's tip.
 const a=Math.atan2(vy,vx);
 vector(s,cx,cy,vx,0,live?'v cos φ':'v₀ cos θ',blue,scale,undefined,[(cx+x2)/2,cy+17]);
 vector(s,x2,cy,0,vy,live?'v sin φ':'v₀ sin θ',green,scale,undefined,[x2+10,(cy+y2)/2,'left']);
 vector(s,cx,cy,vx,vy,live?'v':'v₀',purple,scale,undefined,[x2-6,y2-15]);s.ctx.beginPath();s.ctx.arc(cx,cy,26,Math.min(0,-a),Math.max(0,-a));s.ctx.strokeStyle=muted;s.ctx.stroke();
 label(s,live?'φ':'θ',cx+36*Math.cos(a/2),cy-36*Math.sin(a/2),muted,13);
 label(s,live?'Velocity components now':'Launch components',s.w/2,s.w<440?68:42,muted,12);
 label(s,`${num(vx)} m/s horizontal`,s.w/2,s.h-76,blue,12);label(s,`${num(vy)} m/s vertical`,s.w/2,s.h-53,green,12);
}
function forceBall(s,f){
 const q=f.sample,g=f.geometry,cx=s.w/2,cy=s.h*.37,r=Math.min(24,s.w*.07),len=Math.min(s.w*.32,s.h*.27);
 s.circle(cx,cy,r,blue+'18');s.ctx.strokeStyle=blue;s.ctx.lineWidth=1.5;s.ctx.beginPath();s.ctx.arc(cx,cy,r,0,Math.PI*2);s.ctx.stroke();
 const forces=g.forces,maxF=Math.max(.001,...Object.values(forces).map(v=>Math.hypot(v.x,v.y))),scale=len/maxF;
 // Forces and air-relative velocity share the ball origin. Force vectors
 // use one common scale; the ball locator is smaller than the drag arrow.
 const uu={x:q.vx-f.params.wind,y:q.vy},uk=Math.min(s.w*.19,55)/Math.max(1,Math.hypot(uu.x,uu.y));
 plan(s,[[cx,cy,0,forces.gravity.y,scale],[cx,cy,forces.drag.x,forces.drag.y,scale],[cx,cy,forces.lift.x,forces.lift.y,scale],[cx,cy,uu.x,uu.y,uk]]);
 vector(s,cx,cy,0,forces.gravity.y,'mg',orange,scale);
 vector(s,cx,cy,forces.drag.x,forces.drag.y,'F_D',green,scale);
 vector(s,cx,cy,forces.lift.x,forces.lift.y,'F_L',purple,scale);
 const vy=cy,vx=cx,u={x:q.vx-f.params.wind,y:q.vy},uScale=Math.min(s.w*.19,55)/Math.max(1,Math.hypot(u.x,u.y));
 vector(s,vx,vy,u.x,u.y,'u',blue,uScale);
 label(s,'Air-relative velocity u = v − wind',s.w/2,s.h-80,muted,11);
 label(s,`v_x ${num(q.vx)} m/s · v_y ${num(q.vy)} m/s`,s.w/2,s.h-57,blue,12);
 label(s,'Drag opposes u; gravity points down',s.w/2,s.h-35,muted,s.w<340?10:12);
}
export const view={graphs,closeups,
 mount(shell){shell.q('.exp-transport').style.background='#191e26';shell.equations.style.paddingBottom='64px';shell.scene.style.minHeight='440px';},
 closeupAnchors(s,f){if(f.closeup)return {};const data=preview(f.params),m=mapWorld(s,data.bounds),q=data.path[Math.min(data.path.length-1,Math.max(1,Math.floor(data.path.length*.2)))];const top=m.y(Math.max(...data.ghost.map(g=>g.y),data.apex.y)),ground=m.y(0),room=s.w<440?44:52,wide=s.w>=440,wA=wide?93:81,wB=wide?106:93;
  const b=data.path[data.path.length-1],bx=Math.max(m.x(b.x)-wB/2-4,m.x(0)+30+wA/2+wB/2+8);
  // Each chip sits within about 40 px of its target: below the launch point, under the ground line beside the landing point, above the apex.
  return {angle:{x:m.x(0)+30,y:m.y(f.params.height)+40},'air-force':{x:bx,y:ground+6},apex:{x:m.x(data.apex.x),y:Math.max(35,top-(wide?52:44))}};},
 key:f=>f.closeup==='air-force'?['Blue: u',...(drawn.has('F_D')?['Green: drag']:[]),'Amber: gravity',...(drawn.has('F_L')?['Violet: lift']:[])].join(' \u00b7 '):f.closeup==='angle'?'Angles measured from horizontal':f.closeup?'':'Blue: projectile \u00b7 dashed: vacuum',
 draw(s,f){
  s.vectorObstacles=[];s.vectorChips=[];s.shafts=[];drawn=new Set();const data=preview(f.params);
  if(f.closeup){
   // A normalized world supplies the shared animated camera transition, while
   // magnified vector diagrams keep fixed readable screen-space caption bands.
   if(f.closeup!=='apex')mapWorld(s,[-1,1,-1,1],45,s.h-65);
   if(f.closeup==='angle')triangle(s,f);
   else if(f.closeup==='air-force')forceBall(s,f);
   else{const apex=data.apex,map=mapWorld(s,[apex.x-10,apex.x+10,apex.y-4,apex.y+4],65,s.h-75);path(s,data.path,map,blue);s.circle(map.x(apex.x),map.y(apex.y),5,blue);const ak=Math.min(70,s.w*.22)/Math.max(1,Math.abs(apex.vx));const dl=38*Math.abs(data.apexDrag)/data.apexWeight,hasDrag=dl>=4,ax=map.x(apex.x),ay=map.y(apex.y);plan(s,[[ax,ay,apex.vx,0,ak],[ax,ay,0,-1,38]]);if(hasDrag)s.shafts.push({x0:ax,y0:ay,x1:ax-Math.sign(apex.vx||1)*dl,y1:ay});vector(s,ax,ay,apex.vx,0,'v_x',blue,ak);vector(s,ax,ay,0,-1,'mg',orange,38);if(hasDrag)vector(s,ax,ay,-Math.sign(apex.vx||1),0,'F_D',green,dl,undefined,undefined,4);label(s,hasDrag?'At the top: v_y = 0, gravity and drag remain':'At the top: v_y = 0, but gravity remains',s.w/2,48,muted,s.w<340?10:12);}
   return;
  }
  const m=mapWorld(s,data.bounds,f.thumbnail?12:50,f.thumbnail?s.h-12:s.h-150,f.thumbnail?22:(s.w<440?{left:54,right:22}:72)),p=f.geometry.position;
  s.line(m.x(data.bounds[0]),m.y(0),m.x(data.bounds[1]),m.y(0),'#465669',1);
  path(s,data.ghost,m,'#8c9cb250',true);path(s,data.path,m,blue+'aa');path(s,data.path.filter(q=>q.t<=f.t+.001),m,blue);
  // Actual diameter is preserved; the luminous halo is an explicit locator.
  const r=f.geometry.radius*m.scale;s.circle(m.x(p.x),m.y(p.y),Math.max(5,r+4),blue+'25');s.circle(m.x(p.x),m.y(p.y),Math.max(.6,r),blue);
  if(!f.thumbnail)label(s,f.sample.landed?`Landed · ${num(f.sample.range)} m`:`Height ${num(f.sample.y)} m`,s.w-12,29,muted,11,'right');
  if(f.breakdown){
   // Chip sizes come from the shared stylesheet: 32 px tall wide, 24 px tall below 440 px.
   const wide=s.w>=440,widths=wide?{angle:93,'air-force':106,apex:84}:{angle:81,'air-force':93,apex:73},chipH=wide?32:24;
   s.vectorObstacles=Object.entries(view.closeupAnchors(s,f)).map(([id,a])=>{const w=widths[id];return {x:Math.max(w/2+8,Math.min(s.w-w/2-8,a.x))-w/2,y:Math.min(s.h-40,a.y),width:w,height:chipH};});
   s.vectorChips=[...s.vectorObstacles];
   for(const q of data.path)s.vectorObstacles.push({x:m.x(q.x)-1,y:m.y(q.y)-1,width:2,height:2});
   for(let x=0;x<s.w;x+=6)s.vectorObstacles.push({x,y:m.y(0)-1,width:6,height:2});
   const len=Math.min(48,s.w*.11),v=f.geometry.velocity,vscale=len/Math.max(1,Math.hypot(v.x,v.y));
   const a0=f.params.angle*rad,l0=Math.min(34,s.w*.09),lx0=m.x(0),ly0=m.y(f.params.height),fs0=f.geometry.forces,max0=Math.max(.001,...Object.values(fs0).map(q=>Math.hypot(q.x,q.y))),k0=34/max0,bx0=m.x(p.x),by0=m.y(p.y);
   plan(s,[[bx0,by0,v.x,0,vscale],[bx0,by0,0,v.y,vscale],[bx0,by0,v.x,v.y,vscale],...(f.t>.2&&s.w>=440?[[lx0,ly0,Math.cos(a0),Math.sin(a0),l0],[lx0,ly0,l0*Math.cos(a0),0],[lx0,ly0,0,l0*Math.sin(a0)]]:[]),...(f.sample.landed?[]:['gravity','drag','lift'].map(n=>[bx0,by0,fs0[n].x,fs0[n].y,k0]))]);
   {vector(s,m.x(p.x),m.y(p.y),v.x,0,'v_x',blue,vscale,14);vector(s,m.x(p.x),m.y(p.y),0,v.y,'v_y',green,vscale);}
   // The velocity itself is the purple resultant of its two components.
   vector(s,m.x(p.x),m.y(p.y),v.x,v.y,'v',purple,vscale);
   const a=f.params.angle*rad,l=Math.min(34,s.w*.09),lx=m.x(0),ly=m.y(f.params.height);
   if(f.t>.2&&s.w>=440){vector(s,lx,ly,Math.cos(a),Math.sin(a),'v₀',purple,l);vector(s,lx,ly,l*Math.cos(a),0,'v_0x',blue,1,-15);vector(s,lx,ly,0,l*Math.sin(a),'v_0y',green);}
   // Force vectors on the moving ball; labels use fixed caption rows below.
   const fs=f.geometry.forces,max=Math.max(.001,...Object.values(fs).map(q=>Math.hypot(q.x,q.y))),k=34/max;
   if(!f.sample.landed)for(const [name,c,term] of [['gravity',orange,'mg'],['drag',green,'F_D'],['lift',purple,'F_L']]){const q=fs[name];vector(s,m.x(p.x),m.y(p.y),q.x,q.y,term,c,k);}
  }
 },
 equations(f){const p=f.params,q=f.sample,g=f.geometry,theta=p.angle*rad;return [
  String.raw`v_{0x}=v_0\cos\theta`,String.raw`(${texNum(p.speed)}\,\mathrm{m/s})\cos(${texNum(p.angle)}^\circ)=${texNum(p.speed*Math.cos(theta))}\,\mathrm{m/s}`,
  String.raw`v_{0y}=v_0\sin\theta`,String.raw`(${texNum(p.speed)}\,\mathrm{m/s})\sin(${texNum(p.angle)}^\circ)=${texNum(p.speed*Math.sin(theta))}\,\mathrm{m/s}`,
  String.raw`v_x=v\cos\phi=${texNum(q.vx)}\,\mathrm{m/s}`,String.raw`v_y=v\sin\phi=${texNum(q.vy)}\,\mathrm{m/s}`,
  String.raw`m a_x=F_{Dx}+F_{Lx}`,String.raw`\small(${texNum(p.mass)}\,\mathrm{kg})(${texNum(q.ax)}\,\mathrm{m/s^2})=${texNum(g.forces.drag.x)}\,\mathrm{N}+${texNum(g.forces.lift.x)}\,\mathrm{N}`,
  String.raw`m a_y=-mg+F_{Dy}+F_{Ly}`,String.raw`a_y=${texNum(q.ay)}\,\mathrm{m/s^2}`,
 ];},
 closeupEquation(f){const p=f.params,q=f.sample,g=f.geometry;
  if(f.closeup==='angle')return [String.raw`v_{0x}=v_0\cos\theta`,String.raw`(${texNum(p.speed)}\,\mathrm{m/s})\cos(${texNum(p.angle)}^\circ)=${texNum(p.speed*Math.cos(p.angle*rad))}\,\mathrm{m/s}`,String.raw`v_{0y}=v_0\sin\theta`,String.raw`(${texNum(p.speed)}\,\mathrm{m/s})\sin(${texNum(p.angle)}^\circ)=${texNum(p.speed*Math.sin(p.angle*rad))}\,\mathrm{m/s}`];
  if(f.closeup==='apex')return [String.raw`v_y=0\,\mathrm{m/s}`,String.raw`y_{\max}=${texNum(preview(p).apex.apex)}\,\mathrm{m}`,String.raw`v_x\ne0\ \text{in general}`];
  return [p.drag==='vacuum'?'F_D=0':p.drag==='linear'?String.raw`\mathbf F_D=-b\mathbf u`:p.drag==='combined'?String.raw`\mathbf F_D=-b\mathbf u-\frac12\rho C_D A|\mathbf u|\mathbf u`:String.raw`\mathbf F_D=-\frac12\rho C_D A|\mathbf u|\mathbf u`,String.raw`F_{Dx}=${texNum(g.forces.drag.x)}\,\mathrm{N}`,String.raw`F_{Dy}=${texNum(g.forces.drag.y)}\,\mathrm{N}`,String.raw`mg=${texNum(p.mass*p.gravity)}\,\mathrm{N}`];
 },
};
