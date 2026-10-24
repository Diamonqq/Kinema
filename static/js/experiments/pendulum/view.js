import {model,exactPeriod} from './model.js';
import {C,fmt,tex,texU,withUnit,label,bead,angle,fixedMap,chipBox,drawAnalysis,linePlot} from '../motion-generator/view-tools.js';
const closeups=[{id:'gravity',label:'Zoom \u00b7 gravity components'}];
const graphs=[
 {id:'motion',label:'Angle',unit:'rad',series:[{key:'thetaWrapped',label:'\u03b8',color:C.blue}]},
 {id:'phase',label:'Phase space (unwrapped)',kind:'custom',series:[{key:'theta',label:'\u03b8'},{key:'omega',label:'\u03c9'}]},
 {id:'energy',label:'Energy',unit:'J',series:[{key:'energy',label:'E',color:C.green},{key:'kinetic',label:'K',color:C.blue},{key:'potential',label:'U',color:C.gold}]},
 {id:'sensitivity',label:'Nearby starts',unit:'rad',series:[{key:'separation',label:'separation',color:C.violet}]},
 {id:'period',label:'Period vs amplitude',kind:'custom'}, {id:'strobe',label:'Poincar\u00e9 section',kind:'custom'}, {id:'return',label:'Velocity return',kind:'custom'}, {id:'spectrum',label:'Spectrum',kind:'custom'},
];
graphs.forEach(g=>{if(!g.kind)g.window=5*exactPeriod(.3);});
// The restoring law the lab integrates: exact sin, small angle, or the cubic series.
export const sineModel=(mode,t)=>mode==='linear'?t:mode==='cubic'?t-t**3/6:Math.sin(t);
export function decomposition(params,sample){const mg=params.mass*params.gravity,t=sample.theta,S=sineModel(params.linear,t);return {mg,tangential:-mg*S,radial:mg*Math.cos(t),tension:mg*Math.cos(t)+params.mass*params.length*sample.omega**2,torque:-mg*params.length*S,sine:S,er:[Math.sin(t),-Math.cos(t)],et:[Math.cos(t),Math.sin(t)]};}
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
  const px=-dy/n*17,py=dx/n*17,side=Math.sign(px)===-Math.sign(dx)||dx===0?1:-1,perp=a.text==='T'?[[px*side,py*side],[-px*side,-py*side],[px*side*1.7,py*side*1.7]]:[];
  const offsets=[...perp,[dx/n*18,dy/n*18],[dx/n*18+(dy>0?-1:1)*Math.abs(dy)/n*28,dy/n*18-(dx>0?1:-1)*Math.abs(dx)/n*0],[0,18],[0,-18],[40,18],[-40,18],[45,-18],[-45,-18],[0,34],[0,-34],[60,34],[-60,34],[60,-34],[-60,-34]];
  for(const [ox0,oy] of offsets){const width=s.ctx.measureText(a.text).width,x=Math.max(width/2+9,Math.min(s.w-width/2-9,a.x+ox0)),ox=x-a.x,y=a.y+oy,rect={x:x-width/2-3,y:y-size*.65,width:width+6,height:size*1.3};
   if(arrows.some(b=>shaftHits(rect,[b.ax,b.ay],[b.x,b.y])))continue;
   if(label(s,a.text,x,y,a.c,size)){if(Math.hypot(ox,oy)>30)s.line(a.x,a.y,x,y-size*.5*Math.sign(oy||1),a.c+'80',1);break;}
  }
 }
}
const sineTex=mode=>mode==='linear'?String.raw`\theta`:mode==='cubic'?String.raw`(\theta-\theta^3/6)`:String.raw`\sin\theta`;
const sineNumeric=(mode,t)=>{const a=texU(t,'rad');return mode==='linear'?`(${a})`:mode==='cubic'?String.raw`\left(${a}-\frac{(${a})^3}{6}\right)`:String.raw`\sin(${a})`;};
function tensionEnd(ax,ay,d,scale,reach){const len=Math.abs(d.tension)*scale,k=len>reach&&len>0?reach/len:1,sign=d.tension<0?-1:1;return {x:ax-sign*Math.abs(d.tension)*d.er[0]*scale*k,y:ay+sign*Math.abs(d.tension)*d.er[1]*scale*k};}
function diagram(s,f,zoom){
 s.forceArrows=[];const {params:p,sample:q}=f,t=q.theta,L=p.length,theta=Math.atan2(Math.sin(t),Math.cos(t));
 const focus=zoom||f.breakdown,m=fixedMap(s,pendulumBounds(p,focus),{top:f.thumbnail?18:focus?66:76,bottom:f.thumbnail?18:focus?106:145,padding:f.thumbnail?22:focus?Math.min(100,s.w*.22):35}),px=m.x(0),py=m.y(0),bx=m.x(L*Math.sin(t)),by=m.y(-L*Math.cos(t));
 const radius=Math.max(8,Math.min(focus?11:16,m.scale*L*(focus?.06:.09))),rod=m.scale*L,body={x:bx-radius-4,y:by-radius-4,width:2*radius+8,height:2*radius+8};s.bobRadius=radius;s.zoomAnchor={x:px,y:Math.max(6,py-20-(s.w<=440?24:32))};s.chipTarget={x:px,y:py-8};s.avoid=[body,chipBox(s,closeups[0].label,s.zoomAnchor),{x:0,y:s.h-(focus?62:123),width:s.w,height:focus?62:123}];
 s.ctx.setLineDash([3,5]);s.line(px,py,px,m.y(-L*1.17),C.grid,1);s.ctx.setLineDash([]);
 s.line(px-19,py-8,px+19,py-8,C.dim,4);s.line(px,py,bx,by,'#98acc5',3);s.circle(px,py,4,C.ink);
 if(p.drive){const z=Math.cos(p.driveOmega*f.t+p.drivePhase);s.line(px-20,py-19,px+20*z,py-19,C.violet,3);}
 bead(s,bx,by,radius);
 if(f.thumbnail)return;
 angle(s,px,py,Math.max(17,Math.min(35,m.scale*L*.25)),theta);
 if(f.breakdown||zoom){
  const d=decomposition(p,q),u=zoom?Math.max(80,7*radius):Math.max(64,6*radius),forceScale=u/Math.max(d.mg,Math.abs(d.tension)),ax=bx,ay=by;
  // Gravity's radial projection is OUTWARD; string tension, when present,
  // points inward and is a different force. The two components sum to mg.
  const ends=[{x:ax,y:ay+d.mg*forceScale,text:'mg',c:C.green},{x:ax+d.tangential*d.et[0]*forceScale,y:ay-d.tangential*d.et[1]*forceScale,text:'\u2212mg sin\u03b8',c:C.blue},{x:ax+d.radial*d.er[0]*forceScale,y:ay-d.radial*d.er[1]*forceScale,text:'mg cos\u03b8',c:C.gold},{...tensionEnd(ax,ay,d,forceScale,rod-radius-24),text:'T',c:C.violet}];
  s.ctx.setLineDash([3,4]);s.line(bx,by,bx+d.er[0]*u,by-d.er[1]*u,C.dim,1);s.ctx.setLineDash([]);
  if(Math.abs(theta)>.04){const a=Math.PI/2-theta/2,r=Math.min(30,u*.4);s.ctx.beginPath();s.ctx.strokeStyle=C.gold;s.ctx.lineWidth=1.4;s.ctx.arc(bx,by,r,Math.min(Math.PI/2,Math.PI/2-theta),Math.max(Math.PI/2,Math.PI/2-theta));s.ctx.stroke();}
  const visible=ends.filter((e,i)=>i===0||(Math.hypot(e.x-ax,e.y-ay)>3&&Math.hypot(e.x-ends[0].x,e.y-ends[0].y)>4));s.forceArrows=visible.map(e=>({...e,ax,ay}));for(const e of visible){s.line(ax,ay,e.x,e.y,'#10151e',5);s.arrow(ax,ay,e.x,e.y,e.c,2.8);}forceLabels(s,s.forceArrows);if(Math.abs(theta)>.04){const a=Math.PI/2-theta/2,r=Math.min(30,u*.4);label(s,'θ',bx+(r+10)*Math.cos(a),by+(r+10)*Math.sin(a),C.gold,11);}

 }
 s.avoid=[body];label(s,'θ = '+withUnit(q.theta,'rad')+'   ω = '+withUnit(q.omega,'rad/s'),s.w/2,s.h-(focus?46:106),C.blue,11);
}
export const view={graphs,closeups,
 key:f=>f.closeup?'Gravity \u2192 radial + tangential':f.params.linear==='exact'?'Rigid rod \u00b7 exact sine torque':f.params.linear==='linear'?'Model: sin \u03b8 \u2248 \u03b8':'Model: sin \u03b8 \u2248 \u03b8 \u2212 \u03b8\u00b3/6',
 closeupAnchors:s=>({gravity:s.zoomAnchor||{x:s.w/2,y:32}}),
 graphDescriptors(p){const E=1-Math.cos(p.theta0)+p.length*p.omega0**2/(2*p.gravity),A=E<2?Math.acos(1-E):.1,T=p.drive?2*Math.PI/p.driveOmega:exactPeriod(A,p.length,p.gravity),window=Math.min(60,Math.max(.2,5*T));return graphs.map(g=>({...g,...(!g.kind?{window}:{})}));},
 draw(s,f){diagram(s,f,!!f.closeup);},
 drawGraph(s,d,f){if(d.id==='phase'){linePlot(s,{title:'Phase space',points:f.samples,xkey:'theta',ykey:'omega',cursor:f.sample,xlabel:'\u03b8 (unwrapped) / rad',ylabel:'\u03c9 / (rad/s)',color:C.blue});return;}drawAnalysis(s,d,f,{position:'theta',velocity:'omega',periodPoint(frame,i){const x=.02+(Math.PI-.12)*i/31,instance=model.create({...frame.params,theta0:x,omega0:0,drive:0,damping:0});return {x,y:instance.period()};}});},
 equations(f){
  const p=f.params,q=f.sample,d=decomposition(p,q),I=p.mass*p.length*p.length,td=p.drive*Math.cos(p.driveOmega*f.t+p.drivePhase),m=sineTex(p.linear),n=sineNumeric(p.linear,q.theta),tau=String.raw`-mgL${m}`;
  const lines=[String.raw`T=mg\cos\theta+m\omega^2L`,String.raw`=(${texU(p.mass,'kg')})(${texU(p.gravity,'m/s^2')})\cos(${texU(q.theta,'rad')})`,String.raw`+(${texU(p.mass,'kg')})(${texU(q.omega,'rad/s')})^2(${texU(p.length,'m')})`,String.raw`=${tex(d.tension)}\,\mathrm N`,String.raw`F_t=-mg${m}`,...(p.linear==='cubic'?[String.raw`=-(${texU(p.mass,'kg')})(${texU(p.gravity,'m/s^2')})`,n]:[String.raw`=-(${texU(p.mass,'kg')})(${texU(p.gravity,'m/s^2')})${n}`]),String.raw`=${tex(d.tangential)}\,\mathrm N`,String.raw`F_{g,r}=mg\cos\theta=${tex(d.radial)}\,\mathrm N`,String.raw`\tau_g=-mgL${m}`,String.raw`=-(${texU(p.mass,'kg')})(${texU(p.gravity,'m/s^2')})(${texU(p.length,'m')})`,n,String.raw`=${tex(d.torque)}\,\mathrm{N\,m}`];
  if(p.damping)lines.push(String.raw`\tau_b=-b\omega`,String.raw`=-(${texU(p.damping,'N\,m\,s/rad')})(${texU(q.omega,'rad/s')})`,String.raw`=${tex(-p.damping*q.omega)}\,\mathrm{N\,m}`);
  if(p.drive)lines.push(String.raw`\tau_d=\tau_0\cos(\Omega t+\phi)`,String.raw`=${texU(p.drive,'N\,m')}\cos(${texU(p.driveOmega*f.t+p.drivePhase,'rad')})`,String.raw`=${tex(td)}\,\mathrm{N\,m}`);
  lines.push(String.raw`mL^2\ddot\theta=${tau}`+(p.damping?String.raw`-b\omega`:'')+(p.drive?String.raw`+\tau_d`:''),String.raw`=(${texU(p.mass,'kg')})(${texU(p.length,'m')})^2(${texU(q.alpha,'rad/s^2')})`,String.raw`=${tex(I*q.alpha)}\,\mathrm{N\,m}`);return lines;
 },
 closeupEquation(f){const p=f.params,q=f.sample,d=decomposition(p,q);return [String.raw`T=mg\cos\theta+m\omega^2L=${tex(d.tension)}\,\mathrm N`,String.raw`\tau_g=-mgL${sineTex(p.linear)}`,String.raw`=-(${texU(p.mass,'kg')})(${texU(p.gravity,'m/s^2')})(${texU(p.length,'m')})`,sineNumeric(p.linear,q.theta),String.raw`=${tex(d.torque)}\,\mathrm{N\,m}`];},
};
