import {curveForces,speedLimits,trackPoint,model} from './model.js';
import {easeCamera} from '../kit/stage.js';
import {num,texNum} from '../kit/format.js';
const blue='#8ab9ff',green='#b0c9ad',orange='#e9bb88',purple='#bcabef',muted='#8c9cb2',rad=Math.PI/180;

const forceValue=n=>String.raw`${texNum(Math.abs(n)>=1000?n/1000:n)}\,\mathrm{${Math.abs(n)>=1000?'kN':'N'}}`;
export const closeups=[{id:'corner',label:'Zoom · bank forces'},{id:'grip',label:'Zoom · tire grip'}];
// The first two open by default: the ones that change on the default lap.
export const graphs=[
 {id:'grip',label:'Tire forces',unit:'N',series:[{key:'lateralFriction',label:'f⊥',color:green},{key:'longitudinalFriction',label:'f∥',color:purple},{key:'frictionCapacity',label:'μN',color:orange}]},
 {id:'distance',label:'Distance traveled',unit:'m',series:[{key:'distance',label:'s',color:blue}]},
 {id:'speed',label:'Speed · next corner limits',unit:'m/s',series:[{key:'speed',label:'v',color:blue},{key:'cornerMaxSpeed',label:'max',color:orange},{key:'cornerMinSpeed',label:'min',color:purple}]},
 {id:'energy',label:'Energy ledger',unit:'J',series:[{key:'energy',label:'K',color:blue},{key:'dissipatedWork',label:'D',color:orange},{key:'driveWork',label:'W',color:green}]},
];
function world(s,bounds,top,bottom){
 const [a,b,c,d]=bounds,target={cx:(a+b)/2,cy:(c+d)/2,scale:Math.min((s.w-42)/(b-a),Math.max(30,bottom-top)/(d-c))};
 if(!s.camera||s.snap)s.camera={...target};else if(easeCamera(s.camera,target))s.animating=true;s.snap=false;
 const v=s.camera;return {x:q=>s.w/2+(q-v.cx)*v.scale,y:q=>(top+bottom)/2-(q-v.cy)*v.scale,scale:v.scale};
}
function car(s,x,y,heading,scale,color=blue){
 const c=s.ctx;c.save();c.translate(x,y);c.rotate(-heading);const a=Math.max(14,4.5*scale),b=Math.max(6,1.8*scale);
 c.fillStyle=color+'40';c.strokeStyle=color;c.lineWidth=1.2;c.beginPath();c.roundRect(-a/2,-b/2,a,b,Math.min(a*.1,3));c.fill();c.stroke();c.fillStyle=color;c.fillRect(a*.15,-b*.38,a*.14,b*.76);c.restore();
}
// Vectors keep their true proportion; one too short to read is neither labeled nor drawn (its value stays in the equations).
const MIN_ARROW=14;
// Friction alone is drawn at its true, short length down to MIN_FRICTION so the cross-section agrees with the equations.
const MIN_FRICTION=4;
function arrow(s,x,y,dx,dy,label,color,min=MIN_ARROW,away){
 if(Math.hypot(dx,dy)<min)return;const tx=x+dx,ty=y-dy;s.arrow(x,y,tx,ty,color,2);
 if(away){s.text(label,tx+away[0],ty+away[1],color,11);return;}
 tipLabel(s,label,tx,ty,color);
}
// Keep every component rooted at contact; labels may move to the nearest
// clear tip position, with a leader if the first caption row is occupied.
function tipLabel(s,label,tx,ty,color){
 const c=s.ctx;c.font='11px system-ui,sans-serif';const width=c.measureText(label).width||label.length*6,height=12;
 const choices=[];for(const dy of [-14,16,-30,32,-46,48])for(const dx of [9,-9,0])choices.push({x:tx+dx,y:ty+dy,align:dx>0?'left':dx<0?'right':'center'});
 const fits=p=>{const left=p.x-(p.align==='right'?width:p.align==='center'?width/2:0),top=p.y-height/2;
  return left>=7&&left+width<=s.w-7&&top>=8&&top+height<=s.h-12&&![...(s.labels||[]),...(s.forceLabelObstacle?[s.forceLabelObstacle]:[])].some(a=>left<a.x+a.width+5&&left+width>a.x-5&&top<a.y+a.height+5&&top+height>a.y-5);};
 const p=choices.find(fits)||choices.at(-1);if(Math.hypot(p.x-tx,p.y-ty)>26)s.line(tx,ty,p.x,p.y,color+'70',.8);s.text(label,p.x,p.y,color,11,p.align);
}
function projection(s,x,y,dx,dy,label,color){
 if(Math.hypot(dx,dy)<MIN_ARROW)return;
 s.ctx.setLineDash([4,4]);s.arrow(x,y,x+dx,y-dy,color,1.4);s.ctx.setLineDash([]);tipLabel(s,label,x+dx,y-dy,color);
}
// One fixed corner state: the speed at corner entry, independent of the transport time.
const entryCache=new Map();
export function cornerSpeed(p){
 const key=JSON.stringify(p);if(entryCache.has(key))return entryCache.get(key);
 let v=p.speed;
 if(p.halfStraight>0){const i=model.create(p);let prev=i.sample();for(let n=0;n<4000;n++){i.step(.05);const q=i.sample();if(q.distance>=p.halfStraight){v=prev.speed+(q.speed-prev.speed)*(p.halfStraight-prev.distance)/Math.max(1e-9,q.distance-prev.distance);break;}if(q.lostGrip||q.speed<=0){v=q.speed;break;}prev=q;}}
 if(entryCache.size>30)entryCache.delete(entryCache.keys().next().value);entryCache.set(key,v);return v;
}
export function bankSnapshot(f){return curveForces({...f.params,speed:cornerSpeed(f.params),radius:f.params.radius,bank:f.params.bank});}
// The live state at the transport time: on a straight the road is flat and f⊥ is zero.
export function liveSnapshot(f){const p=f.params,point=trackPoint(f.sample.distance,p);return curveForces({...p,speed:f.sample.speed,radius:point.curvature?p.radius:Infinity,bank:point.curvature?p.bank:0});}
let drawnForces=new Set(['N','mg','f']),gripTire=true;
function bank(s,f,box,components){
 const {x,y,w,h}=box,theta=f.params.bank*rad,c=Math.cos(theta),sn=Math.sin(theta),force=bankSnapshot(f),cx=x+w*.5,cy=y+h*.53,len=Math.min(w*.33,h*.39),k=len/Math.max(force.normal,f.params.mass*f.params.gravity,Math.abs(force.lateral),1);
 // +x points inward/right, road slopes down toward the centre. Normal points
 // inward/up; positive friction is down the road/inward, negative is uphill.
 s.forceLabelObstacle={x:cx-24,y:cy-16,width:48,height:24};const road=Math.min(w*.36,90);s.line(cx-road*c,cy-road*sn,cx+road*c,cy+road*sn,'#8191a7',3);s.line(cx,cy,cx+road+7,cy,'#405066',1);
 if(f.params.bank>=10){const arc=Math.min(65,road*.8),labelR=arc*.72;s.ctx.beginPath();s.ctx.arc(cx,cy,arc,0,theta);s.ctx.strokeStyle=muted;s.ctx.lineWidth=1;s.ctx.stroke();s.text('\u03b8',cx+labelR*Math.cos(theta/2),cy+labelR*Math.sin(theta/2),muted,10);}
 car(s,cx,cy-5,-theta,Math.min(w/28,10));
 arrow(s,cx,cy,force.normal*sn*k,force.normal*c*k,'N',blue);
 arrow(s,cx,cy,0,-f.params.mass*f.params.gravity*k,'mg',orange);
 // f sits just past its own tip, on the road's far side from N: along the slope, then into the ground.
 const fs=Math.sign(force.lateral)||1;
 arrow(s,cx,cy,force.lateral*c*k,-force.lateral*sn*k,'f',green,MIN_FRICTION,[fs*16*c-sn*14,fs*16*sn+c*14]);
 drawnForces=new Set(['N','mg']);if(Math.abs(force.lateral)*k>=MIN_FRICTION)drawnForces.add('f');
 if(components&&f.params.bank>=1){
  // Orthogonal projections and completion guides form the actual vector
  // rectangle, all at the same force scale and the same contact origin.
  const nx=force.normal*sn*k,ny=force.normal*c*k,fx=force.lateral*c*k,fy=-force.lateral*sn*k;
  s.ctx.setLineDash([2,4]);
  if(Math.abs(nx)>=MIN_ARROW){s.line(cx+nx,cy,cx+nx,cy-ny,blue+'60',1);s.line(cx,cy-ny,cx+nx,cy-ny,blue+'60',1);}
  if(Math.hypot(fx,fy)>=MIN_ARROW){s.line(cx+fx,cy,cx+fx,cy-fy,green+'60',1);s.line(cx,cy-fy,cx+fx,cy-fy,green+'60',1);}
  s.ctx.setLineDash([]);
  projection(s,cx,cy,nx,0,'N sin \u03b8',blue);
  projection(s,cx,cy,0,ny,'N cos \u03b8',blue);
  projection(s,cx,cy,fx,0,'f cos \u03b8',green);
  projection(s,cx,cy,0,fy,'\u2212f sin \u03b8',green);
 }
 s.forceLabelObstacle=null;return force;
}
function grip(s,f,box){
 const force=liveSnapshot(f),{x,y,w,h}=box,cx=x+w/2,cy=y+h/2,r=Math.min(w*.29,h*.33),extent=Math.max(force.capacity,Math.abs(force.lateral),Math.abs(f.params.drive),1),k=r/extent;
 s.line(cx-r-8,cy,cx+r+8,cy,'#425066',1);s.line(cx,cy-r-7,cx,cy+r+7,'#425066',1);
 s.ctx.strokeStyle=orange;s.ctx.lineWidth=1.5;s.ctx.beginPath();s.ctx.arc(cx,cy,force.capacity*k,0,2*Math.PI);s.ctx.stroke();
 const tx=cx+force.longitudinal*k,ty=cy-force.lateral*k;gripTire=Math.hypot(tx-cx,ty-cy)>=MIN_FRICTION;if(gripTire){s.arrow(cx,cy,tx,ty,force.grip?green:'#e4a9bd',2);s.circle(tx,ty,3,green);}
 if(Math.abs(f.params.drive-force.longitudinal)>1){s.ctx.strokeStyle=purple;s.ctx.beginPath();s.ctx.arc(cx+f.params.drive*k,ty,4,0,2*Math.PI);s.ctx.stroke();}
 s.text('f∥',cx+r+10,cy,muted,11,'left');s.text('f⊥',cx,cy-r-16,muted,11);
 const radius=force.capacity*k,rx=cx-radius/Math.sqrt(2),ry=cy+radius/Math.sqrt(2);s.line(cx,cy,rx,ry,orange,1.2);if(radius>2)s.text('\u03bcN',rx-4,ry+12,orange,11,'right');
 return force;
}
export const view={graphs,closeups,
 graphDescriptors:p=>graphs.map(g=>({...g,window:Math.max(5,(4*p.halfStraight+2*Math.PI*p.radius)/Math.max(1,p.speed))})),
 mount(shell){shell.q('.exp-transport').style.background='#191e26';shell.equations.style.paddingBottom='64px';shell.scene.style.minHeight='440px';},
 closeupAnchors(s,f){if(f.closeup)return {};if(f.breakdown){const narrow=s.w<440;return {corner:narrow?{x:80,y:184}:{x:s.w*.27-110,y:54+(s.h-184)*.53+52},grip:{x:s.w*.73,y:s.h-86}};}const p=f.params,pad=Math.max(4,p.radius*.08),m=world(s,[-p.halfStraight-p.radius-pad,p.halfStraight+p.radius+pad,-p.radius-pad,p.radius+pad],100,s.h-132);return {corner:{x:m.x(p.halfStraight+p.radius)-78,y:m.y(0)},grip:{x:m.x(0),y:m.y(-p.radius)+52}};},
 key:f=>f.closeup==='grip'?(Math.abs(f.params.drive-liveSnapshot(f).longitudinal)>1?(gripTire?'Solid: tire force \u00b7 hollow: requested drive':'Hollow: requested drive \u00b7 radius: \u03bcN'):gripTire?'Solid: tire force \u00b7 radius: \u03bcN':'Radius: \u03bcN'):f.closeup||f.breakdown?'Blue N · amber mg'+(drawnForces.has('f')?' · green f':'')+' · right is inward':'Track centerline · tire grip sets the corner limit',
 draw(s,f){
  const p=f.params,q=f.sample,narrow=s.w<440;
  if(f.breakdown||f.closeup){
   world(s,[-1,1,-1,1],40,s.h-40);
   if(f.closeup==='grip'){
    s.text('Turning and braking share grip',s.w/2,49,muted,narrow?11:13);grip(s,f,{x:20,y:65,w:s.w-40,h:s.h-128});
   }else if(f.closeup==='corner'){
    s.text('Bank cross-section · looking forward',s.w/2,49,muted,narrow?10:12);bank(s,f,{x:18,y:65,w:s.w-36,h:s.h-130},true);
   }else if(narrow){
    s.text('In the corner',s.w/2,26,muted,11);bank(s,f,{x:6,y:38,w:s.w-12,h:160},true);
    s.text('Now',s.w/2,226,muted,11);grip(s,f,{x:35,y:251,w:s.w-70,h:90});
   }else{
    s.text('In the corner',s.w*.27,36,muted,12);s.text('Now',s.w*.76,36,muted,12);
    bank(s,f,{x:10,y:54,w:s.w*.52,h:s.h-184},true);grip(s,f,{x:s.w*.54,y:54,w:s.w*.42,h:s.h-184});
   }
   return;
  }
  const R=p.radius,L=p.halfStraight,pad=Math.max(4,R*.08),thumb=f.thumbnail===true,m=world(s,[-L-R-pad,L+R+pad,-R-pad,R+pad],thumb?12:100,thumb?s.h-12:s.h-132),length=4*L+2*Math.PI*R,c=s.ctx;
  c.beginPath();for(let j=0;j<=240;j++){const a=trackPoint(length*j/240,p);j?c.lineTo(m.x(a.x),m.y(a.y)):c.moveTo(m.x(a.x),m.y(a.y));}
  c.strokeStyle='#28394e';c.lineWidth=Math.max(2,Math.min(9,4*m.scale));c.stroke();c.strokeStyle='#60748e';c.lineWidth=1;c.setLineDash([3,5]);c.stroke();c.setLineDash([]);
  s.line(m.x(0),m.y(-R)-6,m.x(0),m.y(-R)+6,'#b1c3db',2);
  const point=f.geometry.position;const carColor=q.lostGrip?'#e4a9bd':blue;if(!thumb){s.circle(m.x(point.x),m.y(point.y),16,carColor+'18');c.beginPath();c.arc(m.x(point.x),m.y(point.y),16,0,2*Math.PI);c.strokeStyle=carColor+'70';c.lineWidth=1;c.stroke();}
  car(s,m.x(point.x),m.y(point.y),f.geometry.heading,m.scale,carColor);
  if(!thumb)s.text(q.lostGrip?'Grip exceeded · change setup':`${num(q.speed)} m/s · lap ${q.laps+1}`,s.w/2,29,q.lostGrip?'#e4a9bd':muted,narrow?11:13);
 },
 equations(f){const p=f.params,a=bankSnapshot(f),live=liveSnapshot(f);return [
  String.raw`N\sin\theta+f\cos\theta=\frac{mv^2}{r}`,
  String.raw`N=${forceValue(a.normal)},\quad f=${forceValue(a.lateral)}`,
  String.raw`F_{\rm in}=${forceValue(p.mass*cornerSpeed(p)**2/p.radius)}`,
  String.raw`N\cos\theta-f\sin\theta=mg`,
  String.raw`F_y=${forceValue(p.mass*p.gravity)}`,
  String.raw`f_\parallel^2+f_\perp^2\le(\mu N)^2`,
  String.raw`\mu N=${forceValue(live.capacity)}`,
 ];},
 closeupEquation(f){const p=f.params,a=bankSnapshot(f),live=liveSnapshot(f),limit=speedLimits(p);
  if(f.closeup==='grip')return [String.raw`f_\parallel^2+f_\perp^2\le(\mu N)^2`,String.raw`f_\perp=${forceValue(live.lateral)}`,String.raw`f_\parallel=${forceValue(live.longitudinal)}`,String.raw`\mu N=${forceValue(live.capacity)}`];
  return [String.raw`N=m(g\cos\theta+\tfrac{v^2}{r}\sin\theta)`,String.raw`N=${forceValue(a.normal)}`,String.raw`f=m(\tfrac{v^2}{r}\cos\theta-g\sin\theta)`,String.raw`f=${forceValue(a.lateral)}`,String.raw`v_{\max}=${texNum(limit.maxSpeed)}\,\mathrm{m/s}`];
 },
};
