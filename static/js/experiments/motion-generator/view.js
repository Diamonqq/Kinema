import {C,fmt,tex,texU,pane,wrapTex,withUnit,label,tip,bead,fixedMap,linePlot} from './view-tools.js';
const graphs=[
 {id:'motion',label:'Position',unit:'m',series:[{key:'x',label:'x',color:C.blue},{key:'y',label:'y',color:C.gold},{key:'z',label:'z',color:C.violet}]},
 {id:'velocity',label:'Velocity',unit:'m/s',series:[{key:'vx',label:'vx',color:C.blue},{key:'vy',label:'vy',color:C.gold},{key:'vz',label:'vz',color:C.violet}]},
 {id:'phase',label:'Phase space',kind:'custom',series:[{key:'x',label:'x'},{key:'vx',label:'vx'}]},
 {id:'trajectory',label:'Trajectory',unit:'m',kind:'custom',series:[{key:'x',label:'x'},{key:'y',label:'y'}]},
 {id:'energy',label:'Energy',unit:'J',series:[{key:'energy',label:'E',color:C.green},{key:'kinetic',label:'K',color:C.blue},{key:'potential',label:'U',color:C.gold}]},
 {id:'balance',label:'Work & heat',unit:'J',series:[{key:'work',label:'W',color:C.violet},{key:'heat',label:'Q',color:C.gold}]},
];
graphs.forEach(g=>{if(!g.kind)g.window=10*Math.PI;});
const closeups=[{id:'force',label:'Zoom \u00b7 force law'}];
const zooms=new WeakMap();
export const forceSymbols={spring:'F_{s}',constantRestoring:'F_{c}',gravity:'mg',drag:'F_{D}',attraction:'F_{g}',magnetic:'F_{B}',applied:'F_{app}'};
export function forceLaw(p){
 const terms=[];if(p.spring)terms.push('-kx');if(p.cubic)terms.push('-\u03b2x\u00b3');if(p.constantRestoring)terms.push('-s sgn(x)');if(p.gravity&&p.dimensions==='1d')terms.push('-mg');if(p.linearDrag||p.quadraticDrag)terms.push('-(b+c|v|)v_{x}');if(p.inverseSquare)terms.push('-m\u03bcx/(r\u00b2+\u03b5\u00b2)^1.5');if(p.magnetic&&p.dimensions!=='1d')terms.push('+qB v_{y}');if(p.forceX)terms.push('+F_{app,x}');if(p.ramp)terms.push('+at');if(p.drive)terms.push('+F_{d} cos(\u03a9t)');return 'F_{net,x} = '+(terms.join(' ').replace(/^\+/,'').replace(/-/g,'\u2212')||'0');
}
// Law caption drawn on the canvas (subscripts need label()); wraps after a term when too wide.
export function forceLawLines(p,width,size=11){
 const text=forceLaw(p),plain=t=>t.replace(/_\{([^}]+)\}/g,'$1'),limit=Math.max(60,width-24),per=size*.56;
 if(plain(text).length*per<=limit)return [text];
 const parts=text.split(/ (?=[+\u2212])/),lines=[''];
 for(const part of parts){const last=lines.length-1;if(lines[last]&&plain(lines[last]+' '+part).length*per>limit)lines.push('   '+part);else lines[last]=lines[last]?lines[last]+' '+part:part;}
 return lines;
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
 if(p.spring||p.cubic){const symbolic=[],numeric=[];if(p.spring){symbolic.push('-kx');numeric.push(String.raw`-(${texU(p.spring,'N/m')})(${texU(q.x,'m')})`);}if(p.cubic){symbolic.push(String.raw`-\beta x^3`);numeric.push(String.raw`-(${texU(p.cubic,'N/m^3')})(${texU(q.x,'m')})^3`);}lines.push('F_{s,x}='+symbolic.join(''),...wrapTex(['='+numeric[0],...numeric.slice(1)]),String.raw`=${tex(forces.spring[0])}\,\mathrm N`);}
 if(p.constantRestoring)lines.push(String.raw`F_{c,x}=-s\operatorname{sgn}x=${tex(forces.constantRestoring[0])}\,\mathrm N`);
 if(p.gravity)lines.push(String.raw`(mg)_{${p.dimensions==='1d'?'x':'y'}}=-mg`,String.raw`=-(${texU(p.mass,'kg')})(${texU(p.gravity,'m/s^2')})`,String.raw`=${tex(-p.mass*p.gravity)}\,\mathrm N`);
 if(p.linearDrag||p.quadraticDrag){const symbolic=[...(p.linearDrag?['b']:[]),...(p.quadraticDrag?['c|v|']:[])].join('+'),numeric=[...(p.linearDrag?[texU(p.linearDrag,'kg/s')]:[]),...(p.quadraticDrag?[`${texU(p.quadraticDrag,'kg/m')}(${texU(q.speed,'m/s')})`]:[])].join('+');lines.push(`F_{D,x}=-(${symbolic})v_x`,...wrapTex([`=-(${numeric})`,`\times(${texU(q.vx,'m/s')})`]),String.raw`=${tex(forces.drag[0])}\,\mathrm N`);}
 if(p.inverseSquare)lines.push(String.raw`r_\epsilon=\sqrt{r^2+\epsilon^2}`,String.raw`F_{g,x}=-m\mu x/r_\epsilon^3`,String.raw`=${tex(forces.attraction[0])}\,\mathrm N`);
 if(p.magnetic&&p.dimensions!=='1d')lines.push(String.raw`F_{B,x}=qBv_y=${tex(forces.magnetic[0])}\,\mathrm N`,String.raw`F_{B,y}=-qBv_x=${tex(forces.magnetic[1])}\,\mathrm N`);
 if(p.forceX||p.ramp||p.drive){const terms=[...(p.forceX?['F_x']:[]),...(p.ramp?['at']:[]),...(p.drive?[String.raw`F_d\cos\Omega t`]:[])];lines.push('F_{{app},x}='+terms.join('+'),String.raw`=${tex(forces.applied[0])}\,\mathrm N`);}
 return lines;
}
export const view={graphs,closeups,
 key:f=>f.closeup?(f.params.dimensions==='1d'?'Signed force \u00b7 arrows share one scale':'Arrow direction and magnitude, components below \u00b7 arrows share one scale'):'',
 closeupAnchors:s=>({force:s.zoomAnchor||{x:s.w/2,y:40}}),
 graphDescriptors(p){const w=Math.sqrt(Math.max(0,p.spring+3*p.cubic*p.x0*p.x0)/p.mass),window=Math.min(60,Math.max(.2,10*Math.PI/(p.drive?p.driveOmega:w||1))),n=p.dimensions==='1d'?1:p.dimensions==='2d'?2:3;return graphs.filter(g=>g.id!=='balance'||p.drive||p.ramp||p.forceX||p.forceY||p.forceZ||p.linearDrag||p.quadraticDrag).map(g=>({...g,...(!g.kind?{window}:{}),...(g.id==='motion'||g.id==='velocity'?{series:g.series.slice(0,n)}:{})}));},
 draw(s,f){
  const p=f.params,g=f.geometry,zoom=!!f.closeup;if(!f.thumbnail)pane.width=s.w;
  if(f.thumbnail){
   const bounds=motionBounds(p),wall=bounds[0]-(bounds[1]-bounds[0])*.22;bounds[0]=wall-.1;
   const m=fixedMap(s,bounds,{top:18,bottom:18,padding:18}),[x,y]=project(p,g.position),px=m.x(x),py=m.y(y);
   s.line(m.x(wall),py-18,m.x(wall),py+16,C.dim,3);s.line(m.x(wall),py+16,s.w-18,py+16,C.grid,1);
   s.spring(m.x(wall),py,px-9,py,C.dim,6);bead(s,px,py,10);return;
  }
  const goal=zoom?1:0,prior=zooms.get(s)??goal,mix=Math.abs(goal-prior)>1e-4?prior+(goal-prior)*.22:goal;zooms.set(s,mix);if(mix!==goal)s.animating=true;s.avoid=[];
  if(zoom){
   const forces=Object.entries(g.forces).filter(([,v])=>Math.hypot(...v)>1e-9),max=Math.max(1,...forces.map(([,v])=>Math.hypot(...v))),m=fixedMap(s,[-1.2,1.2,-.8,.8],{top:58,bottom:132,padding:40}),cx=m.x(0),cy=m.y(0),extent=Math.min(s.w*.26,(s.h-155)*.30),radius=17+11*mix;
   s.zoomAnchor={x:cx,y:Math.max(32,cy-65)};s.avoid=[{x:s.zoomAnchor.x-90,y:s.zoomAnchor.y-18,width:180,height:36},{x:cx-radius-5,y:cy-radius-5,width:2*radius+10,height:2*radius+10}];
   const zeroX=m.x(-project(p,g.position)[0]);s.line(24,cy+radius+12,s.w-24,cy+radius+12,C.grid,1);if(zeroX>=24&&zeroX<=s.w-24){s.line(zeroX,cy+radius+7,zeroX,cy+radius+18,C.dim,1);label(s,'x = 0',zeroX,cy+radius+34,C.dim,10);}
   forces.forEach(([name,v],i)=>{const q=project(p,v),tipX=cx+q[0]/max*extent,tipY=cy-q[1]/max*extent,color=[C.blue,C.gold,C.green,C.violet][i%4];s.arrow(cx,cy,tipX,tipY,color,2.5);tip(s,forceSymbols[name]+' = '+withUnit(p.dimensions==='1d'?v[0]:Math.hypot(...v),'N'),tipX,tipY,color);});
   bead(s,cx,cy,radius);s.avoid=[];
   if(!forces.length)label(s,'F = 0',s.w/2,cy-40,C.dim,12);
   return;
  }
  const bounds=motionBounds(p),spring=p.dimensions==='1d'&&!p.gravity&&p.spring,wall=spring?bounds[0]-(bounds[1]-bounds[0])*.22:0;
  if(spring)bounds[0]=wall-(bounds[1]-wall)*.05;
  const m=fixedMap(s,bounds,{bottom:108,top:45,padding:28}),[qx,qy]=project(p,g.position),px=m.x(qx),py=m.y(qy),o=project(p,[0,0,0]);
  const rest=project(p,[p.spring?p.forceX/p.spring:p.x0,p.y0,p.z0]);s.zoomAnchor={x:spring?(m.x(wall)+m.x(rest[0]))/2:m.x(rest[0]),y:Math.max(32,m.y(rest[1])-50)};const narrow=s.w<=440;s.ctx.font=(narrow?10:11)+'px system-ui,sans-serif';const chipW=s.ctx.measureText(closeups[0].label).width+(narrow?18:24)+10,chipX=Math.max(chipW/2+4,Math.min(s.w-chipW/2-4,s.zoomAnchor.x));// Chip box as the shell places it: centered on x, top edge at y.
  s.avoid=[{x:chipX-chipW/2,y:s.zoomAnchor.y-3,width:chipW,height:(narrow?24:32)+6}];
  s.ctx.setLineDash([3,5]);s.line(m.x(o[0]),m.y(o[1])-34,m.x(o[0]),m.y(o[1])+35,C.grid,1);s.ctx.setLineDash([]);
  if(p.dimensions==='1d'&&!p.gravity){s.line(22,m.y(0)+16,s.w-22,m.y(0)+16,C.grid,1);if(spring){s.line(m.x(wall),m.y(0)-20,m.x(wall),m.y(0)+16,C.dim,3);for(let i=-18;i<15;i+=8)s.line(m.x(wall)-7,m.y(0)+i+6,m.x(wall),m.y(0)+i,C.grid,1);s.spring(m.x(wall),m.y(0),px-9,py,C.dim,6);}s.ctx.font='10px system-ui,sans-serif';label(s,'x = 0',m.x(0)+s.ctx.measureText('x = 0').width/2+7,m.y(0)+33,C.dim,10);}
  const history=f.samples.filter(v=>v.t<=f.t+1e-8).slice(-360);if(history.length>1){s.ctx.beginPath();for(const [i,v] of history.entries()){const q=project(p,[v.x,v.y,v.z]);i?s.ctx.lineTo(m.x(q[0]),m.y(q[1])):s.ctx.moveTo(m.x(q[0]),m.y(q[1]));}s.ctx.strokeStyle='#8ab9ff55';s.ctx.lineWidth=1.8;s.ctx.stroke();}
  if(f.breakdown){
   // Same camera and ball as the scene: arrows only add to it, stacked when they share a line.
   const forces=Object.entries(g.forces).filter(([,v])=>Math.hypot(...v)>1e-9),max=Math.max(1,...forces.map(([,v])=>Math.hypot(...v))),extent=Math.min(s.w*.2,92),stack=p.dimensions==='1d'&&!p.gravity;
   if(stack)s.avoid.push({x:0,y:py-11,width:s.w,height:22}); // tip labels never sit on the spring or ball
   forces.forEach(([name,v],i)=>{const q=project(p,v),sy=py-(stack?18+i*16:0),tipX=Math.max(14,Math.min(s.w-14,px+q[0]/max*extent)),tipY=sy-q[1]/max*extent,color=[C.blue,C.gold,C.green,C.violet][i%4];s.arrow(px,sy,tipX,tipY,color,2.5);tip(s,forceSymbols[name]+' = '+withUnit(p.dimensions==='1d'?v[0]:Math.hypot(...v),'N'),tipX,tipY,color);});
   if(!forces.length)label(s,'F = 0',px,py-40,C.dim,12);
  }
  bead(s,px,py,10);if(p.dimensions!=='1d')label(s,p.dimensions==='3d'?'x / y / z "+BS+"u00b7 oblique projection':'x right "+BS+"u00b7 y up',s.w/2,25,C.dim,11);
  label(s,'x = '+withUnit(f.sample.x,'m')+'   v_{x} = '+withUnit(f.sample.vx,'m/s'),s.w/2,s.h-108,C.blue,11);
  const lawSize=s.w<360?11:12,law=forceLawLines(p,s.w,lawSize);law.forEach((line,i)=>label(s,line,s.w/2,s.h-82+i*15,C.dim,lawSize));
  if(f.breakdown&&p.constantRestoring)label(s,'F_{c}: constant-size restoring force, magnitude s',s.w/2,s.h-82+law.length*15+3,C.dim,s.w<360?10:11);
 },
 drawGraph(s,d,f){const y=d.id==='trajectory'?'y':'vx';linePlot(s,{title:d.label,points:f.samples,xkey:'x',ykey:y,cursor:f.sample,xlabel:'x / m',ylabel:y+(y==='y'?' / m':' / (m/s)'),color:C.blue});},
 equations(f){const p=f.params,a=f.geometry.acceleration,forces=f.geometry.forces;return [...forceEquations(f),String.raw`m\ddot{\mathbf r}=\sum\mathbf F`,...['x','y','z'].slice(0,f.geometry.dimensions).map((axis,i)=>String.raw`ma_${axis}=(${tex(p.mass)}\,\mathrm{kg})(${tex(a[i])}\,\mathrm{m/s^2})=${tex(Object.values(forces).reduce((sum,v)=>sum+v[i],0))}\,\mathrm{N}`),String.raw`E=K+U=${tex(f.sample.energy)}\,\mathrm J`,...(Math.abs(f.sample.work)>1e-8?[String.raw`W_{\rm drive}=${tex(f.sample.work)}\,\mathrm J`]:[]),...(Math.abs(f.sample.heat)>1e-8?[String.raw`Q_{\rm lost}=${tex(f.sample.heat)}\,\mathrm J`]:[])];},
 closeupEquation(f){return forceEquations(f);},
};
