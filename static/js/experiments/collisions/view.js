import {num as fmt,texNum as tex} from '../kit/format.js';
import {runBatches} from '../orbits/work.js';
import {model,interactionAt,scatteringCurve,differentialCrossSection} from './model.js';
import {C,camera,linePath,boundsFor,forecast,chipAnchors,title,vector,plot,label,targetChips,sceneHeight} from '../orbits/scene.js';
export const graphs=[
 {id:'motion',label:'Separation',unit:'m',series:[{key:'separation',label:'r',color:C.blue}]},
 {id:'energy',label:'Energy',unit:'J',series:[{key:'kinetic',label:'K',color:C.blue},{key:'potential',label:'U',color:C.green},{key:'dissipated',label:'Q',color:C.purple},{key:'accountedEnergy',label:'E + Q',color:C.amber}]},
 {id:'momentum',label:'Total momentum',unit:'kg m/s',series:[{key:'px',label:'Px',color:C.blue},{key:'py',label:'Py',color:C.amber}]},
 {id:'phase',label:'Radial phase space',unit:'m · m/s',kind:'phase',series:[{key:'separation',label:'r'},{key:'radialSpeed',label:'dr/dt'}]},
 {id:'potential',label:'Effective potential',unit:'r (m), U (J)',kind:'custom'},
 {id:'scattering',label:'Scattering',unit:'b (m), θ (rad)',kind:'custom'},
 {id:'cross-section',label:'Cross section',unit:'θ (rad), m²/sr',kind:'custom'},
];
export const closeups=[{id:'contact',label:'Zoom · encounter'},{id:'momentum',label:'Zoom · momenta'},
 {id:'potential',label:'Zoom · potential'},{id:'scattering',label:'Zoom · scattering'},{id:'cross-section',label:'Zoom · cross section'}];
const curves=new WeakMap();
const shells=new WeakMap(),parameterShells=new WeakMap();
function curveLifecycle(f){
 const shell=parameterShells.get(f.params);
 return {signal:f.signal,invalidate:f.invalidate,active:()=>!shell||!shell.destroyed&&(shell.closeup==='scattering'||shell.closeup==='cross-section'||!shell.q('.exp-graph-panel').hidden&&['scattering','cross-section'].some(id=>shell.enabledGraphs.has(id)))};
}
export const durationFor=p=>Math.round(Math.min(60,Math.max(8,2.4*p.distance/Math.max(.1,Math.abs(p.speed-p.targetSpeed))))*100)/100;
const trajectory=(p,f={})=>forecast(model,p,{duration:durationFor(p),signal:f.signal,invalidate:f.invalidate});
const windows=new WeakMap();
// Only the shell's presentation model ends at the encounter window. The
// exported physics core remains available for arbitrarily long analytic tests.
export const timelineModel={...model,create(values){
 const sim=model.create(values),end=durationFor({...Object.fromEntries(model.params.map(p=>[p.key,p.value])),...values});
 return {...sim,get t(){return sim.t;},step(dt){sim.step(Math.max(0,Math.min(dt,end-sim.t)));},
  sample(){return {...sim.sample(),ended:sim.t>=end-1e-9};}};
}};
export function transportWindow(shell){
 const duration=durationFor(shell.params),previous=windows.get(shell);
 if(previous?.params===shell.params){shell.duration=duration;shell.q('.exp-time').max=duration;return;}
 windows.set(shell,{params:shell.params,duration});
 shell.startForecast(); // The kit resets duration here; apply ours afterwards.
 shell.duration=duration;shell.q('.exp-time').max=duration;
}
export function scatteringGrid(p){
 const max=Math.min(9.96,Math.max(p.radius*1.4,Math.abs(p.b)*2,p.range*3));
 if(p.interaction==='hard')return [...Array.from({length:83},(_,i)=>p.radius*(.09+i*.01)),
  ...[.95,.975,.99,.995].map(f=>p.radius*f),...Array.from({length:20},(_,i)=>p.radius*1.01+(max+.04-p.radius*1.01)*i/19)];
 return Array.from({length:41},(_,i)=>.04+max*i/40);
}
export function sectionPoints(params,points){
 if(points.length<3)return [];
 return differentialCrossSection(points).filter(p=>p.available&&(params.interaction!=='hard'||p.b>=params.radius*.1-1e-10&&p.b<=params.radius*.9+1e-10));
}
export function curveFor(params,lifecycle={}){
 let state=curves.get(params);if(state&&!state.cancelled&&state.signal===lifecycle.signal)return state;
 state?.cancel?.();const grid=scatteringGrid(params);
 state={points:[],done:false,total:grid.length};curves.set(params,state);
 function* batches(){let points=[];for(let i=0;i<grid.length;i++){
  points=[...points,...scatteringCurve(params,[grid[i]],{duration:60,dt:.2})];
  yield {points,done:i===grid.length-1};
 }}
 return runBatches(batches(),state,lifecycle);
}
const panelCache=new WeakMap(),obstacleCache=new WeakMap();

export function impactCaption(panel,initial,b){
 const {rect,map}=panel,text='b = '+fmt(b)+' m',width=text.length*6.5;
 const bar={x:Math.max(rect.x+12,map.x(initial[0].x)-9),y:Math.min(map.y(initial[0].y),map.y(initial[1].y)),bottom:Math.max(map.y(initial[0].y),map.y(initial[1].y))};
 return {text,x:Math.max(rect.x+width/2+6,Math.min(rect.x+rect.w-width/2-6,bar.x)),y:Math.max(rect.y+12,bar.y-18),width,bar};
}
export function comparisonPanels(s,rows){
 const key=s.w+':'+s.h,cached=panelCache.get(rows);if(cached?.key===key)return cached.panes;
 const narrow=s.w<460,top=150,height=s.h-top-90,gap=52;
 const rects=narrow?
  [{x:5,y:top,w:s.w-10,h:(height-gap)/2},{x:5,y:top+(height+gap)/2,w:s.w-10,h:(height-gap)/2}]:
  [{x:5,y:top,w:s.w/2-12,h:height},{x:s.w/2+7,y:top,w:s.w/2-12,h:height}];
 const bounds=['lab','cm'].map(frame=>boundsFor(rows,frame));
 const scale=Math.min(...rects.map((r,i)=>Math.min((r.w-40)/Math.max(.01,bounds[i][1]-bounds[i][0]),(r.h-40)/Math.max(.01,bounds[i][3]-bounds[i][2]))));
 const panes=rects.map((rect,i)=>{const [xmin,xmax,ymin,ymax]=bounds[i];return {rect,map:{
  x:v=>rect.x+rect.w/2+(v-(xmin+xmax)/2)*scale,
  y:v=>rect.y+rect.h/2-(v-(ymin+ymax)/2)*scale,scale}};});
 panelCache.set(rows,{key,panes});return panes;
}
function momentum(s,f,data){
 title(s,'Momentum adds head to tail');if(!data.done){s.text('Preparing the comparison…',s.w/2,s.h/2,C.muted,12);return;}
 const before=data.rows[0],after=data.rows.find(p=>p.sample.contactCount>0&&p.sample.separation>f.params.radius*1.15)||data.rows.find(p=>p.t>1&&p.sample.separation>=before.sample.separation)||data.rows.at(-1);
 const rows=[before,after],frame=f.params.frame,width=s.w;
 const max=Math.max(1,...rows.flatMap(r=>r.geometry.frames[frame].map(b=>b.mass*Math.hypot(b.vx,b.vy)))),scale=Math.min(width*.23,75)/max;
 rows.forEach((row,i)=>{
  const y=105+i*Math.min(110,s.h-190),origin=width*.28,b=row.geometry.frames[frame],p1={x:b[0].mass*b[0].vx,y:b[0].mass*b[0].vy},p2={x:b[1].mass*b[1].vx,y:b[1].mass*b[1].vy};
  s.text(i?'After · '+fmt(row.t)+' s':'Before',width/2,y-34,C.muted,12);
  vector(s,origin,y,p1.x*scale,-p1.y*scale,C.blue,'p₁');
  vector(s,origin+p1.x*scale,y-p1.y*scale,p2.x*scale,-p2.y*scale,C.amber,'p₂');
  vector(s,origin,y+30,(p1.x+p2.x)*scale,-(p1.y+p2.y)*scale,C.green,'P');
  if(Math.hypot(p1.x+p2.x,p1.y+p2.y)<1e-10)s.text('P = 0',width*.7,y+30,C.green,12);
 });
 s.text(frame==='lab'?'Laboratory momenta':'CM momenta · equal and opposite',width/2,s.h-42,C.muted,12);
}
function potential(s,f){
 if(s.h>=220)title(s,'Radial energy and the interaction');const p=f.params,mu=p.m1*p.m2/(p.m1+p.m2),L=f.sample.angularMomentum,
  cmK=(p.m1+p.m2)*((p.m1*p.speed+p.m2*p.targetSpeed)/(p.m1+p.m2))**2/2,E=f.sample.energy-cmK;
 const hard=p.interaction==='hard'||p.secondInteraction==='hard',R=p.secondInteraction==='hard'?p.secondRange:p.radius,
  min=hard?R:Math.max(.04,Math.min(.5,f.sample.separation*.7)),max=Math.max(p.distance*1.4,p.range*4,R*3);
 const points=Array.from({length:160},(_,i)=>{const r=min+(max-min)*i/159;return {r,u:interactionAt(p,r).potential+L*L/(2*mu*r*r)};});
 plot(s,points,{xkey:'r',ykey:'u',energy:E,cursor:{x:Math.max(min,f.sample.separation)},label:'r (m) · Ueff (J)'+(hard?' · wall at R':'')});
}
const contactPreviews=new WeakMap();
// Hard contact is an event, not the nearest 0.1 s forecast sample.
export function encounterPreview(params,rows){
 if(contactPreviews.has(rows))return contactPreviews.get(rows);
 const nearest=rows.reduce((a,b)=>a.sample.separation<b.sample.separation?a:b);
 const event=rows.find(row=>row.geometry.contact)?.geometry.contact;
 if(params.interaction!=='hard'&&params.secondInteraction!=='hard'||!event)return nearest;
 const sim=model.create(params);sim.step(event.t);
 const geometry=sim.geometry(),sample=sim.sample(),R=params.secondInteraction==='hard'?params.secondRange:params.radius;
 // The event metadata is authoritative even when replay lands a few ulps on
 // the other side of the discontinuity. Retain the tangential velocity.
 const n=event.normal,u=geometry.relative,un=u.vx*n.x+u.vy*n.y;
 const after=-params.restitution*event.relativeNormalBefore,delta=after-un;
 u.x=R*n.x;u.y=R*n.y;u.vx+=delta*n.x;u.vy+=delta*n.y;
 for(const frame of ['lab','cm']){
  const cm=frame==='lab'?{x:-params.distance*params.m1/(params.m1+params.m2)+(params.m1*params.speed+params.m2*params.targetSpeed)/(params.m1+params.m2)*event.t,y:params.b*params.m1/(params.m1+params.m2)}:{x:0,y:0};
  geometry.frames[frame].forEach((b,i)=>{const f=i?-params.m1/(params.m1+params.m2):params.m2/(params.m1+params.m2);b.x=cm.x+f*u.x;b.y=cm.y+f*u.y;});
 }
 geometry.contact=event;sample.radialSpeed=after;sample.separation=R;
 sample.scatteringAngle=Math.atan2((Math.sign(params.speed-params.targetSpeed)||1)*u.vy,(Math.sign(params.speed-params.targetSpeed)||1)*u.vx);
 const preview={t:event.t,sample,geometry,impact:{before:event.relativeNormalBefore,after}};contactPreviews.set(rows,preview);return preview;
}
export function forecastObstacles(panes,rows){
 const cached=obstacleCache.get(panes);if(cached?.rows===rows)return cached.obstacles;
 const obstacles=[];
 for(const [i,frame] of ['lab','cm'].entries()){
  const {map,rect}=panes[i];obstacles.push({x:rect.x,y:rect.y-22,width:rect.w,height:46});
  for(const row of rows)for(const q of row.geometry.frames[frame]){
   const radius=Math.max(5,q.radius*map.scale);
   obstacles.push({x:map.x(q.x)-radius,y:map.y(q.y)-radius,width:2*radius,height:2*radius});
  }
 }
 const impact=impactCaption(panes[0],rows[0].geometry.frames.lab,rows[0].geometry.impactParameter);
 obstacles.push({x:impact.x-impact.width/2,y:impact.y-8,width:impact.width,height:16});
 obstacleCache.set(panes,{rows,obstacles});return obstacles;
}
function encounter(s,f,data){
 title(s,'The encounter · common physical scale');if(!data.done)return;
 const nearest=encounterPreview(f.params,data.rows),R=f.params.secondInteraction==='hard'?f.params.secondRange:f.params.radius,
   extent=Math.max(R*1.9,nearest.sample.separation*1.8,.4),g=f.geometry;
 const map=camera(s,[-extent,extent,-extent*.8,extent*.8],75,65),b=g.frames.cm;
 linePath(s,data.rows.filter(row=>row.sample.separation<extent*2.2).map(row=>row.geometry.frames.cm[0]),map,C.blue+'50');
 linePath(s,data.rows.filter(row=>row.sample.separation<extent*2.2).map(row=>row.geometry.frames.cm[1]),map,C.amber+'50');
 const visible=!nearest.impact&&b.every(q=>Math.abs(q.x)<extent&&Math.abs(q.y)<extent*.8);
 const active=visible?b:nearest.geometry.frames.cm;
 active.forEach((q,i)=>s.circle(map.x(q.x),map.y(q.y),['hard','soft'].includes(f.params.interaction)||['hard','soft'].includes(f.params.secondInteraction)?Math.max(2,q.radius*map.scale):5,i?C.amber:C.blue));
 const [a,z]=active,dx=z.x-a.x,dy=z.y-a.y,r=Math.hypot(dx,dy),F=interactionAt(f.params,r).force;
 s.line(map.x(a.x),map.y(a.y),map.x(z.x),map.y(z.y),C.muted,1);
 f.contactForceDrawn=Math.abs(F)>1e-7;
 if(f.contactForceDrawn)vector(s,map.x(a.x),map.y(a.y),-dx/r*Math.min(55,s.w*.16)*Math.sign(F),dy/r*Math.min(55,s.w*.16)*Math.sign(F),C.green,'F');
 const shown=visible?f.sample:nearest.sample,theta=shown.scatteringAngle,px=map.x(a.x),py=map.y(a.y),ray=Math.min(62,s.w*.2),sign=Math.sign(f.params.speed-f.params.targetSpeed)||1,start=sign>0?0:Math.PI;
 s.ctx.setLineDash([3,4]);s.line(px,py,px+sign*ray,py,C.muted,1);s.ctx.setLineDash([]);
 const disc=['hard','soft'].includes(f.params.interaction)||['hard','soft'].includes(f.params.secondInteraction)?Math.max(2,a.radius*map.scale):5;
 const ux=sign*Math.cos(theta),uy=-sign*Math.sin(theta);
 vector(s,px+ux*(disc+5),py+uy*(disc+5),ux*Math.min(ray,42),uy*Math.min(ray,42),C.blue,'u');
 if(Math.abs(theta)>.015){s.ctx.beginPath();s.ctx.arc(px,py,23,start,start-theta,theta>0);s.ctx.strokeStyle=C.purple;s.ctx.stroke();label(s,'θ',px+sign*34*Math.cos(theta/2),py-sign*34*Math.sin(theta/2),C.purple);}
 const spring=f.params.interaction==='soft'||f.params.secondInteraction==='soft';
 s.text(spring?'Spring contact \u00b7 discs show compression':visible?'Live \u00b7 t = '+fmt(f.t)+' s':(nearest.impact?'Contact preview \u00b7 ':'Closest approach \u00b7 ')+fmt(nearest.t)+' s',s.w/2,s.h-43,C.muted,12);
}
export const view={graphs,closeups,closeupAnchors:s=>s.targetAnchors||{},
 mount(shell){shells.set(shell.stage,shell);shell.model=timelineModel;transportWindow(shell);},
 graphDescriptors:p=>graphs.map(g=>({...g,window:durationFor(p)})),
 paramVisible(d,p){const k=d.key,kind=p.interaction,second=p.secondInteraction;
  if(k==='secondInteraction')return kind==='coulomb';if(k.startsWith('second')){
   if(kind!=='coulomb'||second==='none')return false;if(k==='secondStrength')return ['yukawa','woods-saxon'].includes(second);
   if(k==='secondDiffuseness')return second==='woods-saxon';if(k==='secondStiffness')return second==='soft';return true;}
  if(k==='radius')return ['hard','soft'].includes(kind);if(k==='stiffness')return kind==='soft';
  if(k==='restitution')return kind==='hard'||kind==='coulomb'&&second==='hard';
  if(k==='strength'||k==='range')return !['hard','soft'].includes(kind);if(k==='diffuseness')return kind==='woods-saxon';if(k==='power')return kind==='power';return true;},
 drawGraph(s,d,f){
  if(d.id==='potential'){potential(s,f);return;}
  const curve=curveFor(f.params,curveLifecycle(f)),cross=d.id==='cross-section';
  const points=cross?sectionPoints(f.params,curve.points).map(p=>({x:p.angle,y:p.sigma})):curve.points.filter(p=>p.complete).map(p=>({x:p.b,y:Math.abs(p.angle)}));
  plot(s,points,{zero:cross,cursor:cross?null:{x:Math.abs(f.params.b),y:Math.abs(f.sample.scatteringAngle)}});
 },
 key:f=>f.closeup==='momentum'?'Blue p₁ · amber p₂ · green total P':f.closeup==='potential'?'Blue Ueff · amber relative E · white r':
  f.closeup==='scattering'?'Finite-start scattering · only completed encounters':f.closeup==='contact'?('Blue projectile \u00b7 amber target \u00b7 '+(f.contactForceDrawn?'green F':'blue u')):'Blue projectile · amber target · + CM',
 draw(s,f){
  const owner=shells.get(s);if(owner){parameterShells.set(f.params,owner);sceneHeight(owner,620,!!f.closeup);}s.chipRects=[];s.pathObstacles=[];s.physicsSegments=[];s.labelObstacles=[];
  if(s.h<200){const b=f.geometry.frames.lab,bounds=boundsFor([{geometry:f.geometry}],'lab'),map=camera(s,bounds,12,12);
   s.ctx.setLineDash([3,5]);s.line(map.x(b[0].x),map.y(b[0].y),map.x(b[1].x),map.y(b[0].y),C.muted);s.line(map.x(b[0].x),map.y(b[1].y),map.x(b[1].x),map.y(b[1].y),C.amber);s.ctx.setLineDash([]);
   b.forEach((q,i)=>s.circle(map.x(q.x),map.y(q.y),Math.max(3,q.radius*map.scale),i?C.amber:C.blue));return;
  }
  const shell=shells.get(s);if(shell)transportWindow(shell);
  const data=trajectory(f.params,f),g=f.geometry;
  if(f.closeup==='momentum'){momentum(s,f,data);return;}
  if(f.closeup==='potential'){potential(s,f);return;}
  if(f.closeup==='contact'){encounter(s,f,data);return;}
  if(f.closeup==='scattering'||f.closeup==='cross-section'){
   const cross=f.closeup==='cross-section';title(s,cross?'Classical differential cross section':'Scattering and the impact parameter');const curve=curveFor(f.params,curveLifecycle(f));
   const points=cross?sectionPoints(f.params,curve.points).map(p=>({x:p.angle,y:p.sigma})):curve.points.filter(p=>p.complete).map(p=>({x:p.b,y:Math.abs(p.angle)}));
   plot(s,points,{zero:cross,label:cross?'|θCM| (rad) · dσ/dΩ (m²/sr)':'Initial b (m) · |θCM| (rad)',cursor:cross?null:{x:Math.abs(f.params.b),y:Math.abs(f.sample.scatteringAngle)}});
   if(!curve.done)s.text('Computing '+curve.points.length+' / '+curve.total,s.w/2,70,C.muted,11);return;
  }
  if(!data.done){s.text(data.error||'Preparing the fixed 60 s motion window…',s.w/2,s.h*.55,C.muted,s.w<380?11:13);return;}
  const panes=comparisonPanels(s,data.rows),first=data.rows[0].geometry.frames.lab,nearest=data.rows.reduce((a,b)=>a.sample.separation<b.sample.separation?a:b).geometry.frames.lab;
  const impact=impactCaption(panes[0],first,f.params.b);
  const start=first[0],encounterPoint={x:(nearest[0].x+nearest[1].x)/2,y:(nearest[0].y+nearest[1].y)/2},lab=panes[0].map;
  s.pathObstacles=forecastObstacles(panes,data.rows);
  targetChips(s,{contact:{x:lab.x(encounterPoint.x),y:lab.y(encounterPoint.y),offsets:[[45,-65],[70,35],[-65,35],[0,55]]},momentum:{x:lab.x(start.x),y:lab.y(start.y),offsets:[[0,-65],[30,40],[100,-45],[100,35]]}},['potential','scattering','cross-section'],owner,forecastObstacles(panes,data.rows));
  for(const [i,frame] of ['lab','cm'].entries()){
   const {rect,map}=panes[i],b=g.frames[frame];
   s.text(frame==='lab'?'Laboratory':'Center of mass',rect.x+rect.w/2,rect.y-8,C.pale,12);
   const initial=data.rows[0].geometry.frames[frame],last=data.rows.at(-1).geometry.frames[frame];
   s.ctx.setLineDash([3,5]);s.line(map.x(initial[0].x),map.y(initial[0].y),map.x(initial[1].x),map.y(initial[0].y),C.grid);s.ctx.setLineDash([]);
   if(i===0&&Math.abs(f.params.b)>.001){
    s.line(impact.bar.x,impact.bar.y,impact.bar.x,impact.bar.bottom,C.muted);
    s.text(impact.text,impact.x,impact.y,C.muted,11);s.impactPanel=rect;
   }
   for(let j=0;j<2;j++){
    linePath(s,data.rows.map(r=>r.geometry.frames[frame][j]),map,(j?C.amber:C.blue)+'30');
    linePath(s,data.rows.filter(r=>r.t<=f.t).map(r=>r.geometry.frames[frame][j]),map,j?C.amber:C.blue,1.5);
    const q=b[j],contact=['hard','soft'].includes(f.params.interaction)||['hard','soft'].includes(f.params.secondInteraction);
    s.circle(map.x(q.x),map.y(q.y),contact?Math.max(2,q.radius*map.scale):4,j?C.amber:C.blue);
   }
   const cm=frame==='cm'?{x:0,y:0}:g.centreOfMass;s.line(map.x(cm.x)-3,map.y(cm.y),map.x(cm.x)+3,map.y(cm.y),C.green);s.line(map.x(cm.x),map.y(cm.y)-3,map.x(cm.x),map.y(cm.y)+3,C.green);
   if(f.breakdown){
    const q=b[0],z=b[1],scale=Math.min(30,rect.w*.18/Math.max(q.mass*Math.hypot(q.vx,q.vy),z.mass*Math.hypot(z.vx,z.vy),1));
    s.physicsSegments.push({id:'p1',x:map.x(q.x),y:map.y(q.y),ex:map.x(q.x)+q.mass*q.vx*scale,ey:map.y(q.y)-q.mass*q.vy*scale},{id:'p2',x:map.x(z.x),y:map.y(z.y),ex:map.x(z.x)+z.mass*z.vx*scale,ey:map.y(z.y)-z.mass*z.vy*scale});
    vector(s,map.x(q.x),map.y(q.y),q.mass*q.vx*scale,-q.mass*q.vy*scale,C.blue,'p₁');
    vector(s,map.x(z.x),map.y(z.y),z.mass*z.vx*scale,-z.mass*z.vy*scale,C.amber,'p₂');
   }
  }
  s.text(fmt(durationFor(f.params))+' s forecast · brighter paths = elapsed',s.w/2,s.h-43,C.muted,11);
 },
 equations(f){const q=f.sample,p=f.params;return [String.raw`\mathbf P=\mathbf p_1+\mathbf p_2`,
  String.raw`P_x=${tex(p.m1*q.vx1)}+(${tex(p.m2*q.vx2)})`,String.raw`=${tex(q.px)}\;\mathrm{kg\,m/s}`,
  String.raw`P_y=${tex(p.m1*q.vy1)}+(${tex(p.m2*q.vy2)})`,String.raw`=${tex(q.py)}\;\mathrm{kg\,m/s}`,
  String.raw`Q=${tex(q.dissipated)}\;\mathrm J`];},
 closeupEquation(f){let q=f.sample,r=f.geometry.relative,impact;const p=f.params;
  if(f.closeup==='contact'){
   const data=trajectory(p,f);if(data.done&&data.rows.length){const nearest=encounterPreview(p,data.rows),R=p.secondInteraction==='hard'?p.secondRange:p.radius,extent=Math.max(R*1.9,nearest.sample.separation*1.8,.4);
    impact=nearest.impact;if(impact||!f.geometry.frames.cm.every(b=>Math.abs(b.x)<extent&&Math.abs(b.y)<extent*.8)){q=nearest.sample;r=nearest.geometry.relative;}}
  }
  const normal=impact?.before??(r.x*r.vx+r.y*r.vy)/q.separation;
  if(f.closeup==='momentum')return [String.raw`\sum_i\mathbf p_i^{\rm before}=\sum_i\mathbf p_i^{\rm after}`,String.raw`\mathbf v_i^*=\mathbf v_i-\mathbf V_{CM}`,String.raw`\mathbf P=(${tex(q.px)},${tex(q.py)})`];
  if(f.closeup==='potential')return [String.raw`U_{\rm eff}=U(r)+\frac{L^2}{2\mu_r r^2}`,String.raw`\mu_r=\frac{m_1m_2}{m_1+m_2}`,String.raw`E_{\rm rel}=E-\tfrac12 MV_{CM}^2`];
  if(f.closeup==='scattering'||f.closeup==='cross-section')return [String.raw`\theta=\operatorname{atan2}(u_y,u_x)`,String.raw`\theta_{CM}=${tex(q.scatteringAngle)}\;\mathrm{rad}`,String.raw`\frac{d\sigma}{d\Omega}=\left|\frac{b}{\sin\theta}\frac{db}{d\theta}\right|`];
  if(!['hard','soft'].includes(p.interaction)&&!['hard','soft'].includes(p.secondInteraction))return [String.raw`F_r=-\frac{dU}{dr}`,String.raw`F_r=${tex(interactionAt(p,q.separation).force)}\;\mathrm N`,String.raw`r=${tex(q.separation)}\;\mathrm m`];
  if(p.interaction==='soft'||p.secondInteraction==='soft'){
   const R=p.secondInteraction==='soft'?p.secondRange:p.radius,k=p.secondInteraction==='soft'?p.secondStiffness:p.stiffness;
   return [String.raw`F=k\max(0,R-r)`,String.raw`k=${tex(k)},\quad r=${tex(q.separation)}`,String.raw`F=${tex(k*Math.max(0,R-q.separation))}\;\mathrm N`];
  }
  return [String.raw`u'_n=-e u_n,\quad u'_t=u_t`,String.raw`J=-(1+e)\mu_r u_n`,String.raw`u_n=${tex(normal)}\;\mathrm{m/s}`,String.raw`u'_n=${tex(impact?.after??-p.restitution*normal)}\;\mathrm{m/s}`,String.raw`e=${tex(p.restitution)}`];
 }
};
