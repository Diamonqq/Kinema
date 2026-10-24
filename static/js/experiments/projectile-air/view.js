import {model} from './model.js';
const blue='#8ab9ff',green='#b0c9ad',orange='#e9bb88',purple='#bcabef',muted='#8c9cb2';
const cache=new Map(),rad=Math.PI/180;
const fmt=n=>Number(n.toPrecision(3)).toString().replace('-', '\u2212');
export const closeups=[{id:'angle',label:'Zoom · launch'},{id:'air-force',label:'Zoom · ball & air'},{id:'apex',label:'Zoom · apex'}];
export const graphs=[
 {id:'motion',label:'Position',unit:'m',series:[{key:'x',label:'x',color:blue},{key:'y',label:'y',color:green}]},
 {id:'velocity',label:'Velocity',unit:'m/s',series:[{key:'vx',label:'vx',color:blue},{key:'vy',label:'vy',color:green}]},
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
 const result={path,ghost,apex,bounds:[xmin-pad,xmax+pad,-pad,ymax+pad]};
 if(cache.size>30)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}
export function mapWorld(stage,bounds,top=50,bottom=stage.h-150,padding=stage.w<440?12:72){
 const [a,b,c,d]=bounds,w=stage.w,h=Math.max(30,bottom-top),target={cx:(a+b)/2,cy:(c+d)/2,scale:Math.min((w-2*padding)/(b-a),h/(d-c))};
 if(!stage.camera||stage.snap)stage.camera={...target};else for(const k of ['cx','cy','scale'])stage.camera[k]+=(target[k]-stage.camera[k])*.22;
 stage.snap=false;const cam=stage.camera;
 return {x:q=>w/2+(q-cam.cx)*cam.scale,y:q=>(top+bottom)/2-(q-cam.cy)*cam.scale,scale:cam.scale};
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
function vector(s,x,y,dx,dy,label,color,scale=1,labelOffset){
 if(Math.hypot(dx,dy)<1e-7)return;
 const tx=x+dx*scale,ty=y-dy*scale;s.arrow(x,y,tx,ty,color,2);
 const c=s.ctx;c.font='12px system-ui,sans-serif';const width=c.measureText(label).width||label.length*6;
 const baseX=tx+(dx>0?12:dx<0?-12:0),baseY=ty+(labelOffset??(dy>=0?-15:16));
 const clear=(px,py)=>{
  if(py<10||py>s.h-15)return false;
  const rect={x:px-width/2-4,y:py-9,width:width+8,height:18};
  if([...(s.labels||[]),...(s.vectorObstacles||[])].some(a=>rect.x<a.x+a.width&&rect.x+rect.width>a.x&&rect.y<a.y+a.height&&rect.y+rect.height>a.y))return false;
  // A vertical downward force keeps its label beyond the tip, never on its shaft.
  if(dy<0&&Math.abs(dx)<1e-9&&py<ty+12)return false;
  if(segmentHitsRect(x,y,tx,ty,rect))return false;
  return !(s.vectorChips||[]).some(a=>segmentHitsRect(tx,ty,px,py,a));
 };
 let selected;
 outer:for(const oy of [0,18,-18,36,-36,54,-54,72,-72,90,-90])for(const ox of [0,32,-32,60,-60,90,-90]){
  const px=Math.max(width/2+7,Math.min(s.w-width/2-7,baseX+ox)),py=baseY+oy;
  if(clear(px,py)){selected={px,py};break outer;}
 }
 const {px,py}=selected||{px:Math.max(width/2+7,Math.min(s.w-width/2-7,baseX)),py:Math.max(10,Math.min(s.h-15,baseY))};
 if(Math.hypot(px-tx,py-ty)>27)s.line(tx,ty,px,py,color+'80',.8);s.text(label,px,py,color,12);
}
function triangle(s,f,live=false){
 const p=f.params,q=f.sample,top=55,bottom=s.h-62,cx=s.w*.3,cy=(top+bottom)/2+15;
 const vx=live?q.vx:p.speed*Math.cos(p.angle*rad),vy=live?q.vy:p.speed*Math.sin(p.angle*rad),v=Math.hypot(vx,vy);
 const length=Math.min(s.w*.43,(bottom-top)*.58),scale=length/Math.max(1,v),x2=cx+vx*scale,y2=cy-vy*scale;
 s.line(cx,cy,cx+length+10,cy,'#455164',1);s.circle(cx,cy,6,blue);
 s.ctx.setLineDash([3,5]);s.line(x2,cy,x2,y2,green,1);s.ctx.setLineDash([]);
 vector(s,cx,cy,vx,0,live?'v cos φ':'v₀ cos θ',blue,scale);
 vector(s,x2,cy,0,vy,live?'v sin φ':'v₀ sin θ',green,scale);
 s.arrow(cx,cy,x2,y2,purple,2);s.text(live?'v':'v₀',(cx+x2)/2-9,(cy+y2)/2-13,purple,12);
 const a=Math.atan2(vy,vx);s.ctx.beginPath();s.ctx.arc(cx,cy,26,Math.min(0,-a),Math.max(0,-a));s.ctx.strokeStyle=muted;s.ctx.stroke();
 s.text(live?'φ':'θ',cx+36*Math.cos(a/2),cy-36*Math.sin(a/2),muted,13);
 s.text(live?'Velocity components now':'Launch components',s.w/2,42,muted,12);
 s.text(`${fmt(vx)} m/s horizontal`,s.w/2,s.h-76,blue,12);s.text(`${fmt(vy)} m/s vertical`,s.w/2,s.h-53,green,12);
}
function forceBall(s,f){
 const q=f.sample,g=f.geometry,cx=s.w/2,cy=s.h*.37,r=Math.min(24,s.w*.07),len=Math.min(s.w*.32,s.h*.27);
 s.circle(cx,cy,r,blue+'18');s.ctx.strokeStyle=blue;s.ctx.lineWidth=1.5;s.ctx.beginPath();s.ctx.arc(cx,cy,r,0,Math.PI*2);s.ctx.stroke();
 const forces=g.forces,maxF=Math.max(.001,...Object.values(forces).map(v=>Math.hypot(v.x,v.y))),scale=len/maxF;
 // Forces and air-relative velocity share the ball origin. Force vectors
 // use one common scale; the ball locator is smaller than the drag arrow.
 vector(s,cx,cy,0,forces.gravity.y,'mg',orange,scale);
 vector(s,cx,cy,forces.drag.x,forces.drag.y,'Fᴅ',green,scale);
 vector(s,cx,cy,forces.lift.x,forces.lift.y,'Fʟ',purple,scale);
 const vy=cy,vx=cx,u={x:q.vx-f.params.wind,y:q.vy},uScale=Math.min(s.w*.19,55)/Math.max(1,Math.hypot(u.x,u.y));
 vector(s,vx,vy,u.x,u.y,'u',blue,uScale);
 s.text('Air-relative velocity u = v − wind',s.w/2,s.h-80,muted,11);
 s.text(`vx ${fmt(q.vx)} · vy ${fmt(q.vy)} m/s`,s.w/2,s.h-57,blue,12);
 s.text('Drag opposes u; gravity points down',s.w/2,s.h-35,muted,s.w<340?10:12);
}
export const view={graphs,closeups,
 mount(shell){shell.q('.exp-transport').style.background='#191e26';shell.equations.style.paddingBottom='64px';shell.scene.style.minHeight='440px';},
 closeupAnchors(s,f){if(f.closeup)return {};const data=preview(f.params),m=mapWorld(s,data.bounds),q=data.path[Math.min(data.path.length-1,Math.max(1,Math.floor(data.path.length*.2)))];return {angle:{x:m.x(0)+(s.w<440?0:(f.breakdown?0:-70)),y:m.y(f.params.height)+(s.w<440?-85:(f.breakdown?65:-40))},'air-force':{x:m.x((data.ghost[0].x+data.ghost.at(-1).x)/2),y:m.y(0)+14},apex:{x:m.x(data.apex.x),y:Math.max(35,m.y(data.apex.y)-120)}};},
 key:f=>f.closeup==='air-force'?['Blue: u',...(Math.hypot(f.geometry.forces.drag.x,f.geometry.forces.drag.y)>1e-7?['Green: drag']:[]),'Amber: gravity',...(Math.hypot(f.geometry.forces.lift.x,f.geometry.forces.lift.y)>1e-7?['Violet: lift']:[])].join(' \u00b7 '):f.closeup?'Angles measured from horizontal':'Blue: projectile \u00b7 dashed: vacuum',
 draw(s,f){
  s.vectorObstacles=[];s.vectorChips=[];const data=preview(f.params);
  if(f.closeup){
   // A normalized world supplies the shared animated camera transition, while
   // magnified vector diagrams keep fixed readable screen-space caption bands.
   if(f.closeup!=='apex')mapWorld(s,[-1,1,-1,1],45,s.h-65);
   if(f.closeup==='angle')triangle(s,f);
   else if(f.closeup==='air-force')forceBall(s,f);
   else{const apex=data.apex,map=mapWorld(s,[apex.x-10,apex.x+10,apex.y-4,apex.y+4],65,s.h-75);path(s,data.path,map,blue);s.circle(map.x(apex.x),map.y(apex.y),5,blue);vector(s,map.x(apex.x),map.y(apex.y),apex.vx,0,'vx',blue,Math.min(70,s.w*.22)/Math.max(1,Math.abs(apex.vx)));vector(s,map.x(apex.x),map.y(apex.y),0,-1,'mg',orange,38);s.text('At the top: vy = 0, but gravity remains',s.w/2,48,muted,s.w<340?10:12);}
   return;
  }
  const m=mapWorld(s,data.bounds,f.thumbnail?12:50,f.thumbnail?s.h-12:s.h-150,f.thumbnail?22:(s.w<440?12:72)),p=f.geometry.position;
  s.line(m.x(data.bounds[0]),m.y(0),m.x(data.bounds[1]),m.y(0),'#465669',1);
  path(s,data.ghost,m,'#8c9cb250',true);path(s,data.path,m,blue+'aa');path(s,data.path.filter(q=>q.t<=f.t+.001),m,blue);
  // Actual diameter is preserved; the luminous halo is an explicit locator.
  const r=f.geometry.radius*m.scale;s.circle(m.x(p.x),m.y(p.y),Math.max(5,r+4),blue+'25');s.circle(m.x(p.x),m.y(p.y),Math.max(.6,r),blue);
  if(!f.thumbnail)s.text(f.sample.landed?`Landed · ${fmt(f.sample.range)} m`:`Height ${fmt(f.sample.y)} m`,s.w-12,29,muted,11,'right');
  if(f.breakdown){
   const widths={angle:93,'air-force':105,apex:84};
   s.vectorObstacles=Object.entries(view.closeupAnchors(s,f)).map(([id,a])=>{const w=widths[id];return {x:Math.max(w/2+8,Math.min(s.w-w/2-8,a.x))-w/2,y:Math.min(s.h-40,a.y),width:w,height:32};});
   s.vectorChips=[...s.vectorObstacles];
   for(const q of data.path)s.vectorObstacles.push({x:m.x(q.x)-1,y:m.y(q.y)-1,width:2,height:2});
   for(let x=0;x<s.w;x+=6)s.vectorObstacles.push({x,y:m.y(0)-1,width:6,height:2});
   const len=Math.min(48,s.w*.11),v=f.geometry.velocity,vscale=len/Math.max(1,Math.hypot(v.x,v.y));
   if(s.w<440)vector(s,m.x(p.x),m.y(p.y),v.x,v.y,'v',blue,vscale);else{vector(s,m.x(p.x),m.y(p.y),v.x,0,'vx',blue,vscale);vector(s,m.x(p.x),m.y(p.y),0,v.y,'vy',green,vscale);}
   const a=f.params.angle*rad,l=Math.min(34,s.w*.09),lx=m.x(0),ly=m.y(f.params.height);s.arrow(lx,ly,lx+l*Math.cos(a),ly-l*Math.sin(a),purple,1.5);
   if(f.t>.2&&s.w>=440){vector(s,lx,ly,l*Math.cos(a),0,'v₀x',blue,1,-15);vector(s,lx,ly,0,l*Math.sin(a),'v₀y',green);}
   // Force vectors on the moving ball; labels use fixed caption rows below.
   const fs=f.geometry.forces,max=Math.max(.001,...Object.values(fs).map(q=>Math.hypot(q.x,q.y))),k=34/max;
   if(!f.sample.landed)for(const [name,c,term] of [['gravity',orange,'mg'],['drag',green,'Fᴅ'],['lift',purple,'Fʟ']]){const q=fs[name];vector(s,m.x(p.x),m.y(p.y),q.x,q.y,term,c,k,s.w<440&&name==='drag'?-24:undefined);}
  }
 },
 equations(f){const p=f.params,q=f.sample,g=f.geometry,theta=p.angle*rad;return [
  String.raw`v_{0x}=v_0\cos\theta`,String.raw`${p.speed}\cos(${p.angle}^\circ)=${fmt(p.speed*Math.cos(theta))}\,\mathrm{m/s}`,
  String.raw`v_{0y}=v_0\sin\theta`,String.raw`${p.speed}\sin(${p.angle}^\circ)=${fmt(p.speed*Math.sin(theta))}\,\mathrm{m/s}`,
  String.raw`v_x=v\cos\phi=${fmt(q.vx)}\,\mathrm{m/s}`,String.raw`v_y=v\sin\phi=${fmt(q.vy)}\,\mathrm{m/s}`,
  String.raw`m a_x=F_{Dx}+F_{Lx}`,String.raw`${p.mass}(${fmt(q.ax)})=${fmt(g.forces.drag.x)}+${fmt(g.forces.lift.x)}\,\mathrm{N}`,
  String.raw`m a_y=-mg+F_{Dy}+F_{Ly}`,String.raw`a_y=${fmt(q.ay)}\,\mathrm{m/s^2}`,
 ];},
 closeupEquation(f){const p=f.params,q=f.sample,g=f.geometry;
  if(f.closeup==='angle')return [String.raw`v_{0x}=v_0\cos\theta`,String.raw`${p.speed}\cos(${p.angle}^\circ)=${fmt(p.speed*Math.cos(p.angle*rad))}\,\mathrm{m/s}`,String.raw`v_{0y}=v_0\sin\theta`,String.raw`${p.speed}\sin(${p.angle}^\circ)=${fmt(p.speed*Math.sin(p.angle*rad))}\,\mathrm{m/s}`];
  if(f.closeup==='apex')return ['v_y=0',String.raw`y_{\max}=${fmt(preview(p).apex.apex)}\,\mathrm{m}`,String.raw`v_x\ne0\ \text{in general}`];
  return [p.drag==='vacuum'?'F_D=0':p.drag==='linear'?String.raw`\mathbf F_D=-b\mathbf u`:p.drag==='combined'?String.raw`\mathbf F_D=-b\mathbf u-\frac12\rho C_D A|\mathbf u|\mathbf u`:String.raw`\mathbf F_D=-\frac12\rho C_D A|\mathbf u|\mathbf u`,String.raw`F_{Dx}=${fmt(g.forces.drag.x)}\,\mathrm{N}`,String.raw`F_{Dy}=${fmt(g.forces.drag.y)}\,\mathrm{N}`,String.raw`mg=${fmt(p.mass*p.gravity)}\,\mathrm{N}`];
 },
};
