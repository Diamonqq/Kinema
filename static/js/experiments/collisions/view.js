import {num as fmt,texNum as tex} from '../kit/format.js';
import {runBatches} from '../orbits/work.js';
import {model,interactionAt,scatteringCurve,differentialCrossSection} from './model.js';
import {C,camera,linePath,boundsFor,forecast,chipAnchors,title,vector,plot,label,sceneHeight,segmentHitsRect} from '../orbits/scene.js';
import {placeChips} from './chips.js';
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
 function* batches(){let points=[],t0=performance.now();for(let i=0;i<grid.length;i++){
  points=[...points,...scatteringCurve(params,[grid[i]],{duration:60,dt:.2})];
  // Several points per slice: the sweep finishes quickly yet never holds the page for long.
  if(i===grid.length-1||performance.now()-t0>12){yield {points,done:i===grid.length-1};t0=performance.now();}
 }}
 return runBatches(batches(),state,lifecycle);
}
const panelCache=new WeakMap(),obstacleCache=new WeakMap(),chipCache=new WeakMap();
// One anchor rule per chip, the same in every view: away from the paths (which leave to the right), a body's radius clear of its target.
export const COLLISION_ANCHORS={momentum:['s','sw','w','n','nw'],contact:['sw','s','nw','n','w'],potential:['e','se','ne','s','n'],scattering:['ne','n','nw','e','w'],'cross-section':['ne','n','nw','e','w']};
function chipLayout(s,owner,rows,panes,targets,avoid,layout){
 const cached=chipCache.get(rows),key=JSON.stringify([s.w,layout.height,targets]);if(cached?.key===key&&cached.panes===panes)return cached.result;
 const sizes=id=>{const b=owner?.q('[data-exp="closeup"][data-id="'+id+'"]');return {w:b?.offsetWidth||112,h:b?.offsetHeight||32};};
 const body=Math.round(Math.max(5,(rows[0].geometry.frames.lab[0].radius||0)*panes[0].map.scale)+10),gaps={momentum:body,contact:body,potential:body,scattering:14,'cross-section':14};
 const result=placeChips(targets,sizes,{width:s.w,top:layout.oy+8,bottom:layout.oy+layout.height-58,rects:forecastObstacles(panes,rows),segments:forecastSegments(panes,rows),avoid,prefer:COLLISION_ANCHORS,gaps});
 chipCache.set(rows,{key,panes,result});return result;
}

// The b marker is a bar of true length b (same scale as the frame) just left of the projectile, with its label above the bodies.
export function impactCaption(panel,initial,b){
 const {rect,map}=panel,text='b = '+fmt(b)+' m',width=text.length*6.5,radius=Math.max(5,initial[0].radius*map.scale);
 const top=Math.min(map.y(initial[0].y),map.y(initial[1].y)),bottom=Math.max(map.y(initial[0].y),map.y(initial[1].y));
 const bar={x:Math.max(rect.x+8,map.x(initial[0].x)-radius-8),y:top,bottom};
 const above=Math.min(top,map.y(initial[0].y))-Math.max(radius,Math.max(5,initial[1].radius*map.scale))-10;
 return {text,x:Math.max(rect.x+width/2+6,Math.min(rect.x+rect.w-width/2-6,bar.x+width/2-4)),y:Math.max(rect.y+12,above),width,bar};
}
// The frames fill the live stage (side by side on desktop, stacked when narrow), so they grow and shrink with the view; the
// chips follow their targets.
export function frameLayout(w,h=0){
 const narrow=w<460,height=Math.max(300,h||(narrow?560:520)),oy=0,top=58,bottom=height-58,gap=44;
 return {narrow,height,oy,top,bottom,gap,side:bottom-top,stack:(bottom-top-gap)/2};
}
// Each frame is framed around the whole encounter: where both bodies start, where they pass closest and the outgoing paths for as long
// as the approach took, with a fixed camera. Later forecast rows run on past the frame and are clipped to it.
export function encounterBounds(rows,frame){
 const near=rows.reduce((a,b)=>a.sample.separation<b.sample.separation?a:b),pts=[...rows[0].geometry.frames[frame],...near.geometry.frames[frame]];
 for(const row of rows){if(row.t>2*near.t+1e-9)break;pts.push(...row.geometry.frames[frame]);}
 const xs=pts.map(q=>q.x),ys=pts.map(q=>q.y),radius=Math.max(...pts.map(q=>q.radius||0));
 const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys),pad=Math.max(radius*1.5,.12*Math.max(xmax-xmin,ymax-ymin),.15);
 return [xmin-pad,xmax+pad,ymin-pad,ymax+pad];
}
// Where a body's forecast path leaves its frame (or ends), in stage pixels: the fixed point its zoom chip sits beside.
export function exitPoint(rows,panel,frame,j){
 const {rect,map}=panel;let last=null;
 for(const row of rows){const q=row.geometry.frames[frame][j],x=map.x(q.x),y=map.y(q.y);
  if(x<rect.x+4||x>rect.x+rect.w-4||y<rect.y+4||y>rect.y+rect.h-4){if(last)break;continue;}last={x,y};}
 return last||{x:map.x(rows.at(-1).geometry.frames[frame][j].x),y:map.y(rows.at(-1).geometry.frames[frame][j].y)};
}
export function comparisonPanels(s,rows){
 const layout=frameLayout(s.w,s.h),key=s.w+':'+layout.height,cached=panelCache.get(rows);if(cached?.key===key)return cached.panes;
 const {narrow,top,gap,side,stack}=layout,m=narrow?12:16,pw=(s.w-3*m)/2;
 const bounds=['lab','cm'].map(frame=>encounterBounds(rows,frame));
 const stacked=[{x:m,y:top,w:s.w-2*m,h:stack},{x:m,y:top+stack+gap,w:s.w-2*m,h:stack}],beside=[{x:m,y:top,w:pw,h:side},{x:2*m+pw,y:top,w:pw,h:side}];
 const fit=rs=>Math.min(...rs.map((r,i)=>Math.min((r.w-48)/Math.max(.01,bounds[i][1]-bounds[i][0]),(r.h-28)/Math.max(.01,bounds[i][3]-bounds[i][2]))));
 // Side by side or stacked, whichever draws the shared scale larger; the choice depends only on the width and the motion.
 const rects=narrow||fit(stacked)>fit(beside)*1.08?stacked:beside,scale=fit(rects);
 const panes=rects.map((rect,i)=>{const [xmin,xmax,ymin,ymax]=bounds[i];return {rect,map:{
  x:v=>rect.x+rect.w/2+(v-(xmin+xmax)/2)*scale,
  y:v=>rect.y+rect.h/2-(v-(ymin+ymax)/2)*scale,scale}};});
 panelCache.set(rows,{key,panes});return panes;
}
// One shared scale for Before and After so the head-to-tail sum stays proportional: about 60% of the canvas wide, centered, rows centered in the band.
function momentum(s,f,data){
 title(s,'Momentum adds head to tail');if(!data.done){s.text('Preparing the comparison…',s.w/2,s.h/2,C.muted,12);return;}
 const before=data.rows[0],after=data.rows.find(p=>p.sample.contactCount>0&&p.sample.separation>f.params.radius*1.15)||data.rows.find(p=>p.t>1&&p.sample.separation>=before.sample.separation)||data.rows.at(-1);
 const rows=[before,after],frame=f.params.frame,width=s.w,band={top:70,bottom:s.h-62},gap=26;
 const moments=rows.map(row=>{const b=row.geometry.frames[frame],p1={x:b[0].mass*b[0].vx,y:b[0].mass*b[0].vy},p2={x:b[1].mass*b[1].vx,y:b[1].mass*b[1].vy};return {row,p1,p2,P:{x:p1.x+p2.x,y:p1.y+p2.y}};});
 const xs=moments.flatMap(m=>[0,m.p1.x,m.P.x]),spanX=Math.max(1e-9,Math.max(...xs)-Math.min(...xs)),largest=Math.max(1e-9,...moments.flatMap(m=>[Math.hypot(m.p1.x,m.p1.y),Math.hypot(m.p2.x,m.p2.y),Math.hypot(m.P.x,m.P.y)]));
 // Screen offsets of one row's drawing relative to its baseline y: the path above, the total P arrow 30 below, the caption 34 above.
 const extent=(m,k)=>{const ys=[0,m.p1.y,m.P.y].map(v=>-v*k),pys=[30,30-m.P.y*k];return {lo:Math.min(0,...ys,...pys)-34,hi:Math.max(0,...ys,...pys)+8,top:Math.min(0,...ys,...pys)};};
 let scale=Math.min(width*.6/spanX,width*.6/largest);
 const total=k=>moments.reduce((sum,m)=>{const e=extent(m,k);return sum+e.hi-e.lo;},0)+gap;
 for(let n=0;n<80&&total(scale)>band.bottom-band.top;n++)scale*=.95;
 const minX=Math.min(...xs)*scale,maxX=Math.max(...xs)*scale,origin=width/2-(minX+maxX)/2;
 let cursor=band.top+Math.max(0,(band.bottom-band.top-total(scale))/2);
 moments.forEach((m,i)=>{
  const e=extent(m,scale),y=cursor-e.lo,{row,p1,p2,P}=m;cursor+=e.hi-e.lo+gap;
  s.text(i?'After · '+fmt(row.t)+' s':'Before',width/2,y+e.lo+10,C.muted,12);
  vector(s,origin,y,p1.x*scale,-p1.y*scale,C.blue,'p₁');
  vector(s,origin+p1.x*scale,y-p1.y*scale,p2.x*scale,-p2.y*scale,C.amber,'p₂');
  vector(s,origin,y+30,P.x*scale,-P.y*scale,C.green,'P');
  if(Math.hypot(P.x,P.y)<1e-10)s.text('P = 0 kg·m/s',origin+30,y+30,C.green,12);
 });
 s.text(frame==='lab'?'Laboratory momenta':'CM momenta · equal and opposite',width/2,s.h-42,C.muted,12);
}
function potential(s,f){
 if(s.h>=220)title(s,'Radial energy and the interaction');const p=f.params,mu=p.m1*p.m2/(p.m1+p.m2),L=f.sample.angularMomentum,
  cmK=(p.m1+p.m2)*((p.m1*p.speed+p.m2*p.targetSpeed)/(p.m1+p.m2))**2/2,E=f.sample.energy-cmK;
 const hard=p.interaction==='hard'||p.secondInteraction==='hard',R=p.secondInteraction==='hard'?p.secondRange:p.radius,
  min=hard?R:Math.max(.04,Math.min(.5,f.sample.separation*.7)),max=Math.max(p.distance*1.4,p.range*4,R*3);
 const points=Array.from({length:160},(_,i)=>{const r=min+(max-min)*i/159;return {r,u:interactionAt(p,r).potential+L*L/(2*mu*r*r)};});
 plot(s,points,{xkey:'r',ykey:'u',energy:E,cursor:{x:Math.max(min,f.sample.separation)},label:'r (m)',ytitle:'Effective potential · J',xmin:hard?R-(max-R)*.1:undefined,walls:hard?[{x:R,text:'hard wall · r = R'}]:[]});
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
export function momentumArrows(bodies,map,rect){
 const [q,z]=bodies,total=q.mass+z.mass,cx=map.x((q.mass*q.x+z.mass*z.x)/total),cy=map.y((q.mass*q.y+z.mass*z.y)/total);
 let scale=Math.min(30,rect.w*.18/Math.max(q.mass*Math.hypot(q.vx,q.vy),z.mass*Math.hypot(z.vx,z.vy),1));
 // One common scale for both arrows (true proportion), shortened just enough that no arrowhead reaches the CM marker
 // (unless a body sits within about 24 px of the CM, where a visible arrow cannot also clear it).
 for(const b of [q,z]){const dx=b.mass*b.vx,dy=-b.mass*b.vy,len=Math.hypot(dx,dy)*scale;if(len<1e-6)continue;
  const ux=dx/Math.hypot(dx,dy),uy=dy/Math.hypot(dx,dy),t=(cx-map.x(b.x))*ux+(cy-map.y(b.y))*uy,off=Math.abs((cx-map.x(b.x))*uy-(cy-map.y(b.y))*ux);
  if(off<10&&t>0&&len>t-12)scale=Math.max(scale*.25,(t-12)/Math.hypot(dx,dy));}
 return [q,z].map((b,j)=>({id:j?'p2':'p1',x:map.x(b.x),y:map.y(b.y),ex:map.x(b.x)+b.mass*b.vx*scale,ey:map.y(b.y)-b.mass*b.vy*scale}));
}
const overlap=(a,b,pad=0)=>a.x<b.x+b.width+pad&&a.x+a.width+pad>b.x&&a.y<b.y+b.height+pad&&a.y+a.height+pad>b.y;
// A label at its arrow tip: just past the tip, else beside it, clear of markers, other labels and chips.
function tipLabel(s,text,a,color){
 s.ctx.font='12px system-ui';const w=s.ctx.measureText(text).width,h=14,len=Math.hypot(a.ex-a.x,a.ey-a.y),ux=(a.ex-a.x)/len,uy=(a.ey-a.y)/len,nx=-uy,ny=ux;
 const blocked=[...s.labels,...s.chipRects,...s.labelObstacles],paths=s.tipPaths||[];let pick=null;
 // Beside the tip first, then rings of growing radius around it.
 const ring=[20,28,36,46].flatMap(r=>[0,30,-30,60,-60,90,-90,120,-120,150,-150,180].map(d=>[r*Math.cos(d*Math.PI/180),r*Math.sin(d*Math.PI/180)]));
 for(const [u,n] of [[13,0],[8,12],[8,-12],[0,16],[0,-16],[18,13],[18,-13],[0,24],[0,-24],[26,0],...ring]){
  const x=a.ex+ux*u+nx*n,y=a.ey+uy*u+ny*n,box={x:x-w/2,y:y-h/2,width:w,height:h};
  if(box.x<6||box.x+w>s.w-6||box.y<34||box.y+h>s.h-34)continue;
  if(!blocked.some(o=>overlap(box,o,5))&&!paths.some(l=>segmentHitsRect(l[0],l[1],l[2],l[3],box,3))){pick={x,y};break;}
 }
 pick??={x:a.ex+ux*13,y:a.ey+uy*13};s.text(text,pick.x,pick.y,color,12);
}
const inside=(r,x,y,m=0)=>x>=r.x-m&&x<=r.x+r.w+m&&y>=r.y-m&&y<=r.y+r.h+m;
// Solid keep-outs for the chips: pane titles, the b caption, the bodies inside each frame and the first Breakdown arrows with their label room.
export function forecastObstacles(panes,rows){
 const cached=obstacleCache.get(panes);if(cached?.rows===rows)return cached.obstacles;
 const obstacles=[];
 for(const [i,frame] of ['lab','cm'].entries()){
  const {map,rect}=panes[i];obstacles.push({x:rect.x+rect.w/2-52,y:rect.y-24,width:104,height:24});
  // The frame's own border: a chip sits fully inside a frame or fully outside it, never across the line.
  obstacles.push({x:rect.x-1,y:rect.y-1,width:rect.w+2,height:2},{x:rect.x-1,y:rect.y+rect.h-1,width:rect.w+2,height:2},{x:rect.x-1,y:rect.y,width:2,height:rect.h},{x:rect.x+rect.w-1,y:rect.y,width:2,height:rect.h});
  rows.forEach((row,k)=>{
   const bodies=row.geometry.frames[frame];
   if(k%3===0||k===rows.length-1)for(const q of bodies){
    const radius=Math.max(5,q.radius*map.scale),x=map.x(q.x),y=map.y(q.y);
    // Bodies are clipped to their frame, so only the part inside it keeps a chip away.
    const x0=Math.max(rect.x,x-radius),x1=Math.min(rect.x+rect.w,x+radius),y0=Math.max(rect.y,y-radius),y1=Math.min(rect.y+rect.h,y+radius);
    if(x1>x0&&y1>y0)obstacles.push({x:x0,y:y0,width:x1-x0,height:y1-y0});
   }
   if(k===0)for(const a of momentumArrows(bodies,map,rect)){
    const len=Math.hypot(a.ex-a.x,a.ey-a.y);if(len<.05)continue;
    obstacles.push({x:a.ex+(a.ex-a.x)/len*13-17,y:a.ey+(a.ey-a.y)/len*13-11,width:34,height:22});
   }
  });
  const cm=frame==='cm'?{x:0,y:0}:rows[0].geometry.centreOfMass;obstacles.push({x:map.x(cm.x)-7,y:map.y(cm.y)-7,width:14,height:14});
 }
 const impact=impactCaption(panes[0],rows[0].geometry.frames.lab,rows[0].geometry.impactParameter);
 obstacles.push({x:impact.x-impact.width/2,y:impact.y-8,width:impact.width,height:16});
 if(Math.abs(rows[0].geometry.impactParameter)>.001)obstacles.push({x:impact.bar.x-2,y:impact.bar.y,width:4,height:impact.bar.bottom-impact.bar.y});
 obstacleCache.set(panes,{rows,obstacles});return obstacles;
}
// Drawn lines the chips must not sit on: both body paths, the CM path, the dashed baseline and every Breakdown arrow, inside each frame.
export function forecastSegments(panes,rows){
 const segments=[];
 for(const [i,frame] of ['lab','cm'].entries()){
  const {map,rect}=panes[i],keep=(x0,y0,x1,y1)=>{
   // Only the part inside the frame is drawn, so only that part keeps a chip away.
   let lo=0,hi=1;const dx=x1-x0,dy=y1-y0;
   for(const [p,q] of [[-dx,x0-rect.x],[dx,rect.x+rect.w-x0],[-dy,y0-rect.y],[dy,rect.y+rect.h-y0]]){
    if(Math.abs(p)<1e-12){if(q<0)return;continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return;
   }
   segments.push([x0+dx*lo,y0+dy*lo,x0+dx*hi,y0+dy*hi]);
  };
  const pt=(q)=>[map.x(q.x),map.y(q.y)];
  for(let k=1;k<rows.length;k++){
   const A=rows[k-1].geometry,B=rows[k].geometry;
   for(let j=0;j<2;j++)keep(...pt(A.frames[frame][j]),...pt(B.frames[frame][j]));
   if(frame==='lab')keep(...pt(A.centreOfMass),...pt(B.centreOfMass));
  }
  rows.forEach((row,k)=>{if(k%4!==0)return;for(const a of momentumArrows(row.geometry.frames[frame],map,rect))keep(a.x,a.y,a.ex,a.ey);});
  const f0=rows[0].geometry.frames[frame];keep(map.x(f0[0].x),map.y(f0[0].y),map.x(f0[1].x),map.y(f0[0].y));
 }
 return segments;
}
// Height the scattering and cross-section plots use: their x title rises this much clear of the caption below (two lines when narrow).
export const graphHeight=s=>s.h-(s.w<460?24:8);
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
 s.discs=[{x:px,y:py,r:disc}];
 const ux=sign*Math.cos(theta),uy=-sign*Math.sin(theta);
 vector(s,px+ux*(disc+5),py+uy*(disc+5),ux*Math.min(ray,42),uy*Math.min(ray,42),C.blue,'u');
 if(Math.abs(theta)>.015){s.ctx.beginPath();s.ctx.arc(px,py,23,start,start-theta,theta>0);s.ctx.strokeStyle=C.purple;s.ctx.stroke();const lr=Math.max(34,disc+14);label(s,'θ',px+sign*lr*Math.cos(theta/2),py-sign*lr*Math.sin(theta/2),C.purple);}
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
  f.closeup==='scattering'?'Finite-start scattering · only completed encounters':f.closeup==='cross-section'?(f.params.interaction==='hard'?'Hard spheres · dσ/dΩ = R²/4 = '+fmt(f.params.radius**2/4)+' m²/sr, the same at every angle':'Classical dσ/dΩ = |b / (sin θ · dθ/db)| from the finished sweep'):f.closeup==='contact'?('Blue projectile \u00b7 amber target \u00b7 '+(f.contactForceDrawn?'green F':'blue u')):'Blue projectile · amber target · + CM',
 draw(s,f){
  const owner=shells.get(s);if(owner){parameterShells.set(f.params,owner);sceneHeight(owner,560,!!f.closeup,!!f.closeup,460,f.closeup==='momentum'?500:360);}s.chipRects=[];s.pathObstacles=[];s.physicsSegments=[];s.labelObstacles=[];
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
   // The plot (and its x title) rise to leave the caption below clear room; a narrow stage wraps it onto two lines.
   plot(Object.create(s,{h:{value:graphHeight(s)}}),points,{zero:cross,label:cross?'|θCM| (rad)':'Initial b (m)',ytitle:cross?'dσ/dΩ · m²/sr':'|θCM| · rad',cursor:cross?null:{x:Math.abs(f.params.b),y:Math.abs(f.sample.scatteringAngle)}});
   if(!curve.done)s.text('Computing '+curve.points.length+' / '+curve.total,s.w/2,64,C.muted,11);return;
  }
  if(!data.done){s.text(data.error||'Preparing the fixed 60 s motion window…',s.w/2,s.h*.55,C.muted,s.w<380?11:13);return;}
  const panes=comparisonPanels(s,data.rows),first=data.rows[0].geometry.frames.lab,nearest=data.rows.reduce((a,b)=>a.sample.separation<b.sample.separation?a:b).geometry.frames.lab;
  const impact=impactCaption(panes[0],first,f.params.b);
  const start=first[0],encounterPoint={x:(nearest[0].x+nearest[1].x)/2,y:(nearest[0].y+nearest[1].y)/2},lab=panes[0].map;
  // The drawn forecast paths: breakdown labels keep off them too.
  s.tipPaths=panes.flatMap(({map},i)=>{const out=[],fr=i?'cm':'lab';for(let k=1;k<data.rows.length;k++)for(let j=0;j<2;j++){const A=data.rows[k-1].geometry.frames[fr][j],B=data.rows[k].geometry.frames[fr][j];out.push([map.x(A.x),map.y(A.y),map.x(B.x),map.y(B.y)]);}return out;});
  s.pathObstacles=forecastObstacles(panes,data.rows);s.apparatusBoxes=['lab','cm'].map((frame,i)=>{const [x0,x1,y0,y1]=encounterBounds(data.rows,frame),{map}=panes[i];return {x:map.x(x0),y:map.y(y1),width:map.x(x1)-map.x(x0),height:map.y(y0)-map.y(y1)};});s.paneRects=panes.map(p=>p.rect);
  const cmMap=panes[1].map,layout=frameLayout(s.w,s.h),first_cm=data.rows[0].geometry.frames.cm;
  const avoid=panes.map(({rect})=>({x:rect.x+rect.w/2-48,y:rect.y-17,width:96,height:17}));
  if(Math.abs(f.params.b)>.001)avoid.push({x:impact.x-impact.width/2,y:impact.y-8,width:impact.width,height:16},{x:impact.bar.x-1,y:impact.bar.y,width:2,height:impact.bar.bottom-impact.bar.y});
  const chips=chipLayout(s,owner,data.rows,panes,{momentum:{x:lab.x(start.x),y:lab.y(start.y)},contact:{x:lab.x(encounterPoint.x),y:lab.y(encounterPoint.y)},
   potential:{x:cmMap.x(first_cm[1].x),y:cmMap.y(first_cm[1].y)},scattering:exitPoint(data.rows,panes[0],'lab',0),'cross-section':exitPoint(data.rows,panes[1],'cm',0)},avoid,layout);
  s.chipAnchorNames=chips.anchors;s.chipTargets={momentum:{x:lab.x(start.x),y:lab.y(start.y)},contact:{x:lab.x(encounterPoint.x),y:lab.y(encounterPoint.y)},potential:{x:cmMap.x(first_cm[1].x),y:cmMap.y(first_cm[1].y)},scattering:exitPoint(data.rows,panes[0],'lab',0),'cross-section':exitPoint(data.rows,panes[1],'cm',0)};
  s.chipRects=Object.values(chips.boxes);s.targetAnchors=Object.fromEntries(Object.entries(chips.boxes).map(([id,b])=>[id,{x:b.x+b.width/2,y:b.y}]));
  for(const [i,frame] of ['lab','cm'].entries()){
   const {rect,map}=panes[i],b=g.frames[frame];
   s.text(frame==='lab'?'Laboratory':'Center of mass',rect.x+rect.w/2,rect.y-8,C.pale,12);
   s.ctx.save();s.ctx.strokeStyle='rgba(160,180,210,0.14)';s.ctx.lineWidth=1;s.ctx.strokeRect(rect.x+.5,rect.y+.5,rect.w-1,rect.h-1);
   s.ctx.beginPath();s.ctx.rect(rect.x,rect.y,rect.w,rect.h);s.ctx.clip();
   const initial=data.rows[0].geometry.frames[frame],last=data.rows.at(-1).geometry.frames[frame];
   s.ctx.setLineDash([3,5]);s.line(map.x(initial[0].x),map.y(initial[0].y),map.x(initial[1].x),map.y(initial[0].y),C.grid);s.ctx.setLineDash([]);
   for(let j=0;j<2;j++){
    linePath(s,data.rows.map(r=>r.geometry.frames[frame][j]),map,(j?C.amber:C.blue)+'30');
    linePath(s,data.rows.filter(r=>r.t<=f.t).map(r=>r.geometry.frames[frame][j]),map,j?C.amber:C.blue,1.5);
    const q=b[j],contact=['hard','soft'].includes(f.params.interaction)||['hard','soft'].includes(f.params.secondInteraction);
    s.circle(map.x(q.x),map.y(q.y),contact?Math.max(2,q.radius*map.scale):4,j?C.amber:C.blue);
   }
   const cm=frame==='cm'?{x:0,y:0}:g.centreOfMass;s.line(map.x(cm.x)-3,map.y(cm.y),map.x(cm.x)+3,map.y(cm.y),C.green);s.line(map.x(cm.x),map.y(cm.y)-3,map.x(cm.x),map.y(cm.y)+3,C.green);
   s.ctx.restore();
   if(i===0&&Math.abs(f.params.b)>.001){
    s.line(impact.bar.x,impact.bar.y,impact.bar.x,impact.bar.bottom,C.muted);
    s.text(impact.text,impact.x,impact.y,C.muted,11);s.impactPanel=rect;
   }
   if(f.breakdown){
    // A body that has left the frame has no arrow to draw here.
    const arrows=momentumArrows(b,map,rect).map(a=>a.x<rect.x||a.x>rect.x+rect.w||a.y<rect.y||a.y>rect.y+rect.h?{...a,ex:a.x,ey:a.y}:a);s.physicsSegments.push(...arrows.map(a=>{const dx=a.ex-a.x,dy=a.ey-a.y;let k=1;if(dx>0)k=Math.min(k,(rect.x+rect.w-a.x)/dx);if(dx<0)k=Math.min(k,(rect.x-a.x)/dx);if(dy>0)k=Math.min(k,(rect.y+rect.h-a.y)/dy);if(dy<0)k=Math.min(k,(rect.y-a.y)/dy);k=Math.max(0,k);return {...a,ex:a.x+dx*k,ey:a.y+dy*k};}));
    s.labelObstacles.push({x:map.x(cm.x)-10,y:map.y(cm.y)-10,width:20,height:20},...b.map(q=>({x:map.x(q.x)-8,y:map.y(q.y)-8,width:16,height:16})),
     ...arrows.flatMap(a=>{const n=Math.max(1,Math.ceil(Math.hypot(a.ex-a.x,a.ey-a.y)/6));return Array.from({length:n+1},(_,k)=>({x:a.x+(a.ex-a.x)*k/n-3,y:a.y+(a.ey-a.y)*k/n-3,width:6,height:6}));}));
    arrows.forEach((a,j)=>{if(Math.hypot(a.ex-a.x,a.ey-a.y)<.05)return;const inside=a.ex>=rect.x+4&&a.ex<=rect.x+rect.w-4&&a.ey>=rect.y+4&&a.ey<=rect.y+rect.h-4;
     // An arrow that reaches past the frame is cut at its edge and loses its label rather than spilling over the captions.
     s.ctx.save();s.ctx.beginPath();s.ctx.rect(rect.x,rect.y,rect.w,rect.h);s.ctx.clip();s.arrow(a.x,a.y,a.ex,a.ey,j?C.amber:C.blue,2);s.ctx.restore();if(inside)tipLabel(s,j?'p₂':'p₁',a,j?C.amber:C.blue);});
   }
  }
  s.text(fmt(durationFor(f.params))+' s forecast · brighter paths = elapsed',s.w/2,layout.oy+layout.height-43,C.muted,11);
 },
 equations(f){const q=f.sample,p=f.params,unit=String.raw`\;\mathrm{kg\,m/s}`;
  // Each component sums its two terms with units; a vanishing term is left out rather than written as "+ (0)".
  const part=(name,a,b,total)=>{
   const A=Math.abs(a)<1e-9,B=Math.abs(b)<1e-9;
   if(A||B)return [String.raw`${name}=${tex(total)}${unit}`];
   return [String.raw`${name}=${tex(a)}${unit}${b<0?'-':'+'}${tex(Math.abs(b))}${unit}`,String.raw`=${tex(total)}${unit}`];
  };
  return [String.raw`\mathbf P=\mathbf p_1+\mathbf p_2`,...part('P_x',p.m1*q.vx1,p.m2*q.vx2,q.px),...part('P_y',p.m1*q.vy1,p.m2*q.vy2,q.py),
  String.raw`Q=${tex(q.dissipated)}\;\mathrm J`];},
 closeupEquation(f){let q=f.sample,r=f.geometry.relative,impact;const p=f.params;
  if(f.closeup==='contact'){
   const data=trajectory(p,f);if(data.done&&data.rows.length){const nearest=encounterPreview(p,data.rows),R=p.secondInteraction==='hard'?p.secondRange:p.radius,extent=Math.max(R*1.9,nearest.sample.separation*1.8,.4);
    impact=nearest.impact;if(impact||!f.geometry.frames.cm.every(b=>Math.abs(b.x)<extent&&Math.abs(b.y)<extent*.8)){q=nearest.sample;r=nearest.geometry.relative;}}
  }
  const normal=impact?.before??(r.x*r.vx+r.y*r.vy)/q.separation;
  if(f.closeup==='momentum')return [String.raw`\sum_i\mathbf p_i^{\rm before}=\sum_i\mathbf p_i^{\rm after}`,String.raw`\mathbf v_i^*=\mathbf v_i-\mathbf V_{CM}`,String.raw`\mathbf P=(${tex(q.px)},\,${tex(q.py)})\;\mathrm{kg\,m/s}`];
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
