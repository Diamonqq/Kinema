import {curveForces,speedLimits,trackPoint} from './model.js';
const blue='#8ab9ff',green='#b0c9ad',orange='#e9bb88',purple='#bcabef',muted='#8c9cb2',rad=Math.PI/180;
const fmt=n=>(Math.abs(n)<.005?0:n).toFixed(2);
export const closeups=[{id:'corner',label:'Zoom · bank forces'},{id:'grip',label:'Zoom · tyre grip'}];
export const graphs=[
 {id:'speed',label:'Speed · next corner limits',unit:'m/s',series:[{key:'speed',label:'v',color:blue},{key:'cornerMaxSpeed',label:'max',color:orange},{key:'cornerMinSpeed',label:'min',color:purple}]},
 {id:'grip',label:'Tyre forces',unit:'N',series:[{key:'lateralFriction',label:'side',color:green},{key:'longitudinalFriction',label:'drive',color:purple},{key:'frictionCapacity',label:'μN',color:orange}]},
 {id:'energy',label:'Energy ledger',unit:'J',series:[{key:'energy',label:'K',color:blue},{key:'dissipatedWork',label:'heat',color:orange},{key:'driveWork',label:'work',color:green}]},
 {id:'distance',label:'Distance travelled',unit:'m',series:[{key:'distance',label:'s',color:blue}]},
];
function world(s,bounds,top,bottom){
 const [a,b,c,d]=bounds,target={cx:(a+b)/2,cy:(c+d)/2,scale:Math.min((s.w-42)/(b-a),Math.max(30,bottom-top)/(d-c))};
 if(!s.camera||s.snap)s.camera={...target};else for(const k of ['cx','cy','scale'])s.camera[k]+=(target[k]-s.camera[k])*.22;s.snap=false;
 const v=s.camera;return {x:q=>s.w/2+(q-v.cx)*v.scale,y:q=>(top+bottom)/2-(q-v.cy)*v.scale,scale:v.scale};
}
function car(s,x,y,heading,scale,color=blue){
 const c=s.ctx;c.save();c.translate(x,y);c.rotate(-heading);const a=Math.max(14,4.5*scale),b=Math.max(6,1.8*scale);
 c.fillStyle=color+'40';c.strokeStyle=color;c.lineWidth=1.2;c.beginPath();c.roundRect(-a/2,-b/2,a,b,Math.min(a*.1,3));c.fill();c.stroke();c.fillStyle=color;c.fillRect(a*.15,-b*.38,a*.14,b*.76);c.restore();
}
function arrow(s,x,y,dx,dy,label,color){
 if(Math.hypot(dx,dy)<1.5)return;const tx=x+dx,ty=y-dy;s.arrow(x,y,tx,ty,color,2);
 s.text(label,tx+(dx>3?7:dx<-3?-7:0),ty+(dy>=0?-12:13),color,11,dx>3?'left':dx<-3?'right':'center');
}
// Keep every component rooted at contact; labels may move to the nearest
// clear tip position, with a leader if the first caption row is occupied.
function tipLabel(s,label,tx,ty,color){
 const c=s.ctx;c.font='11px system-ui,sans-serif';const width=c.measureText(label).width||label.length*6,height=12;
 const choices=[];for(const dy of [-14,16,-30,32,-46,48])for(const dx of [9,-9,0])choices.push({x:tx+dx,y:ty+dy,align:dx>0?'left':dx<0?'right':'center'});
 const fits=p=>{const left=p.x-(p.align==='right'?width:p.align==='center'?width/2:0),top=p.y-height/2;
  return left>=7&&left+width<=s.w-7&&top>=8&&top+height<=s.h-12&&!(s.labels||[]).some(a=>left<a.x+a.width+5&&left+width>a.x-5&&top<a.y+a.height+5&&top+height>a.y-5);};
 const p=choices.find(fits)||choices.at(-1);if(Math.hypot(p.x-tx,p.y-ty)>26)s.line(tx,ty,p.x,p.y,color+'70',.8);s.text(label,p.x,p.y,color,11,p.align);
}
function projection(s,x,y,dx,dy,label,color){
 if(Math.hypot(dx,dy)<1.5)return;
 s.ctx.setLineDash([4,4]);s.arrow(x,y,x+dx,y-dy,color,1.4);s.ctx.setLineDash([]);tipLabel(s,label,x+dx,y-dy,color);
}
export function bankSnapshot(f){return curveForces({...f.params,speed:f.sample.speed,radius:f.params.radius,bank:f.params.bank});}
function bank(s,f,box,components){
 const {x,y,w,h}=box,theta=f.params.bank*rad,c=Math.cos(theta),sn=Math.sin(theta),force=bankSnapshot(f),cx=x+w*.5,cy=y+h*.53,len=Math.min(w*.33,h*.39),k=len/Math.max(force.normal,f.params.mass*f.params.gravity,Math.abs(force.lateral),1);
 // +x points inward/right, road slopes down toward the centre. Normal points
 // inward/up; positive friction is down the road/inward, negative is uphill.
 const road=Math.min(w*.36,90);s.line(cx-road*c,cy-road*sn,cx+road*c,cy+road*sn,'#8191a7',3);s.line(cx-15,cy+7,cx+road+7,cy+7,'#405066',1);
 s.ctx.beginPath();s.ctx.arc(cx,cy,Math.min(33,road*.6),0,theta);s.ctx.strokeStyle=muted;s.ctx.lineWidth=1;s.ctx.stroke();s.text('θ',cx+41*Math.cos(theta/2),cy+41*Math.sin(theta/2)+5,muted,12);
 car(s,cx,cy-5,-theta,Math.min(w/40,7));
 arrow(s,cx,cy,force.normal*sn*k,force.normal*c*k,'N',blue);
 arrow(s,cx,cy,0,-f.params.mass*f.params.gravity*k,'mg',orange);
 arrow(s,cx,cy,force.lateral*c*k,-force.lateral*sn*k,'f',green);
 if(components){
  // Orthogonal projections and completion guides form the actual vector
  // rectangle, all at the same force scale and the same contact origin.
  const nx=force.normal*sn*k,ny=force.normal*c*k,fx=force.lateral*c*k,fy=-force.lateral*sn*k;
  s.ctx.setLineDash([2,4]);
  s.line(cx+nx,cy,cx+nx,cy-ny,blue+'60',1);s.line(cx,cy-ny,cx+nx,cy-ny,blue+'60',1);
  if(Math.hypot(fx,fy)>=1.5){s.line(cx+fx,cy,cx+fx,cy-fy,green+'60',1);s.line(cx,cy-fy,cx+fx,cy-fy,green+'60',1);}
  s.ctx.setLineDash([]);
  projection(s,cx,cy,nx,0,'N sin \u03b8',blue);
  projection(s,cx,cy,0,ny,'N cos \u03b8',blue);
  projection(s,cx,cy,fx,0,'f cos \u03b8',green);
  projection(s,cx,cy,0,fy,'\u2212f sin \u03b8',green);
 }
 return force;
}
function grip(s,f,box){
 const force=bankSnapshot(f),{x,y,w,h}=box,cx=x+w/2,cy=y+h/2,r=Math.min(w*.29,h*.33),extent=Math.max(force.capacity,Math.abs(force.lateral),Math.abs(f.params.drive),1),k=r/extent;
 s.line(cx-r-8,cy,cx+r+8,cy,'#425066',1);s.line(cx,cy-r-7,cx,cy+r+7,'#425066',1);
 s.ctx.strokeStyle=orange;s.ctx.lineWidth=1.5;s.ctx.beginPath();s.ctx.arc(cx,cy,force.capacity*k,0,2*Math.PI);s.ctx.stroke();
 const tx=cx+force.longitudinal*k,ty=cy-force.lateral*k;s.arrow(cx,cy,tx,ty,force.grip?green:'#e4a9bd',2);s.circle(tx,ty,3,green);
 s.ctx.strokeStyle=purple;s.ctx.beginPath();s.ctx.arc(cx+f.params.drive*k,ty,4,0,2*Math.PI);s.ctx.stroke();
 s.text('f∥',cx+r+10,cy,muted,11,'left');s.text('f⊥',cx,cy-r-16,muted,11);
 const radius=force.capacity*k,rx=cx-radius/Math.sqrt(2),ry=cy+radius/Math.sqrt(2);s.line(cx,cy,rx,ry,orange,1.2);tipLabel(s,'\u03bcN',rx,ry,orange);
 return force;
}
export const view={graphs,closeups,
 mount(shell){shell.q('.exp-transport').style.background='#191e26';shell.equations.style.paddingBottom='64px';shell.scene.style.minHeight='440px';},
 closeupAnchors(s,f){if(f.closeup)return {};if(f.breakdown)return {corner:{x:s.w*.3,y:s.h-96},grip:{x:s.w*.7,y:s.h-57}};const p=f.params,pad=Math.max(4,p.radius*.08),m=world(s,[-p.halfStraight-p.radius-pad,p.halfStraight+p.radius+pad,-p.radius-pad,p.radius+pad],56,s.h-132);return {corner:{x:m.x(p.halfStraight+p.radius),y:Math.min(s.h-96,m.y(0)+45)},grip:{x:m.x(f.geometry.position.x),y:Math.min(s.h-57,m.y(f.geometry.position.y)+80)}};},
 key:f=>f.closeup==='grip'?'Solid: actual tyre force · hollow: requested drive':f.closeup||f.breakdown?'Blue N · amber mg · green f · right is inward':'Oval centerline · tyre grip sets the corner limit',
 draw(s,f){
  const p=f.params,q=f.sample,narrow=s.w<440;
  if(f.breakdown||f.closeup){
   world(s,[-1,1,-1,1],40,s.h-40);
   if(f.closeup==='grip'){
    s.text('Turning and braking share grip',s.w/2,49,muted,narrow?11:13);grip(s,f,{x:20,y:65,w:s.w-40,h:s.h-128});
   }else if(f.closeup==='corner'){
    s.text('Bank cross-section · looking forward',s.w/2,49,muted,narrow?10:12);bank(s,f,{x:18,y:65,w:s.w-36,h:s.h-130},true);
   }else if(narrow){
    s.text('Corner cross-section',s.w/2,26,muted,11);bank(s,f,{x:6,y:38,w:s.w-12,h:160},true);
    grip(s,f,{x:35,y:232,w:s.w-70,h:90});
   }else{
    s.text('Corner cross-section',s.w*.27,36,muted,12);s.text('Friction circle',s.w*.76,36,muted,12);
    bank(s,f,{x:10,y:54,w:s.w*.52,h:s.h-184},true);grip(s,f,{x:s.w*.54,y:54,w:s.w*.42,h:s.h-184});
   }
   return;
  }
  const R=p.radius,L=p.halfStraight,pad=Math.max(4,R*.08),thumb=f.thumbnail===true,m=world(s,[-L-R-pad,L+R+pad,-R-pad,R+pad],thumb?12:56,thumb?s.h-12:s.h-132),length=4*L+2*Math.PI*R,c=s.ctx;
  c.beginPath();for(let j=0;j<=240;j++){const a=trackPoint(length*j/240,p);j?c.lineTo(m.x(a.x),m.y(a.y)):c.moveTo(m.x(a.x),m.y(a.y));}
  c.strokeStyle='#28394e';c.lineWidth=Math.max(2,Math.min(9,4*m.scale));c.stroke();c.strokeStyle='#60748e';c.lineWidth=1;c.setLineDash([3,5]);c.stroke();c.setLineDash([]);
  s.line(m.x(0),m.y(-R)-6,m.x(0),m.y(-R)+6,'#b1c3db',2);
  const point=f.geometry.position;car(s,m.x(point.x),m.y(point.y),f.geometry.heading,m.scale,q.lostGrip?'#e4a9bd':blue);s.circle(m.x(point.x),m.y(point.y),5,blue+'25');
  if(!thumb)s.text(q.lostGrip?'Grip exceeded · change setup':`${fmt(q.speed)} m/s · lap ${q.laps+1}`,s.w/2,29,q.lostGrip?'#e4a9bd':muted,narrow?11:13);
 },
 equations(f){const p=f.params,force=bankSnapshot(f),theta=p.bank;return [
  String.raw`N\sin\theta+f\cos\theta=\frac{mv^2}{r}`,
  String.raw`${fmt(force.normal)}\sin ${theta}^\circ`,
  String.raw`+(${fmt(force.lateral)})\cos ${theta}^\circ`,
  String.raw`=${fmt(p.mass*f.sample.speed**2/p.radius)}\,\mathrm{N}`,
  String.raw`N\cos\theta-f\sin\theta=mg`,
  String.raw`${fmt(force.normal)}\cos ${theta}^\circ`,
  String.raw`-(${fmt(force.lateral)})\sin ${theta}^\circ`,
  String.raw`=${fmt(p.mass*p.gravity)}\,\mathrm{N}`,
  String.raw`f_\parallel^2+f_\perp^2\le(\mu N)^2`,
 ];},
 closeupEquation(f){const p=f.params,a=bankSnapshot(f),limit=speedLimits(p);
  if(f.closeup==='grip')return [String.raw`f_\parallel^2+f_\perp^2\le(\mu N)^2`,String.raw`f_\perp=${fmt(a.lateral)}\,\mathrm{N}`,String.raw`f_\parallel=${fmt(a.longitudinal)}\,\mathrm{N}`,String.raw`\mu N=${fmt(a.capacity)}\,\mathrm{N}`];
  return [String.raw`N=m(g\cos\theta+\tfrac{v^2}{r}\sin\theta)`,String.raw`N=${fmt(a.normal)}\,\mathrm{N}`,String.raw`f=m(\tfrac{v^2}{r}\cos\theta-g\sin\theta)`,String.raw`f=${fmt(a.lateral)}\,\mathrm{N}`,String.raw`v_{\max}=${fmt(limit.maxSpeed)}\,\mathrm{m/s}`];
 },
};
