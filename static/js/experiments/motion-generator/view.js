import {C,fmt,tex,label,tip,bead,fixedMap,linePlot} from './view-tools.js';
const graphs=[
 {id:'motion',label:'Position',unit:'m',series:[{key:'x',label:'x',color:C.blue},{key:'y',label:'y',color:C.gold},{key:'z',label:'z',color:C.violet}]},
 {id:'velocity',label:'Velocity',unit:'m/s',series:[{key:'vx',label:'vx',color:C.blue},{key:'vy',label:'vy',color:C.gold},{key:'vz',label:'vz',color:C.violet}]},
 {id:'phase',label:'Phase space',unit:'m, m/s',kind:'custom',series:[{key:'x',label:'x'},{key:'vx',label:'vx'}]},
 {id:'trajectory',label:'Trajectory',unit:'m',kind:'custom',series:[{key:'x',label:'x'},{key:'y',label:'y'}]},
 {id:'energy',label:'Energy',unit:'J',series:[{key:'energy',label:'E',color:C.green},{key:'kinetic',label:'K',color:C.blue},{key:'potential',label:'U',color:C.gold}]},
 {id:'balance',label:'Work & heat',unit:'J',series:[{key:'work',label:'W',color:C.violet},{key:'heat',label:'Q',color:C.gold}]},
];
const closeups=[{id:'force',label:'Zoom \u00b7 force law'}];
const zooms=new WeakMap();
export function forceLaw(p){
 const terms=[];if(p.spring)terms.push('-kx');if(p.cubic)terms.push('-\u03b1x\u00b3');if(p.constantRestoring)terms.push('-s sgn(x)');if(p.gravity&&p.dimensions==='1d')terms.push('-mg');if(p.linearDrag||p.quadraticDrag)terms.push('-(b+c|v|)vx');if(p.inverseSquare)terms.push('-m\u03bcx/(r\u00b2+\u03b5\u00b2)^1.5');if(p.magnetic&&p.dimensions!=='1d')terms.push('+qB vy');if(p.forceX)terms.push('+Fx');if(p.ramp)terms.push('+at');if(p.drive)terms.push('+Fd cos(\u03a9t)');return 'Fx = '+(terms.join(' ').replace(/^\+/,'')||'0');
}
export function motionBounds(p,T=60){
 const n=p.dimensions==='3d'?3:p.dimensions==='2d'?2:1;
 let range=[];
 const driving=Math.abs(p.drive)+Math.abs(p.ramp)*T,drag=p.linearDrag;
 for(let i=0;i<n;i++){
  const q=[p.x0,p.y0,p.z0][i],v=[p.vx0,p.vy0,p.vz0][i],F=[p.forceX,p.forceY,p.forceZ][i]-((n===1?0:1)===i?p.mass*p.gravity:0),w=Math.sqrt(Math.max(0,p.spring)/p.mass);
  if(w&&p.cubic>=0&&!p.inverseSquare){const eq=F/p.spring;let A=Math.hypot(q-eq,v/w)+(i===0?driving*T/(p.mass*w):0);
   if(i===0&&p.drive&&drag>0&&!p.ramp&&p.cubic===0&&drag/(2*p.mass)<w){const lag=Math.atan2(drag*p.driveOmega,p.spring-p.mass*p.driveOmega**2),Ad=p.drive/Math.hypot(p.spring-p.mass*p.driveOmega**2,drag*p.driveOmega),gamma=drag/(2*p.mass),wd=Math.sqrt(w*w-gamma*gamma),a=q-eq-Ad*Math.cos(lag),b=(v-Ad*p.driveOmega*Math.sin(lag)+gamma*a)/wd;A=Ad+Math.hypot(a,b);}
   range.push([eq-A,eq+A]);}
  else if(p.spring>0&&p.cubic<0&&!F&&!driving&&!p.inverseSquare){const E=p.mass*v*v/2+p.spring*q*q/2+p.cubic*q**4/4,disc=p.spring*p.spring+4*p.cubic*E;const A=disc>=0?Math.sqrt((-p.spring+Math.sqrt(disc))/p.cubic):Math.abs(q)+10;range.push([-A,A]);}
  else if(p.magnetic&&n>1&&!p.gravity&&!p.spring&&!driving&&!p.inverseSquare){const r=p.mass*Math.hypot(p.vx0,p.vy0)/Math.abs(p.magnetic),center=i===0?p.x0+p.mass*p.vy0/p.magnetic:i===1?p.y0-p.mass*p.vx0/p.magnetic:q+v*T/2;range.push(i<2?[center-r,center+r]:[Math.min(q,q+v*T),Math.max(q,q+v*T)]);}
  else if(p.inverseSquare&&!p.drive&&!p.ramp){const r=4*Math.max(.5,Math.hypot(p.x0,p.y0,p.z0));range.push([-r,r]);}
  else if(p.constantRestoring>0&&!F&&!driving&&!p.spring){const A=Math.abs(q)+p.mass*v*v/(2*p.constantRestoring);range.push([-A,A]);}
  else {let end=q+v*T+F*T*T/(2*p.mass)+(i===0?p.ramp*T**3/(6*p.mass):0);
   if(drag&&!p.quadraticDrag&&!driving&&!p.spring){const tau=p.mass/drag,terminal=F/drag;end=q+terminal*T+(v-terminal)*tau*(1-Math.exp(-T/tau));}
   if(p.quadraticDrag&&!p.linearDrag&&!p.spring&&!driving&&v===0&&F){const terminal=Math.sqrt(Math.abs(F)/p.quadraticDrag),a=Math.sqrt(Math.abs(F)*p.quadraticDrag)/p.mass;end=q+Math.sign(F)*p.mass/p.quadraticDrag*(a*T+Math.log1p(Math.exp(-2*a*T))-Math.log(2));}
   range.push([Math.min(q,end,0),Math.max(q,end,0)]);
  }
 }
 const r=(i)=>range[i]||[0,0];let xb,yb;
 if(n===1&&p.gravity){xb=[-.5,.5];yb=r(0);}else{xb=[r(0)[0]+(n===3?.45*r(2)[0]:0),r(0)[1]+(n===3?.45*r(2)[1]:0)];yb=n>1?[r(1)[0]+(n===3?.25*r(2)[0]:0),r(1)[1]+(n===3?.25*r(2)[1]:0)]:[-.5,.5];}
 const pad=Math.max(.25,Math.max(xb[1]-xb[0],yb[1]-yb[0])*.12);return [xb[0]-pad,xb[1]+pad,yb[0]-pad,yb[1]+pad];
}
function project(p,q){return p.dimensions==='1d'&&p.gravity?[0,q[0]]:[q[0]+(p.dimensions==='3d'?.45*q[2]:0),q[1]+(p.dimensions==='3d'?.25*q[2]:0)];}
export function forceEquations(f){
 const p=f.params,q=f.sample,forces=f.geometry.forces,lines=[];
 if(p.spring||p.cubic)lines.push(String.raw`F_{s,x}=-kx-\alpha x^3`,String.raw`=-(${p.spring})(${tex(q.x)})-(${p.cubic})(${tex(q.x)})^3`,String.raw`=${tex(forces.spring[0])}\,\mathrm N`);
 if(p.constantRestoring)lines.push(String.raw`F_{c,x}=-s\operatorname{sgn}x=${tex(forces.constantRestoring[0])}\,\mathrm N`);
 if(p.gravity)lines.push(String.raw`F_{g,${p.dimensions==='1d'?'x':'y'}}=-mg`,String.raw`=-(${p.mass})(${p.gravity})=${tex(-p.mass*p.gravity)}\,\mathrm N`);
 if(p.linearDrag||p.quadraticDrag)lines.push(String.raw`F_{d,x}=-(b+c|v|)v_x`,String.raw`=-(${p.linearDrag}+${p.quadraticDrag}(${tex(q.speed)}))(${tex(q.vx)})`,String.raw`=${tex(forces.drag[0])}\,\mathrm N`);
 if(p.inverseSquare)lines.push(String.raw`r_\epsilon=\sqrt{r^2+\epsilon^2}`,String.raw`F_{a,x}=-m\mu x/r_\epsilon^3`,String.raw`=${tex(forces.attraction[0])}\,\mathrm N`);
 if(p.magnetic&&p.dimensions!=='1d')lines.push(String.raw`F_{B,x}=qBv_y=${tex(forces.magnetic[0])}\,\mathrm N`,String.raw`F_{B,y}=-qBv_x=${tex(forces.magnetic[1])}\,\mathrm N`);
 if(p.forceX||p.forceY||p.forceZ||p.drive||p.ramp)lines.push(String.raw`F_{{\rm applied},x}=F_x+at+F_d\cos\Omega t`,String.raw`=${tex(forces.applied[0])}\,\mathrm N`);
 return lines;
}
export const view={graphs,closeups,
 key:f=>f.closeup?'Signed force components \u00b7 arrows share one scale':forceLaw(f.params),
 closeupAnchors:s=>({force:{x:s.w/2,y:s.h-74}}),
 draw(s,f){
  const p=f.params,g=f.geometry,zoom=!!f.closeup;
  const mix=(zooms.get(s)||0)+((zoom?1:0)-(zooms.get(s)||0))*.22;zooms.set(s,mix);s.avoid=[];
  if(zoom||f.breakdown){
   const forces=Object.entries(g.forces).filter(([,v])=>Math.hypot(...v)>1e-9),max=Math.max(1,...forces.map(([,v])=>Math.hypot(...v))),m=fixedMap(s,[-1.2,1.2,-.8,.8],{top:58,bottom:132,padding:40}),cx=m.x(0),cy=m.y(0),extent=Math.min(s.w*.26,(s.h-155)*.30),radius=17+11*mix;
   s.avoid=[{x:cx-radius-5,y:cy-radius-5,width:2*radius+10,height:2*radius+10}];
   label(s,'Forces on the particle',s.w/2,45,C.ink,13);
   forces.forEach(([name,v],i)=>{const q=project(p,v),tipX=cx+q[0]/max*extent,tipY=cy-q[1]/max*extent,color=[C.blue,C.gold,C.green,C.violet][i%4];s.arrow(cx,cy,tipX,tipY,color,2.5);tip(s,name+' '+fmt(p.dimensions==='1d'?v[0]:Math.hypot(...v))+' N',tipX,tipY,color);});
   bead(s,cx,cy,radius);s.avoid=[];
   if(!forces.length)label(s,'F = 0',s.w/2,cy-40,C.dim,12);
   label(s,p.dimensions==='1d'?'Arrows show signed force':'Arrow direction + magnitude; components below',s.w/2,s.h-105,C.dim,s.w<360?10:11);return;
  }
  const bounds=motionBounds(p),spring=p.dimensions==='1d'&&!p.gravity&&p.spring,wall=spring?bounds[0]-(bounds[1]-bounds[0])*.22:0;
  if(spring)bounds[0]=wall-(bounds[1]-wall)*.05;
  const m=fixedMap(s,bounds,{bottom:108,top:45,padding:28}),[qx,qy]=project(p,g.position),px=m.x(qx),py=m.y(qy),o=project(p,[0,0,0]);
  s.ctx.setLineDash([3,5]);s.line(m.x(o[0]),m.y(o[1])-34,m.x(o[0]),m.y(o[1])+35,C.grid,1);s.ctx.setLineDash([]);
  if(p.dimensions==='1d'&&!p.gravity){s.line(22,m.y(0)+16,s.w-22,m.y(0)+16,C.grid,1);if(spring){s.line(m.x(wall),m.y(0)-20,m.x(wall),m.y(0)+16,C.dim,3);for(let i=-18;i<15;i+=8)s.line(m.x(wall)-7,m.y(0)+i+6,m.x(wall),m.y(0)+i,C.grid,1);s.spring(m.x(wall),m.y(0),px-9,py,C.dim,6);}label(s,'x = 0',m.x(0),m.y(0)+45,C.dim,10);}
  const history=f.samples.filter(v=>v.t<=f.t+1e-8).slice(-360);if(history.length>1){s.ctx.beginPath();for(const [i,v] of history.entries()){const q=project(p,[v.x,v.y,v.z]);i?s.ctx.lineTo(m.x(q[0]),m.y(q[1])):s.ctx.moveTo(m.x(q[0]),m.y(q[1]));}s.ctx.strokeStyle='#8ab9ff55';s.ctx.lineWidth=1.8;s.ctx.stroke();}
  bead(s,px,py,10);if(p.dimensions!=='1d')label(s,p.dimensions==='3d'?'x / y / z \u00b7 oblique projection':'x right \u00b7 y up',s.w/2,25,C.dim,11);
  label(s,'x '+fmt(f.sample.x)+' m   vx '+fmt(f.sample.vx)+' m/s',s.w/2,s.h-108,C.blue,11);
 },
 drawGraph(s,d,f){const y=d.id==='trajectory'?'y':'vx';linePlot(s,{title:d.label,points:f.samples,xkey:'x',ykey:y,cursor:f.sample,xlabel:'x / m',ylabel:y+(y==='y'?' / m':' / (m/s)'),color:C.blue});},
 equations(f){const p=f.params,a=f.geometry.acceleration,forces=f.geometry.forces;return [...forceEquations(f),String.raw`m\ddot{\mathbf r}=\sum\mathbf F`,...['x','y','z'].slice(0,f.geometry.dimensions).map((axis,i)=>String.raw`F_${axis}= ${tex(Object.values(forces).reduce((sum,v)=>sum+v[i],0))}\,\mathrm{N}=(${p.mass})(${tex(a[i])})`),String.raw`E-W+Q=${tex(f.sample.energy-f.sample.work+f.sample.heat)}\,\mathrm J`];},
 closeupEquation(f){return forceEquations(f);},
};
