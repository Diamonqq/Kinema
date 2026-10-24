import {model} from './model.js';
import {C,fmt,tex,label,tip,bead,angle,fixedMap,drawAnalysis,linePlot} from '../motion-generator/view-tools.js';
const closeups=[{id:'gravity',label:'Zoom \u00b7 gravity components'}];
const graphs=[
 {id:'motion',label:'Angle',unit:'rad',series:[{key:'theta',label:'theta',color:C.blue}]},
 {id:'phase',label:'Phase space',unit:'rad, rad/s',kind:'custom',series:[{key:'theta',label:'theta'},{key:'omega',label:'omega'}]},
 {id:'energy',label:'Energy',unit:'J',series:[{key:'energy',label:'E',color:C.green},{key:'kinetic',label:'K',color:C.blue},{key:'potential',label:'U',color:C.gold}]},
 {id:'sensitivity',label:'Nearby starts',unit:'rad',series:[{key:'separation',label:'separation',color:C.violet}]},
 {id:'period',label:'Period vs amplitude',kind:'custom'}, {id:'strobe',label:'Poincare section',kind:'custom'}, {id:'return',label:'Velocity return',kind:'custom'}, {id:'spectrum',label:'Spectrum',kind:'custom'},
];
export function decomposition(params,sample){const mg=params.mass*params.gravity,t=sample.theta;return {mg,tangential:-mg*Math.sin(t),radial:mg*Math.cos(t),torque:-mg*params.length*Math.sin(t),er:[Math.sin(t),-Math.cos(t)],et:[Math.cos(t),Math.sin(t)]};}
function diagram(s,f,zoom){
 const {params:p,sample:q}=f,t=q.theta,L=p.length,theta=Math.atan2(Math.sin(t),Math.cos(t));
 const m=fixedMap(s,zoom?[-1.12*L,1.12*L,-1.35*L,.95*L]:[-1.42*L,1.42*L,-1.45*L,1.15*L],{top:zoom?57:28,bottom:zoom?190:f.breakdown?170:106,padding:35}),px=m.x(0),py=m.y(0),bx=m.x(L*Math.sin(t)),by=m.y(-L*Math.cos(t));
 const radius=Math.max(8,Math.min(16,m.scale*L*.09)),body={x:bx-radius-4,y:by-radius-4,width:2*radius+8,height:2*radius+8};s.avoid=[body,{x:0,y:s.h-123,width:s.w,height:123}];
 s.ctx.setLineDash([3,5]);s.line(px,py,px,m.y(-L*1.17),C.grid,1);s.ctx.setLineDash([]);
 s.line(px-19,py-8,px+19,py-8,C.dim,4);s.line(px,py,bx,by,'#98acc5',3);s.circle(px,py,4,C.ink);
 if(p.drive){const z=Math.cos(p.driveOmega*f.t+p.drivePhase);s.line(px-20,py-19,px+20*z,py-19,C.violet,3);}
 bead(s,bx,by,radius);
 angle(s,px,py,Math.max(17,Math.min(35,m.scale*L*.25)),theta);
 if(f.breakdown||zoom){
  const d=decomposition(p,q),u=zoom?Math.min(77,s.w*.23):Math.min(64,s.w*.2),ax=bx,ay=by;
  // Gravity's radial projection is OUTWARD; string tension, when present,
  // points inward and is a different force. The two components sum to mg.
  const ends=[{x:ax,y:ay+u,text:'mg',c:C.green},{x:ax+d.tangential/d.mg*d.et[0]*u,y:ay-d.tangential/d.mg*d.et[1]*u,text:'-mg sin\u03b8',c:C.blue},{x:ax+d.radial/d.mg*d.er[0]*u,y:ay-d.radial/d.mg*d.er[1]*u,text:'mg cos\u03b8',c:C.gold}];
  s.ctx.setLineDash([3,4]);s.line(bx,by,bx+d.er[0]*u,by-d.er[1]*u,C.dim,1);s.ctx.setLineDash([]);
  angle(s,bx,by,Math.min(21,u*.32),theta);
  for(const e of ends){s.arrow(ax,ay,e.x,e.y,e.c,2.2);tip(s,e.text,e.x,e.y,e.c);}
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
