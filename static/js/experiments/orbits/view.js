import {model,G} from './model.js';
import {C,fmt,tex,camera,linePath,boundsFor,forecast,chipAnchors,title,vector,plot,label} from './scene.js';
export const graphs=[
 {id:'radius',label:'Separation',unit:'m',series:[{key:'r',label:'r',color:C.blue}]},
 {id:'energy',label:'Energy · K, U, E (J)',unit:'J',kind:'custom',series:[{key:'energy',label:'E',color:C.amber},{key:'kinetic',label:'K',color:C.blue},{key:'potential',label:'U',color:C.green}]},
 {id:'area',label:'Swept area',unit:'m²',series:[{key:'sweptArea',label:'A',color:C.blue}]},
 {id:'phase',label:'Radial phase space',unit:'m · m/s',kind:'phase',series:[{key:'r',label:'r'},{key:'radialSpeed',label:'dr/dt'}]},
 {id:'sightline',label:'Apparent angular velocity',unit:'rad/s',series:[{key:'lineOfSightRate',label:'dφ/dt',color:C.blue}]},
 {id:'potential',label:'Effective potential · r (m), U (J)',kind:'custom'},
 {id:'poincare',label:'Poincaré · x* (m), vx* (m/s)',kind:'custom'},
];
export const closeups=[{id:'periapsis',label:'Zoom · r & v'},{id:'area',label:'Zoom · areas'},
 {id:'barycentre',label:'Zoom · CM'},{id:'potential',label:'Zoom · potential'},{id:'poincare',label:'Zoom · Poincaré'}];
export function values(f){const r=f.geometry.relativeInertial||f.geometry.relative,q=f.sample,vr=(r.x*r.vx+r.y*r.vy)/q.r,vt=(r.x*r.vy-r.y*r.vx)/q.r;
 return {vr,vt,force:Math.hypot(f.geometry.force.x,f.geometry.force.y),mu:G*f.params.gravityScale*(f.params.m1+f.params.m2)};}
function caption(s,text){s.text(text,s.w/2,s.h-43,C.muted,12);}
export function orbitBounds(rows,params,frame){
 let bounds=boundsFor(rows,frame);const q=rows[0].sample;
 if(q.bodyCount===2&&q.bound&&q.apoapsis>0&&!params.thrustAlong&&!params.thrustNormal&&['cm','primary'].includes(frame)){
  const b=rows[0].geometry.bodies,total=b[0].mass+b[1].mass,extent=q.apoapsis*(frame==='primary'?1:Math.max(b[0].mass,b[1].mass)/total)*1.08+.5;
  bounds=[-extent,extent,-extent,extent];
 }return bounds;
}
function decomposition(s,f){
 title(s,'Gravity bends the velocity');const {vr,vt,force}=values(f),w=s.w,h=s.h;
 const left=w*.17,right=w*.66,cy=h*.57,unit=Math.min(20,(w*.18)/Math.max(1,Math.abs(vr),Math.abs(vt)));
 s.line(left,cy,right,cy,C.grid,1);s.circle(left,cy,8,C.pale);s.circle(right,cy,6,C.blue);
 vector(s,left,cy+58,right-left,0,C.muted,'r');
 vector(s,right,cy,-Math.min(70,w*.2),0,C.green,'Fᵣ');
 vector(s,right,cy,vr*unit,-vt*unit,C.blue,'v');
 vector(s,right,cy+32,vr*unit,0,C.amber,'vᵣ');
 vector(s,right+26,cy,0,-vt*unit,C.purple,'vₜ');
 const angle=Math.atan2(-vt,vr);if(Math.abs(vr)+Math.abs(vt)>.01){s.ctx.beginPath();s.ctx.arc(right,cy,23,Math.min(0,angle),Math.max(0,angle));s.ctx.strokeStyle=C.muted;s.ctx.stroke();label(s,'φ',right+35,cy-14,C.muted);}
 caption(s,'Local r-axis → · tangent ↑');
}
export function equalTimeSectors(rows,period=12){
 const count=Math.min(8,rows.length-1),interval=rows[1]?.t-rows[0]?.t||.1;
 const second=Math.max(0,Math.min(rows.length-count-1,Math.round(period*.48/interval)));
 return [rows.slice(0,count+1),rows.slice(second,second+count+1)];
}
function sectors(s,f,data,map){
 if(!data.done||data.rows.length<4)return;
 const bands=equalTimeSectors(data.rows,f.sample.period||12);
 for(const [i,points] of bands.entries()){
  const color=i?C.amber:C.blue;if(points.length<2)continue;
  const a=f.geometry.bodies[0];s.ctx.beginPath();s.ctx.moveTo(map.x(a.x),map.y(a.y));
  const current=f.geometry.relativeInertial||f.geometry.relative,shown=f.geometry.relative,
   theta=Math.atan2(current.y,current.x)-Math.atan2(shown.y,shown.x),cos=Math.cos(theta),sin=Math.sin(theta);
  for(const p of points){const r=p.geometry.relativeInertial||p.geometry.relative;s.ctx.lineTo(map.x(a.x+cos*r.x+sin*r.y),map.y(a.y-sin*r.x+cos*r.y));}
  s.ctx.closePath();s.ctx.fillStyle=color+'35';s.ctx.fill();s.ctx.strokeStyle=color+'80';s.ctx.stroke();
 }
}
export const view={graphs,closeups,
 paramVisible(d,p){const k=d.key,custom=p.system==='custom-nbody',binary=p.system==='two-body'||custom;
  const extra=k.match(/^(m|x|y|vx|vy)([3-5])$/);if(extra)return custom&&Number(extra[2])<=p.bodyCount;
  if(k==='bodyCount')return custom;if(['m1','m2','r0','launch'].includes(k))return binary;
  if(['vx0','vy0'].includes(k))return binary&&p.launch==='custom';if(k==='targetRadius')return binary&&p.launch==='transfer';
  if(['burnStart','burnDuration','thrustBody','thrustFrame'].includes(k))return !!(p.thrustAlong||p.thrustNormal);
  if(k==='replicaSpread')return p.replicas>0;if(['boostX','boostY'].includes(k))return p.frame==='universe';return true;},
 drawGraph(s,d,f){s.text(d.label,s.w/2,13,C.pale,s.w<380?10:12);
  if(d.id==='energy'){
   const rows=f.samples||[],values=rows.flatMap(p=>[p.energy,p.kinetic,p.potential]),lo=Math.min(0,...values),hi=Math.max(1,...values),span=hi-lo,left=76,right=s.w-28,top=32,bottom=s.h-32,end=rows.at(-1)?.t||1,
    map={x:t=>left+(right-left)*t/end,y:e=>bottom-(bottom-top)*(e-lo)/span};
   s.line(left,top,left,bottom,C.grid);s.line(left,bottom,right,bottom,C.grid);
   s.text(fmt(hi),left-5,top,C.muted,10,'right');s.text(fmt(lo),left-5,bottom,C.muted,10,'right');
   for(const v of d.series)linePath(s,rows.map(p=>({x:p.t,y:p[v.key]})),map,v.color,1.5);
   if(f.t<=end)s.line(map.x(f.t),top,map.x(f.t),bottom,C.pale,1);
   s.text('0 s',left,bottom+16,C.muted,10);s.text(fmt(end)+' s',right,bottom+16,C.muted,10,'right');return;
  }
  if(d.id==='poincare'){plot(s,f.geometry.poincare||[],{xkey:'x',ykey:'vx',scatter:true});return;}
  const p=f.geometry.effectivePotential;if(p.available===false){s.text('No exact N-body radial reduction',s.w/2,s.h/2,C.muted,11);return;}
  plot(s,p.points,{xkey:'r',ykey:'potential',energy:p.energy,cursor:{x:p.r}});
 },
 closeupAnchors:s=>chipAnchors(s,closeups.map(c=>c.id)),
 key:f=>f.closeup==='poincare'?'Rotating frame · upward y = 0 crossings':f.closeup==='potential'?'Radial potential · amber E · white current radius':
  f.closeup==='area'?'Relative orbit · equal time intervals':f.closeup==='periapsis'?'Blue v · amber radial · violet tangent · green gravity':
  f.closeup==='barycentre'?'Distances and motion share one physical scale':f.params.frame==='primary'&&f.sample.bodyCount===2?'× primary focus · blue companion · + CM':'Pale primary · blue companion · + CM',
 draw(s,f){
  if(s.h<200){
   const q=f.sample,r=f.geometry.relative,e=q.eccentricity,a=q.semiMajorAxis,mu=G*(f.params.m1+f.params.m2),h=r.x*r.vy-r.y*r.vx,
    ex=r.vy*h/mu-r.x/q.r,ey=-r.vx*h/mu-r.y/q.r,angle=Math.atan2(ey,ex),R=q.apoapsis||q.r*2,
    map=camera(s,[-R*1.1,R*1.1,-R*1.1,R*1.1],8,8);
   if(a>0&&e<1)linePath(s,Array.from({length:181},(_,i)=>{const v=2*Math.PI*i/180,radius=a*(1-e*e)/(1+e*Math.cos(v));return {x:radius*Math.cos(v+angle),y:radius*Math.sin(v+angle)};}),map,C.blue+'70');
   s.circle(map.x(0),map.y(0),5,C.pale);s.circle(map.x(r.x),map.y(r.y),3,C.blue);return;
  }
  const data=forecast(model,f.params),{geometry:g,sample:q}=f;
  if(f.closeup==='periapsis'){decomposition(s,f);return;}
  if(f.closeup==='potential'){
   title(s,'Energy sets the allowed radii');const p=g.effectivePotential;
   if(p.available===false){s.text('N-body motion has no exact radial reduction',s.w/2,s.h/2,C.muted,s.w<380?11:13);return;}
   plot(s,p.points,{xkey:'r',ykey:'potential',energy:p.energy,cursor:{x:p.r},label:'r (m) · Ueff (J)'});return;
  }
  if(f.closeup==='poincare'){
   title(s,'A slice through the rotating motion');const pts=g.poincare||[];
   if(!pts.length){s.text(f.params.system==='two-body'?'Choose Comet encounter in Setup':'Play until an upward crossing',s.w/2,s.h/2,C.muted,12);caption(s,'Only actual crossings at or before the cursor');}
   else plot(s,pts,{xkey:'x',ykey:'vx',scatter:true,label:'x* (m) · vx* (m/s)'});return;
  }
  const analyticEnvelope=q.bodyCount===2&&q.bound&&!f.params.thrustAlong&&!f.params.thrustNormal&&['cm','primary'].includes(f.params.frame);
  if(!data.done&&!analyticEnvelope){s.text(data.error||'Preparing the fixed 60 s motion window…',s.w/2,s.h*.56,C.muted,s.w<380?11:13);return;}
  const frame=f.params.frame,rows=data.rows;
  data.bounds??={};let bounds=data.bounds[frame]??=orbitBounds(rows,f.params,frame);
  if(f.closeup==='barycentre'){
   bounds=data.bounds.cm??=orbitBounds(rows,f.params,'cm');
  }
  if(f.closeup==='area'){
   const radius=Math.max(...rows.map(p=>Math.hypot(p.geometry.relative.x,p.geometry.relative.y)),rows[0].sample.apoapsis||0);bounds=[-radius*1.15,radius*1.15,-radius*1.15,radius*1.15];
  }
  const map=camera(s,bounds,f.closeup?70:(s.w<460?108:78),65);
  if(f.closeup==='barycentre'){
   title(s,'Both bodies orbit their centre of mass');
   const bodies=g.frames.cm||g.bodies;for(let i=0;i<2;i++){const b=bodies[i];s.circle(map.x(b.x),map.y(b.y),i?5:8,i?C.blue:C.pale);}
   s.line(map.x(bodies[0].x),map.y(bodies[0].y),map.x(bodies[1].x),map.y(bodies[1].y),C.grid);
   s.line(map.x(0)-5,map.y(0),map.x(0)+5,map.y(0),C.green);s.line(map.x(0),map.y(0)-5,map.x(0),map.y(0)+5,C.green);
   caption(s,'m₁ r₁ = m₂ r₂');return;
  }
  if(f.closeup==='area'){
   title(s,q.bodyCount>2||f.params.thrustAlong||f.params.thrustNormal?'Compare swept areas · external torque can change them':'Equal times sweep equal areas');
   const origin={x:0,y:0},physical=g.relativeInertial||g.relative,local={...g,relative:physical,bodies:[origin]},localFrame={...f,geometry:local};
   linePath(s,rows.map(p=>p.geometry.relativeInertial||p.geometry.relative),map,C.grid);
   sectors(s,localFrame,data,map);s.circle(map.x(0),map.y(0),7,C.pale);
   s.circle(map.x(physical.x),map.y(physical.y),5,C.blue);caption(s,'Blue and amber sectors use the same Δt');return;
  }
  // A faint whole-window path is a forecast, not falsely represented as history.
  for(let i=0;i<g.bodies.length;i++){
   linePath(s,rows.map(p=>(p.geometry.frames[frame]||p.geometry.bodies)[i]),map,(i?C.blue:C.pale)+'30');
   const past=rows.filter(p=>p.t<=f.t);linePath(s,past.map(p=>(p.geometry.frames[frame]||p.geometry.bodies)[i]),map,(i?C.blue:C.pale)+'a0',1.6);
   const b=g.bodies[i];s.circle(map.x(b.x),map.y(b.y),i===0?7:i===1?5:3,i===0?C.pale:i===1?C.blue:C.amber);
  }
  const a=g.bodies[0],b=g.bodies[1],cx=map.x(g.centreOfMass.x),cy=map.y(g.centreOfMass.y);
  s.line(cx-4,cy,cx+4,cy,C.green);s.line(cx,cy-4,cx,cy+4,C.green);
  s.line(map.x(a.x)-3,map.y(a.y)-3,map.x(a.x)+3,map.y(a.y)+3,'#141a24');
  s.line(map.x(a.x)-3,map.y(a.y)+3,map.x(a.x)+3,map.y(a.y)-3,'#141a24');
  if(f.breakdown){
   sectors(s,f,data,map);const x=map.x(b.x),y=map.y(b.y),r=g.relative,mag=q.r;
   s.line(map.x(a.x),map.y(a.y),x,y,C.muted,1);label(s,'r',map.x((a.x+b.x)/2),map.y((a.y+b.y)/2)-12,C.muted);
   const factor=Math.min(25,s.w*.16/Math.max(q.speed,1)),v=values(f),nx=r.x/mag,ny=r.y/mag;
   const velocity=f.params.frame==='rotating'?{vx:v.vr,vy:v.vt}:r;
   if(v.force>0)vector(s,x,y,-nx*45,ny*45,C.green,'Fᵣ');vector(s,x,y,velocity.vx*factor,-velocity.vy*factor,C.blue,'v');
   if(s.w>460){vector(s,x,y,v.vr*nx*factor,-v.vr*ny*factor,C.amber,'vᵣ');vector(s,x,y,-v.vt*ny*factor,-v.vt*nx*factor,C.purple,'vₜ');}
  }
  caption(s,q.status!=='running'?'Close encounter · point-mass limit':data.done?'60 s forecast · brighter trail = elapsed':'Preparing paths · fixed full-orbit envelope');
 },
 equations(f){const v=values(f),q=f.sample;return [
  String.raw`F_r=-\frac{Gm_1m_2}{r^2}\left(1+\frac{\alpha}{r}\right)`,
  String.raw`F_r=${tex(-v.force)}\;\mathrm{N}`,
  String.raw`v_r=\mathbf v\cdot\hat{\mathbf r}=${tex(v.vr)}\;\mathrm{m/s}`,
  String.raw`v_t=\frac{\mathbf r\times\mathbf v}{r}=${tex(v.vt)}\;\mathrm{m/s}`,
  String.raw`\dot A=\frac{rv_t}{2}=${tex(q.areaRate)}\;\mathrm{m^2/s}`];},
 closeupEquation(f){const v=values(f),q=f.sample;
  if(f.closeup==='potential')return f.geometry.effectivePotential.available===false?[String.raw`E=\sum_i K_i+\sum_{i<j}U_{ij}`]:[
   String.raw`U_{\rm eff}=U(r)+\frac{L^2}{2\mu_r r^2}`,String.raw`E=${tex(q.energy)}\;\mathrm{J}`,
   String.raw`\tfrac12\mu_r\dot r^2=E-U_{\rm eff}`];
  if(f.closeup==='area')return [String.raw`\Delta A=\tfrac12\int r^2\,d\theta`,String.raw`\dot A=\tfrac12(${tex(q.r)})(${tex(v.vt)})`,String.raw`=${tex(q.areaRate)}\;\mathrm{m^2/s}`];
  if(f.closeup==='barycentre'){const b=f.geometry.frames.cm||f.geometry.bodies;return [String.raw`\sum_i m_i\mathbf r_i=0`,String.raw`r_1=${tex(Math.hypot(b[0].x,b[0].y))}\;\mathrm m`,String.raw`r_2=${tex(Math.hypot(b[1].x,b[1].y))}\;\mathrm m`];}
  if(f.closeup==='poincare')return [String.raw`y^*=0,\quad v_y^*>0`,String.raw`(x^*,v_x^*)\;\text{at crossings}`];
  return this.equations(f).slice(0,4);
 }
};
