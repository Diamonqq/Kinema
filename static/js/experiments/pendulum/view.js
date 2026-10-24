import {model} from './model.js';
import {C,fmt,tex,label,bead,angle,fixedMap,drawAnalysis,linePlot} from '../motion-generator/view-tools.js';
const closeups=[{id:'gravity',label:'Zoom \u00b7 gravity components'}];
const graphs=[
 {id:'motion',label:'Angle',unit:'rad',series:[{key:'theta',label:'theta',color:C.blue}]},
 {id:'phase',label:'Phase space',unit:'rad, rad/s',kind:'custom',series:[{key:'theta',label:'theta'},{key:'omega',label:'omega'}]},
 {id:'energy',label:'Energy',unit:'J',series:[{key:'energy',label:'E',color:C.green},{key:'kinetic',label:'K',color:C.blue},{key:'potential',label:'U',color:C.gold}]},
 {id:'sensitivity',label:'Nearby starts',unit:'rad',series:[{key:'separation',label:'separation',color:C.violet}]},
 {id:'period',label:'Period vs amplitude',kind:'custom'}, {id:'strobe',label:'Poincare section',kind:'custom'}, {id:'return',label:'Velocity return',kind:'custom'}, {id:'spectrum',label:'Spectrum',kind:'custom'},
];
export function decomposition(params,sample){const mg=params.mass*params.gravity,t=sample.theta;return {mg,tangential:-mg*Math.sin(t),radial:mg*Math.cos(t),torque:-mg*params.length*Math.sin(t),er:[Math.sin(t),-Math.cos(t)],et:[Math.cos(t),Math.sin(t)]};}
// Conservative sine motion has a fixed energy envelope; driven and approximate
// laws use the whole rotation circle. Bounds never depend on the current frame.
export function pendulumBounds(p,focus=false){
 const L=p.length;
 const E=1-Math.cos(p.theta0)+L*p.omega0**2/(2*p.gravity);
 if(p.drive||p.linear!=='exact'||E>=2)return focus?[-1.12*L,1.12*L,-1.08*L,1.12*L]:[-1.42*L,1.42*L,-1.45*L,1.15*L];
 const A=Math.acos(1-Math.max(0,E)),width=Math.max(.6,A>=Math.PI/2?1:Math.sin(A));
 return [-width*L,width*L,-1.03*L,Math.max(.12,-Math.cos(A)+.12)*L];
}
// Liang-Barsky segment clipping: labels must clear every force shaft.
export function shaftHits(rect,a,b,pad=4){
 const lo=[rect.x-pad,rect.y-pad],hi=[rect.x+rect.width+pad,rect.y+rect.height+pad];let first=0,last=1;
 for(let i=0;i<2;i++){const d=b[i]-a[i];if(Math.abs(d)<1e-10){if(a[i]<lo[i]||a[i]>hi[i])return false;}else{let u=(lo[i]-a[i])/d,v=(hi[i]-a[i])/d;if(u>v)[u,v]=[v,u];first=Math.max(first,u);last=Math.min(last,v);if(first>last)return false;}}
 return true;
}
export function forceLabels(s,arrows){
 const size=s.w<360?10:12;s.ctx.font=`${size}px system-ui,sans-serif`;
 for(const a of arrows){
  const dx=a.x-a.ax,dy=a.y-a.ay,n=Math.hypot(dx,dy);if(n<2)continue;
  const offsets=[[dx/n*20,dy/n*20],[0,18],[0,-18],[40,18],[-40,18],[45,-18],[-45,-18],[0,34],[60,34],[-60,34],[60,-34],[-60,-34],[0,-45]];
  for(const [ox,oy] of offsets){const x=a.x+ox,y=a.y+oy,width=s.ctx.measureText(a.text).width,rect={x:x-width/2-3,y:y-size*.65,width:width+6,height:size*1.3};
   if(arrows.some(b=>shaftHits(rect,[b.ax,b.ay],[b.x,b.y])))continue;
   if(label(s,a.text,x,y,a.c,size)){if(Math.hypot(ox,oy)>26)s.line(a.x,a.y,x,y-Math.sign(oy)*8,a.c+'80',1);break;}
  }
 }
}
function diagram(s,f,zoom){
 s.forceArrows=[];const {params:p,sample:q}=f,t=q.theta,L=p.length,theta=Math.atan2(Math.sin(t),Math.cos(t));
 const focus=zoom||f.breakdown,m=fixedMap(s,pendulumBounds(p,focus),{top:f.thumbnail?18:focus?34:28,bottom:f.thumbnail?18:focus?190:145,padding:f.thumbnail?22:35}),px=m.x(0),py=m.y(0),bx=m.x(L*Math.sin(t)),by=m.y(-L*Math.cos(t));
 const radius=Math.max(8,Math.min(16,m.scale*L*.09)),body={x:bx-radius-4,y:by-radius-4,width:2*radius+8,height:2*radius+8};s.avoid=[body,{x:0,y:s.h-123,width:s.w,height:123}];
 s.ctx.setLineDash([3,5]);s.line(px,py,px,m.y(-L*1.17),C.grid,1);s.ctx.setLineDash([]);
 s.line(px-19,py-8,px+19,py-8,C.dim,4);s.line(px,py,bx,by,'#98acc5',3);s.circle(px,py,4,C.ink);
 if(p.drive){const z=Math.cos(p.driveOmega*f.t+p.drivePhase);s.line(px-20,py-19,px+20*z,py-19,C.violet,3);}
 bead(s,bx,by,radius);
 if(f.thumbnail)return;
 angle(s,px,py,Math.max(17,Math.min(35,m.scale*L*.25)),theta);
 if(f.breakdown||zoom){
  const d=decomposition(p,q),u=zoom?Math.min(77,s.w*.23):Math.min(64,s.w*.2),ax=bx,ay=by;
  // Gravity's radial projection is OUTWARD; string tension, when present,
  // points inward and is a different force. The two components sum to mg.
  const ends=[{x:ax,y:ay+u,text:'mg',c:C.green},{x:ax+d.tangential/d.mg*d.et[0]*u,y:ay-d.tangential/d.mg*d.et[1]*u,text:'-mg sin\u03b8',c:C.blue},{x:ax+d.radial/d.mg*d.er[0]*u,y:ay-d.radial/d.mg*d.er[1]*u,text:'mg cos\u03b8',c:C.gold}];
  s.ctx.setLineDash([3,4]);s.line(bx,by,bx+d.er[0]*u,by-d.er[1]*u,C.dim,1);s.ctx.setLineDash([]);
  angle(s,bx,by,Math.min(21,u*.32),theta);
  s.forceArrows=ends.map(e=>({...e,ax,ay}));for(const e of ends)s.arrow(ax,ay,e.x,e.y,e.c,2.2);forceLabels(s,s.forceArrows);
  label(s,'along rod / tangent',s.w/2,zoom?49:23,C.dim,11);
 }
 s.avoid=[body];label(s,'\u03b8 '+fmt(q.theta)+' rad   \u03c9 '+fmt(q.omega)+' rad/s',s.w/2,s.h-106,C.blue,11);
}
export const view={graphs,closeups,
 key:f=>f.closeup?'Gravity \u2192 radial + tangential':f.params.linear==='exact'?'Rigid rod \u00b7 exact sine torque':f.params.linear==='linear'?'Small-angle approximation':'Cubic sine approximation',
 closeupAnchors:s=>({gravity:{x:s.w/2,y:s.h-74}}),
 draw(s,f){diagram(s,f,!!f.closeup);},
 drawGraph(s,d,f){if(d.id==='phase'){linePlot(s,{title:'Phase space',points:f.samples,xkey:'theta',ykey:'omega',cursor:f.sample,xlabel:'theta / rad',ylabel:'omega / (rad/s)',color:C.blue});return;}drawAnalysis(s,d,f,{position:'theta',velocity:'omega',periodPoint(frame,i){const x=.02+(Math.PI-.12)*i/31,instance=model.create({...frame.params,theta0:x,omega0:0,drive:0,damping:0});return {x,y:instance.period()};}});},
 equations(f){const p=f.params,q=f.sample,d=decomposition(p,q),tau=p.linear==='linear'?String.raw`-mgL\theta`:p.linear==='cubic'?String.raw`-mgL(\theta-\theta^3/6)`:String.raw`-mgL\sin\theta`;return [String.raw`F_t=-mg\sin\theta`,String.raw`=-(${p.mass})(${p.gravity})\sin(${tex(q.theta)})`,String.raw`=${tex(d.tangential)}\,\mathrm N`,String.raw`F_r=mg\cos\theta=${tex(d.radial)}\,\mathrm N`,String.raw`\tau_g=-mgL\sin\theta`,String.raw`=-(${p.mass})(${p.gravity})(${p.length})\sin(${tex(q.theta)})`,String.raw`=${tex(d.torque)}\,\mathrm{N\,m}`,String.raw`\tau_{\rm model}=${tau}`,String.raw`mL^2\ddot\theta=\tau_{\rm model}-b\omega+\tau_{\rm drive}`,String.raw`\tau_{\rm drive}=\tau_d\cos(\Omega t+\phi)`];},
 closeupEquation(f){const p=f.params,q=f.sample,d=decomposition(p,q);return [String.raw`\tau_g=-mgL\sin\theta`,String.raw`=-(${p.mass})(${p.gravity})(${p.length})\sin(${tex(q.theta)})`,String.raw`=${tex(d.torque)}\,\mathrm{N\,m}`];},
};
