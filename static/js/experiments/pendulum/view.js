import {model,exactPeriod} from './model.js';
import {C,fmt,tex,label,bead,angle,fixedMap,drawAnalysis,linePlot} from '../motion-generator/view-tools.js';
const closeups=[{id:'gravity',label:'Zoom \u00b7 gravity components'}];
const graphs=[
 {id:'motion',label:'Angle',unit:'rad',series:[{key:'theta',label:'\u03b8',color:C.blue}]},
 {id:'phase',label:'Phase space',unit:'rad, rad/s',kind:'custom',series:[{key:'theta',label:'\u03b8'},{key:'omega',label:'\u03c9'}]},
 {id:'energy',label:'Energy',unit:'J',series:[{key:'energy',label:'E',color:C.green},{key:'kinetic',label:'K',color:C.blue},{key:'potential',label:'U',color:C.gold}]},
 {id:'sensitivity',label:'Nearby starts',unit:'rad',series:[{key:'separation',label:'separation',color:C.violet}]},
 {id:'period',label:'Period vs amplitude',kind:'custom'}, {id:'strobe',label:'Poincar\u00e9 section',kind:'custom'}, {id:'return',label:'Velocity return',kind:'custom'}, {id:'spectrum',label:'Spectrum',kind:'custom'},
];
graphs.forEach(g=>{if(!g.kind)g.window=5*exactPeriod(.3);});
export function decomposition(params,sample){const mg=params.mass*params.gravity,t=sample.theta;return {mg,tangential:-mg*Math.sin(t),radial:mg*Math.cos(t),torque:-mg*params.length*Math.sin(t),er:[Math.sin(t),-Math.cos(t)],et:[Math.cos(t),Math.sin(t)]};}
// Conservative sine motion has a fixed energy envelope; driven and approximate
// laws use the whole rotation circle. Bounds never depend on the current frame.
export function pendulumBounds(p,focus=false){
 const L=p.length;
 const E=1-Math.cos(p.theta0)+L*p.omega0**2/(2*p.gravity);
 if(p.drive||p.linear!=='exact'||E>=2)return focus?[-1.12*L,1.12*L,-1.08*L,1.12*L]:[-1.42*L,1.42*L,-1.45*L,1.15*L];
 const A=Math.acos(1-Math.max(0,E)),width=Math.max(.6,A>=Math.PI/2?1:Math.sin(A));
 return [-width*L,width*L,(focus?-1:-1.03)*L,Math.max(focus?.02:.12,-Math.cos(A)+(focus?.02:.12))*L];
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
  const offsets=[[dx/n*20,dy/n*20],[0,18],[0,-18],[40,18],[-40,18],[45,-18],[-45,-18],[0,34],[60,34],[-60,34],[60,-34],[-60,-34],[0,-45],...[-70,-50,-30,0,30,50,70].flatMap(x=>[-55,-35,0,35,55].map(y=>[x,y])).sort((a,b)=>Math.hypot(...a)-Math.hypot(...b))];
  for(const [ox,oy] of offsets){const x=a.x+ox,y=a.y+oy,width=s.ctx.measureText(a.text).width,rect={x:x-width/2-3,y:y-size*.65,width:width+6,height:size*1.3};
   if(arrows.some(b=>shaftHits(rect,[b.ax,b.ay],[b.x,b.y])))continue;
   if(label(s,a.text,x,y,a.c,size))break;
  }
 }
}
function diagram(s,f,zoom){
 s.forceArrows=[];const {params:p,sample:q}=f,t=q.theta,L=p.length,theta=Math.atan2(Math.sin(t),Math.cos(t));
 const focus=zoom||f.breakdown,m=fixedMap(s,pendulumBounds(p,focus),{top:f.thumbnail?18:focus?25:76,bottom:f.thumbnail?18:focus?150:145,padding:f.thumbnail?22:35}),px=m.x(0),py=m.y(0),bx=m.x(L*Math.sin(t)),by=m.y(-L*Math.cos(t));
 const radius=Math.max(8,Math.min(focus?11:16,m.scale*L*(focus?.06:.09))),body={x:bx-radius-4,y:by-radius-4,width:2*radius+8,height:2*radius+8};s.bobRadius=radius;const smallFocus=focus&&!p.drive&&p.linear==='exact'&&Math.abs(p.theta0)<1&&Math.abs(p.omega0)<1;s.zoomAnchor=smallFocus?{x:Math.max(90,px-105),y:py+.8*L*m.scale}:{x:px,y:Math.max(18,m.y(L)-32)};s.avoid=[body,{x:s.zoomAnchor.x-82,y:s.zoomAnchor.y-18,width:164,height:36},{x:0,y:s.h-(focus?80:123),width:s.w,height:focus?80:123}];
 s.ctx.setLineDash([3,5]);s.line(px,py,px,m.y(-L*1.17),C.grid,1);s.ctx.setLineDash([]);
 s.line(px-19,py-8,px+19,py-8,C.dim,4);s.line(px,py,bx,by,'#98acc5',3);s.circle(px,py,4,C.ink);
 if(p.drive){const z=Math.cos(p.driveOmega*f.t+p.drivePhase);s.line(px-20,py-19,px+20*z,py-19,C.violet,3);}
 bead(s,bx,by,radius);
 if(f.thumbnail)return;
 angle(s,px,py,Math.max(17,Math.min(35,m.scale*L*.25)),theta);
 if(f.breakdown||zoom){
  const d=decomposition(p,q),u=zoom?Math.max(90,7*radius):Math.max(80,6*radius),ax=bx,ay=by;
  // Gravity's radial projection is OUTWARD; string tension, when present,
  // points inward and is a different force. The two components sum to mg.
  const ends=[{x:ax,y:ay+u,text:'mg',c:C.green},{x:ax+d.tangential/d.mg*d.et[0]*u,y:ay-d.tangential/d.mg*d.et[1]*u,text:'\u2212mg sin\u03b8',c:C.blue},{x:ax+d.radial/d.mg*d.er[0]*u,y:ay-d.radial/d.mg*d.er[1]*u,text:'mg cos\u03b8',c:C.gold}];
  s.ctx.setLineDash([3,4]);s.line(bx,by,bx+d.er[0]*u,by-d.er[1]*u,C.dim,1);s.ctx.setLineDash([]);
  if(s.w>=360&&Math.abs(theta)>.04){const a=Math.PI/2-theta/2,r=u*.9;label(s,'\u03b8',bx+r*Math.cos(a),by+r*Math.sin(a),C.gold,11);}
  const visible=ends.filter((e,i)=>i===0||(Math.hypot(e.x-ax,e.y-ay)>3&&Math.hypot(e.x-ends[0].x,e.y-ends[0].y)>4));s.forceArrows=visible.map(e=>({...e,ax,ay}));for(const e of visible){s.line(ax,ay,e.x,e.y,'#10151e',5);s.arrow(ax,ay,e.x,e.y,e.c,2.8);}forceLabels(s,s.forceArrows);

 }
 s.avoid=[body];label(s,'\u03b8 '+fmt(q.theta)+' rad   \u03c9 '+fmt(q.omega)+' rad/s',s.w/2,s.h-(focus?55:106),C.blue,11);
}
export const view={graphs,closeups,
 key:f=>f.closeup?'Gravity \u2192 radial + tangential':f.params.linear==='exact'?'Rigid rod \u00b7 exact sine torque':f.params.linear==='linear'?'Small-angle approximation':'Cubic sine approximation',
 closeupAnchors:s=>({gravity:s.zoomAnchor||{x:s.w/2,y:32}}),
 graphDescriptors(p){const E=1-Math.cos(p.theta0)+p.length*p.omega0**2/(2*p.gravity),A=E<2?Math.acos(1-E):.1,T=p.drive?2*Math.PI/p.driveOmega:exactPeriod(A,p.length,p.gravity),window=Math.min(60,Math.max(.2,5*T));return graphs.map(g=>({...g,...(!g.kind?{window}:{})}));},
 draw(s,f){diagram(s,f,!!f.closeup);},
 drawGraph(s,d,f){if(d.id==='phase'){linePlot(s,{title:'Phase space',points:f.samples,xkey:'theta',ykey:'omega',cursor:f.sample,xlabel:'\u03b8 / rad',ylabel:'\u03c9 / (rad/s)',color:C.blue});return;}drawAnalysis(s,d,f,{position:'theta',velocity:'omega',periodPoint(frame,i){const x=.02+(Math.PI-.12)*i/31,instance=model.create({...frame.params,theta0:x,omega0:0,drive:0,damping:0});return {x,y:instance.period()};}});},
 equations(f){
  const p=f.params,q=f.sample,d=decomposition(p,q),I=p.mass*p.length*p.length,td=p.drive*Math.cos(p.driveOmega*f.t+p.drivePhase),tau=p.linear==='linear'?String.raw`-mgL\theta`:p.linear==='cubic'?String.raw`-mgL(\theta-\theta^3/6)`:String.raw`-mgL\sin\theta`;
  const lines=[String.raw`F_t=-mg\sin\theta`,String.raw`=-(${p.mass})(${p.gravity})\sin(${tex(q.theta)})`,String.raw`=${tex(d.tangential)}\,\mathrm N`,String.raw`F_r=mg\cos\theta=${tex(d.radial)}\,\mathrm N`,String.raw`\tau_g=-mgL\sin\theta`,String.raw`=-(${p.mass})(${p.gravity})(${p.length})\sin(${tex(q.theta)})`,String.raw`=${tex(d.torque)}\,\mathrm{N\,m}`];
  if(p.damping)lines.push(String.raw`\tau_b=-b\omega=${tex(-p.damping*q.omega)}\,\mathrm{N\,m}`);
  if(p.drive)lines.push(String.raw`\tau_d=\tau_0\cos(\Omega t+\phi)=${tex(td)}\,\mathrm{N\,m}`);
  lines.push(String.raw`mL^2\ddot\theta=${tau}`+(p.damping?String.raw`-b\omega`:'')+(p.drive?String.raw`+\tau_d`:''),String.raw`=(${p.mass})(${p.length})^2(${tex(q.alpha)})`,String.raw`=${tex(I*q.alpha)}\,\mathrm{N\,m}`);return lines;
 },
 closeupEquation(f){const p=f.params,q=f.sample,d=decomposition(p,q);return [String.raw`\tau_g=-mgL\sin\theta`,String.raw`=-(${p.mass})(${p.gravity})(${p.length})\sin(${tex(q.theta)})`,String.raw`=${tex(d.torque)}\,\mathrm{N\,m}`];},
};
