import {model,G} from './model.js';
import {startSection,crossingElapsed} from './section.js';
import {C,fmt,tex,camera,linePath,boundsFor,forecast,chipAnchors,title,vector,plot,label,sectionTick,targetChips,sceneHeight} from './scene.js';
export const ENERGY_UNIT=1e12,FORCE_UNIT=1e11;
export const graphs=[
 {id:'radius',label:'Separation',unit:'m',series:[{key:'r',label:'r',color:C.blue}]},
 {id:'energy',label:'Energy',unit:'E₀ (10¹² J)',kind:'custom',series:[{key:'energy',label:'E',color:C.amber},{key:'kinetic',label:'K',color:C.blue},{key:'potential',label:'U',color:C.green}]},
 {id:'area',label:'Swept area',unit:'m²',series:[{key:'sweptArea',label:'A',color:C.blue}]},
 {id:'phase',label:'Radial phase space',unit:'m · m/s',kind:'phase',series:[{key:'r',label:'r'},{key:'radialSpeed',label:'dr/dt'}]},
 {id:'sightline',label:'Apparent angular velocity',unit:'rad/s',series:[{key:'lineOfSightRate',label:'dφ/dt',color:C.blue}]},
 {id:'potential',label:'Effective potential',unit:'r (m), U/E₀',kind:'custom'},
 {id:'poincare',label:'Poincaré',unit:'x* (m), vx* (m/s)',kind:'custom'},
];
export const closeups=[{id:'periapsis',label:'Zoom · r & v'},{id:'area',label:'Zoom · areas'},
 {id:'barycentre',label:'Zoom · CM'},{id:'potential',label:'Zoom · potential'},{id:'poincare',label:'Zoom · Poincaré'}];
const shells=new WeakMap(),parameterShells=new WeakMap(),sections=new WeakMap();
const sectionWanted=s=>s.closeup==='poincare'||(!s.q('.exp-graph-panel').hidden&&s.enabledGraphs.has('poincare'));
function longSection(params){
 const shell=parameterShells.get(params);
 let state=sections.get(params);
 if(!state||state.cancelled||state.signal!==shell?.signal){
  state?.cancel?.();
  state=startSection(params,{signal:shell?.signal,invalidate:()=>shell?.invalidate(),onCleanup:shell?.onCleanup?.bind(shell),active:()=>!!shell&&!shell.destroyed&&shell.params===params&&sectionWanted(shell)});
  sections.set(params,state);
 }
 return state;
}
function drawSection(s,f,compact=false){
 if(!compact)title(s,'A slice through the rotating motion');
 if(f.sample.bodyCount<3){s.text('Choose Comet encounter in Setup',s.w/2,s.h/2,C.muted,12);return;}
 const state=longSection(f.params),count=state.points.length;
 if(!state.done){
  s.text('Preparing the long section…',s.w/2,s.h/2,C.muted,compact?11:13);
  if(!compact)caption(s,count+' crossings · integrating to 320 (bounded)');
  return;
 }
 if(state.error){s.text('Section stopped: '+state.error,s.w/2,s.h/2,C.muted,11);return;}
 // Wait for the bounded integration before drawing axes: their final bounds
 // stay fixed while playback moves the bright time selection through the cloud.
 plot(s,state.points,{xkey:'x',ykey:'vx',scatter:true,tickFormat:sectionTick,
  pointColor:p=>crossingElapsed(p)<=f.t?C.blue:C.blue+'45',
  label:count+' crossings · '+Math.round(state.time)+' s integrated'});
}
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
 if(Math.abs(vt)>1e-6)vector(s,right,cy+32,vr*unit,0,C.amber,'vᵣ');
 if(Math.abs(vr)>1e-6)vector(s,right+26,cy,0,-vt*unit,C.purple,'vₜ');
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
 mount(shell){shells.set(shell.stage,shell);},
 graphDescriptors(params){const period=model.create(params).sample().period;return graphs.map(g=>({...g,window:Math.min(60,period>0?5*period:60)}));},
 sectionStatus(params){const s=sections.get(params);return s?{done:s.done,cancelled:s.cancelled,count:s.points.length,time:s.time,error:s.error}:null;},
 paramVisible(d,p){const k=d.key,custom=p.system==='custom-nbody',binary=p.system==='two-body'||custom;
  const extra=k.match(/^(m|x|y|vx|vy)([3-5])$/);if(extra)return custom&&Number(extra[2])<=p.bodyCount;
  if(k==='bodyCount')return custom;if(['m1','m2','r0','launch'].includes(k))return binary;
  if(['vx0','vy0'].includes(k))return binary&&p.launch==='custom';if(k==='targetRadius')return binary&&p.launch==='transfer';
  if(['burnStart','burnDuration','thrustBody','thrustFrame'].includes(k))return !!(p.thrustAlong||p.thrustNormal);
  if(k==='replicaSpread')return p.replicas>0;if(['boostX','boostY'].includes(k))return p.frame==='universe';return true;},
 drawGraph(s,d,f){
  s.chipRects=[];
  if(d.id==='energy'){
   const data=forecast(model,f.params,{signal:f.signal,invalidate:f.invalidate});if(!data.done){s.text('Preparing the energy range',s.w/2,s.h/2,C.muted,11);return;}
   const all=data.rows.map(row=>row.sample),values=all.flatMap(p=>[p.energy/ENERGY_UNIT,p.kinetic/ENERGY_UNIT,p.potential/ENERGY_UNIT]),lo=Math.min(0,...values),hi=Math.max(1e-9,...values),span=hi-lo,left=76,right=s.w-28,top=32,bottom=s.h-32,
    window=Math.min(60,d.window||60),start=Math.max(0,Math.min(60-window,f.t-window*.75)),end=start+window,
    rows=all.filter(p=>p.t>=start&&p.t<=end),map={x:t=>left+(right-left)*(t-start)/window,y:e=>bottom-(bottom-top)*(e-lo)/span};
   s.line(left,top,left,bottom,C.grid);s.line(left,bottom,right,bottom,C.grid);
   s.text(fmt(hi),left-5,top,C.muted,10,'right');s.text(fmt(lo),left-5,bottom,C.muted,10,'right');
   for(const v of d.series)linePath(s,rows.map(p=>({x:p.t,y:p[v.key]/ENERGY_UNIT})),map,v.color,1.5);
   if(f.t<=end)s.line(map.x(f.t),top,map.x(f.t),bottom,C.pale,1);
   s.text(fmt(start)+' s',left,bottom+16,C.muted,10);s.text(fmt(end)+' s',right,bottom+16,C.muted,10,'right');return;
  }
  if(d.id==='poincare'){drawSection(s,f,true);return;}
  const p=f.geometry.effectivePotential;if(p.available===false){s.text('No exact N-body radial reduction',s.w/2,s.h/2,C.muted,11);return;}
  plot(s,p.points.map(row=>({...row,potential:row.potential/ENERGY_UNIT})),{xkey:'r',ykey:'potential',energy:p.energy/ENERGY_UNIT,cursor:{x:p.r}});
 },
 closeupAnchors:s=>s.targetAnchors||{},
 key:f=>f.closeup==='poincare'?'Rotating frame · dim future · bright past':f.closeup==='potential'?'Radial potential · amber E · white current radius':
  f.closeup==='area'?'Relative orbit · equal time intervals':f.closeup==='periapsis'?'Blue v · amber radial · violet tangent · green gravity':
  f.closeup==='barycentre'?'Distances and motion share one physical scale':f.params.frame==='primary'&&f.sample.bodyCount===2?'× primary focus · blue companion · + CM':'Pale primary · blue companion · + CM',
 draw(s,f){
  const shell=shells.get(s);if(shell){parameterShells.set(f.params,shell);sceneHeight(shell,520,!!f.closeup);}
  s.chipRects=[];
  if(s.h<200){
   const q=f.sample,r=f.geometry.relative,e=q.eccentricity,a=q.semiMajorAxis,mu=G*(f.params.m1+f.params.m2),h=r.x*r.vy-r.y*r.vx,
    ex=r.vy*h/mu-r.x/q.r,ey=-r.vx*h/mu-r.y/q.r,angle=Math.atan2(ey,ex),R=q.apoapsis||q.r*2,
    map=camera(s,[-R*1.1,R*1.1,-R*1.1,R*1.1],8,8);
   if(a>0&&e<1)linePath(s,Array.from({length:181},(_,i)=>{const v=2*Math.PI*i/180,radius=a*(1-e*e)/(1+e*Math.cos(v));return {x:radius*Math.cos(v+angle),y:radius*Math.sin(v+angle)};}),map,C.blue+'70');
   s.circle(map.x(0),map.y(0),5,C.pale);s.circle(map.x(r.x),map.y(r.y),3,C.blue);return;
  }
  const data=forecast(model,f.params,{signal:f.signal,invalidate:f.invalidate}),{geometry:g,sample:q}=f;
  if(f.closeup==='periapsis'){decomposition(s,f);return;}
  if(f.closeup==='potential'){
   title(s,'Energy sets the allowed radii');const p=g.effectivePotential;
   if(p.available===false){s.text('N-body motion has no exact radial reduction',s.w/2,s.h/2,C.muted,s.w<380?11:13);return;}
   plot(s,p.points.map(row=>({...row,potential:row.potential/ENERGY_UNIT})),{xkey:'r',ykey:'potential',energy:p.energy/ENERGY_UNIT,cursor:{x:p.r},label:'r (m) · Ueff / E₀'});return;
  }
  if(f.closeup==='poincare'){
   drawSection(s,f);return;
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
  const map=camera(s,bounds,f.closeup?70:85,95);
  if(!f.closeup){
   const first=rows[0].geometry,initial=(first.frames[frame]||first.bodies),focus=initial[0],cm=first.centreOfMass;
   targetChips(s,{periapsis:{x:map.x(initial[1].x),y:map.y(initial[1].y)},barycentre:{x:map.x(cm.x),y:map.y(cm.y),offsets:[[65,28],[-65,-55],[65,-55],[-65,28]]},area:{x:map.x(focus.x),y:map.y(focus.y),offsets:[[-65,65],[-70,-70],[70,70],[-100,10]]}},['potential','poincare'],shell);
  }
  if(f.closeup==='barycentre'){
   title(s,'Both bodies orbit their center of mass');
   const bodies=g.frames.cm||g.bodies;for(let i=0;i<2;i++){const b=bodies[i];s.circle(map.x(b.x),map.y(b.y),i?5:8,i?C.blue:C.pale);}
   s.line(map.x(bodies[0].x),map.y(bodies[0].y),map.x(bodies[1].x),map.y(bodies[1].y),C.grid);
   s.line(map.x(0)-5,map.y(0),map.x(0)+5,map.y(0),C.green);s.line(map.x(0),map.y(0)-5,map.x(0),map.y(0)+5,C.green);
   caption(s,'m₁ r₁ = m₂ r₂');return;
  }
  if(f.closeup==='area'){
   title(s,q.bodyCount>2||f.params.thrustAlong||f.params.thrustNormal?(s.w<460?'Swept areas with external torque':'Compare swept areas · external torque can change them'):'Equal times sweep equal areas');
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
   s.line(map.x(a.x),map.y(a.y),x,y,C.muted,1);label(s,'r',map.x((a.x+b.x)/2)+24*r.y/mag,map.y((a.y+b.y)/2)+24*r.x/mag,C.muted);
   const factor=Math.min(25,s.w*.16/Math.max(q.speed,1)),v=values(f),nx=r.x/mag,ny=r.y/mag;
   const velocity=f.params.frame==='rotating'?{vx:v.vr,vy:v.vt}:r;
   if(v.force>0){s.arrow(x,y,x-nx*45,y+ny*45,C.green,2);label(s,'Fᵣ',x-nx*45-ny*20,y+ny*45-nx*20,C.green);}
   const vx=x+velocity.vx*factor,vy=y-velocity.vy*factor;
   s.arrow(x,y,vx,vy,C.blue,2);label(s,'v',vx+18,vy-22,C.blue);
   if(s.w>460&&Math.abs(v.vr)>1e-6&&Math.abs(v.vt)>1e-6){
    const rx=x+v.vr*nx*factor,ry=y-v.vr*ny*factor,tx=x-v.vt*ny*factor,ty=y-v.vt*nx*factor;
    s.arrow(x,y,rx,ry,C.amber,2);label(s,'vᵣ',rx-ny*22,ry-nx*22,C.amber);
    s.arrow(x,y,tx,ty,C.purple,2);label(s,'vₜ',tx-22,ty+18,C.purple);
   }
  }
  s.text('Scaled masses · M₀ = 10¹² kg',s.w/2,s.h-66,C.muted,11);
  caption(s,q.status!=='running'?'Close encounter · point-mass limit':data.done?'60 s forecast · brighter trail = elapsed':'Preparing paths · fixed full-orbit envelope');
 },
 equations(f){const v=values(f),q=f.sample;return [
  String.raw`F_r=-\frac{Gm_1m_2}{r^2}\left(1+\frac{\alpha}{r}\right)`,
  String.raw`F_r=${tex(-v.force/FORCE_UNIT)}\,F_0`,
  String.raw`F_0=10^{11}\;\mathrm N`,
  String.raw`v_r=\mathbf v\cdot\hat{\mathbf r}=${tex(v.vr)}\;\mathrm{m/s}`,
  String.raw`v_t=\frac{\mathbf r\times\mathbf v}{r}=${tex(v.vt)}\;\mathrm{m/s}`,
  String.raw`\dot A=\frac{rv_t}{2}=${tex(q.areaRate)}\;\mathrm{m^2/s}`];},
 closeupEquation(f){const v=values(f),q=f.sample;
  if(f.closeup==='potential')return f.geometry.effectivePotential.available===false?[String.raw`E=\sum_i K_i+\sum_{i<j}U_{ij}`]:[
   String.raw`U_{\rm eff}=U(r)+\frac{L^2}{2\mu_r r^2}`,String.raw`E=${tex(q.energy/ENERGY_UNIT)}\,E_0`,String.raw`E_0=10^{12}\;\mathrm J`,
   String.raw`\tfrac12\mu_r\dot r^2=E-U_{\rm eff}`];
  if(f.closeup==='area')return [String.raw`\Delta A=\tfrac12\int r^2\,d\theta`,String.raw`\dot A=\tfrac12(${tex(q.r)})(${tex(v.vt)})`,String.raw`=${tex(q.areaRate)}\;\mathrm{m^2/s}`];
  if(f.closeup==='barycentre'){const b=f.geometry.frames.cm||f.geometry.bodies;return [String.raw`\sum_i m_i\mathbf r_i=0`,String.raw`r_1=${tex(Math.hypot(b[0].x,b[0].y))}\;\mathrm m`,String.raw`r_2=${tex(Math.hypot(b[1].x,b[1].y))}\;\mathrm m`];}
  if(f.closeup==='poincare')return [String.raw`y^*=0,\quad v_y^*>0`,String.raw`(x^*,v_x^*)\;\text{at crossings}`];
  return this.equations(f).slice(0,4);
 }
};
