import {C,boost,interval,gamma,addVelocity} from './model.js';
import {num,texNum} from '../kit/format.js';
import {colors,panels,blockHeight,holdShell,fitScene,mapPanel,line,inside,axes,plot,clipPanel,clipLine,richText,richWidth,axisLabels} from './drawing.js';
const cache=new WeakMap();
const tex=v=>texNum(v,3);
export const closeups=[{id:'event',label:'Zoom · events'},{id:'transform',label:'Zoom · transform'}];
export const graphs=[
  {id:'worldlines',label:'Position vs time',kind:'custom'},{id:'clocks',label:'Clock ages',unit:'s',window:12,series:[{key:'groundTime',label:'t',color:colors[0]},{key:'properTime',label:'\u03c4',color:colors[1]}]},
  {id:'light-cone',label:'Light cone',kind:'custom'},{id:'calibration',label:'Calibration',kind:'custom'},
  {id:'spatial',label:'Spatial view',kind:'custom'},{id:'four-vector',label:'Four-vector',kind:'custom'},{id:'tensor',label:'Tensor',kind:'custom'},
];
function beta(p){return ['objects','flashes','four-vector','tensor'].includes(p.scenario)?{x:p.beta,y:p.betaY,z:p.betaZ}:p.beta;}
const invert=b=>typeof b==='number'?-b:{x:-b.x,y:-b.y,z:-b.z};
const coord=(a,L)=>[a.x/L,C*a.t/L];
export function boundsFor(g,L,desktop=true){
  const events=['ground','moving'].flatMap(k=>g[k].events).map(a=>coord(a,L));
  if(desktop&&events.length&&Math.max(...events.map(a=>a[1]))>0){const xs=events.map(a=>a[0]),ys=events.map(a=>a[1]),max=Math.max(...ys),dx=Math.max(.2,(Math.max(...xs)-Math.min(...xs))*.1);const half=Math.max(Math.abs(Math.min(...xs)),Math.abs(Math.max(...xs)))+dx;return [-half,half,Math.min(-.25*max,...ys),max*1.05];}
  const points=['ground','moving'].flatMap(k=>[...g[k].events,...g[k].worldlines.flatMap(l=>l.points)]).map(a=>coord(a,L));
  if(!points.length)return [-2,2,-1,3];
  let x0=Math.min(-.3,...points.map(a=>a[0])),x1=Math.max(.3,...points.map(a=>a[0])),y0=Math.min(-.3,...points.map(a=>a[1])),y1=Math.max(.3,...points.map(a=>a[1]));
  const dx=(x1-x0)*.13,dy=(y1-y0)*.1,half=Math.max(Math.abs(x0-dx),Math.abs(x1+dx));return desktop?[-half,half,y0-dy,y1+dy]:[x0-dx,x1+dx,y0-dy,y1+dy];
}
function context(f){let c=cache.get(f.instance);if(!c){const g=f.geometry,L=f.params.length;
  c={bounds:boundsFor(g,L),narrowBounds:boundsFor(g,L,false),selected:g.ground.events.find(e=>e.id==='reflect'||e.id==='turn'||e.id==='right-strike')||g.ground.events.at(-1)||{t:0,x:0,y:0,z:0}};cache.set(f.instance,c);}return c;}
function selected(f,key){const c=context(f);return key==='moving'?boost(c.selected,beta(f.params)):c.selected;}
export function namedEvents(f){
  const b=context(f).selected,a=f.geometry.ground.events.find(e=>e.id!==b.id);
  return a?[{name:'A',event:a},{name:'B',event:b}]:[];
}
export function eventReadouts(f){return namedEvents(f).flatMap(({name,event})=>{
  const a=coord(event,f.params.length),b=coord(boost(event,beta(f.params)),f.params.length);
  return [`${name}  S: (x, ct) = (${num(a[0])}, ${num(a[1])}) L`,`${name}  S′: (x′, ct′) = (${num(b[0])}, ${num(b[1])}) L`];
});}
function eventLetter(s,f,p,m,key,record,extra=[],soft=[]){
  const e=key==='moving'?boost(record.event,beta(f.params)):record.event,[x,y]=coord(e,f.params.length);
  if(!inside(m,p,x,y,3))return;
  const px=m.x(x),py=m.y(y);s.ctx.font='12px system-ui';const width=s.ctx.measureText(record.name).width;
  const segments=f.geometry[key].worldlines.flatMap(l=>l.points.slice(1).map((b,i)=>{const a=l.points[i];return [m.x(a.x/f.params.length),m.y(C*a.t/f.params.length),m.x(b.x/f.params.length),m.y(C*b.t/f.params.length)];}));
  segments.push(...extra);
  // Nearest clear spot beside the event: off the worldlines, the dashed axes and the cone lines too.
  const spots=[];for(let dx=-40;dx<=40;dx+=4)for(let dy=-40;dy<=40;dy+=4){const d=Math.hypot(dx+width/2,dy);if(d>=11)spots.push([dx,dy,d]);}
  spots.sort((u,v)=>u[2]-v[2]);
  for(const lines of [[...segments,...soft],segments])for(const [dx,dy] of spots){
    const box={left:px+dx-3,top:py+dy-9,width:width+6,height:18};
    if(box.left<p.left||box.top<p.top||box.left+box.width>p.left+p.width||box.top+box.height>p.top+p.height)continue;
    if(s.labels.some(l=>box.left<l.x+l.width&&box.left+box.width>l.x&&box.top<l.y+l.height&&box.top+box.height>l.y))continue;
    if(lines.some(a=>clipLine(...a,box)))continue;
    s.text(record.name,px+dx,py+dy,'#e8f2ff',12,'left');((s.diag||(s.diag={}))[key].letters||(s.diag[key].letters=[])).push(Object.assign(box,{relaxed:lines===segments&&soft.length>0}));return;
  }
}
// The green hyperbola is every event at interval L from the origin; it has the same shape in S and S′.
function intervalCaption(s,f,p,m,key,curve,avoid=[],soft=[]){
  const text='invariant interval',width=richWidth(s,text,11),w=width+6,h=18,pad=6;
  const hard=[...curve,...avoid,[p.left,m.y(0),p.left+p.width,m.y(0)],[m.x(0),p.top,m.x(0),p.top+p.height]];
  // Beside the curve, nearest clear spot first; the outer arms win because the worldlines gather near the vertex.
  const spots=[];
  for(let i=0;i<=curve.length;i+=2){const a=i<curve.length?[curve[i][0],curve[i][1]]:[curve[curve.length-1][2],curve[curve.length-1][3]];
    for(let dx=-170;dx<=170;dx+=6)for(let dy=-90;dy<=90;dy+=6){const d=Math.hypot(dx,dy);if(d<12)continue;spots.push({x:a[0]+dx,y:a[1]+dy,d:d+(Math.abs(i-curve.length/2)<curve.length*.2?14:0)});}}
  spots.sort((u,v)=>u.d-v.d);
  // Event and cone lines are avoided too; only when a crowded scene leaves no gap are they allowed to pass behind the caption.
  for(const lines of [[...hard,...soft],hard])for(const c of spots){
    const box={left:c.x-w/2,top:c.y-h/2,width:w,height:h},hit={left:box.left-pad,top:box.top-pad,width:w+2*pad,height:h+2*pad};
    if(box.left<p.left||box.top<p.top||box.left+w>p.left+p.width||box.top+h>p.top+p.height)continue;
    if(s.labels.some(l=>hit.left<l.x+l.width&&hit.left+hit.width>l.x&&hit.top<l.y+l.height&&hit.top+hit.height>l.y))continue;
    if(lines.some(v=>clipLine(...v,hit)))continue;
    richText(s,text,box.left+3,c.y,colors[2],11,'left');return Object.assign(box,{relaxed:lines===hard&&soft.length>0});
  }
}
function eventBounds(f,key){const L=f.params.length,pts=namedEvents(f).map(r=>coord(key==='moving'?boost(r.event,beta(f.params)):r.event,L));
  if(pts.length>1){const xs=pts.map(a=>a[0]),ys=pts.map(a=>a[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),pad=Math.max(.5,.35*Math.max(x1-x0,y1-y0));return [x0-pad,x1+pad,y0-pad,y1+pad];}
  return eventBoundsAround(f,key);}
function eventBoundsAround(f,key){const a=coord(selected(f,key),f.params.length),span=Math.max(.4,Math.min(1.4,(context(f).bounds[3]-context(f).bounds[2])*.18));return [a[0]-span,a[0]+span,a[1]-span,a[1]+span];}
function drawDiagram(s,f,p,key,{cone=true,calibration=false,zoom=false}={}){
  const L=f.params.length,g=f.geometry[key],b=beta(f.params),base=s.w<470||f.graph||f.thumbnail?context(f).narrowBounds:context(f).bounds;
  const bounds=zoom?eventBounds(f,key):base,m=mapPanel(s,p,bounds,key),primed=key==='moving';
  axes(s,m,p,{title:f.graph?'':primed?'S′ · moving frame':'S · ground frame',x:primed?'x′ / L':'x / L',y:primed?'ct′ / L':'ct / L',labels:!f.thumbnail,names:false});
  // The other frame's axes are transformed basis vectors, not an ordinary rotation.
  const transform=primed?b:invert(b),ex=coord(boost({t:0,x:L},transform),L),et=coord(boost({t:L/C,x:0},transform),L);
  const range=Math.max(...bounds.map(Math.abs))*4+4;
  clipPanel(s,p,()=>{
  for(const v of [ex,et])line(s,m,p,v.map(x=>-range*x),v.map(x=>range*x),'#8ab9ff70',1,[4,4]);
  if(cone){const origins=f.params.scenario==='flashes'||f.params.scenario==='objects'&&g.events.length?g.events.map(e=>coord(e,L)):[zoom?coord(selected(f,key),L):[0,0]];
    for(const a of origins)for(const sign of [-1,1])line(s,m,p,[a[0]-range,a[1]-sign*range],[a[0]+range,a[1]+sign*range],'#e9bb8840',1);}
  const now=g.now.map(a=>coord(a,L));line(s,m,p,now[0],now[1],'#d4deed90',1.3,[2,4]);
  // Event simultaneity in each pane is a horizontal line in that pane.
  for(const e of g.events){const a=coord(e,L);line(s,m,p,[base[0]-range,a[1]],[base[1]+range,a[1]],'#8ca2bc22',1,[2,5]);}
  for(const [i,l] of g.worldlines.entries()){
    const color=l.kind==='light'?'#efd1ac':[colors[0],colors[4],colors[3],colors[2]][i%4];
    for(let j=1;j<l.points.length;j++)line(s,m,p,coord(l.points[j-1],L),coord(l.points[j],L),color,l.kind==='light'?2.5:1.8);
    // Intersect with the linked now slice; the dot is the actual event at playback time.
    const na=now[0],nb=now[1],nx=nb[0]-na[0],ny=nb[1]-na[1];
    for(let j=1;j<l.points.length;j++){
      const a=coord(l.points[j-1],L),b=coord(l.points[j],L),dx=b[0]-a[0],dy=b[1]-a[1],cross=dx*ny-dy*nx;
      if(Math.abs(cross)<1e-15)continue;const u=((na[0]-a[0])*ny-(na[1]-a[1])*nx)/cross;
      if(u>=0&&u<=1){const x=a[0]+u*dx,y=a[1]+u*dy;if(inside(m,p,x,y,5))s.circle(m.x(x),m.y(y),l.kind==='light'?4:3,color);}
    }
    if(f.breakdown)for(const tick of l.ticks||[]){const [x,y]=coord(tick,L);if(inside(m,p,x,y,3))s.circle(m.x(x),m.y(y),1.8,color);}
  }
  if(calibration){const a=f.geometry.calibration[key];for(let i=1;i<a.length;i++)line(s,m,p,coord(a[i-1],L),coord(a[i],L),colors[2],1.5);}
  for(const e of g.events){const [x,y]=coord(e,L);if(inside(m,p,x,y,4))s.circle(m.x(x),m.y(y),namedEvents(f).some(a=>a.event.id===e.id)?4:2.7,'#e8f2ff');}
  for(const record of namedEvents(f)){const a=coord(key==='moving'?boost(record.event,beta(f.params)):record.event,L);
  if(inside(m,p,...a,4)){s.ctx.strokeStyle='#e8f2ff';s.ctx.beginPath();s.ctx.arc(m.x(a[0]),m.y(a[1]),7,0,2*Math.PI);s.ctx.stroke();}}
  });
  const curve=calibration&&!zoom&&!f.thumbnail&&!f.graph?f.geometry.calibration[key].slice(1).map((b,i)=>{const a=f.geometry.calibration[key][i];return [m.x(a.x/L),m.y(C*a.t/L),m.x(b.x/L),m.y(C*b.t/L)];}):[];
  const guides=[ex,et].map(v=>[m.x(-range*v[0]),m.y(-range*v[1]),m.x(range*v[0]),m.y(range*v[1])]).concat([[-1,-1],[1,-1]].map(([a,c])=>[m.x(-range*a),m.y(-range*c),m.x(range*a),m.y(range*c)])),
    wl=g.worldlines.flatMap(l=>l.points.slice(1).map((q,i)=>{const u=coord(l.points[i],L),w=coord(q,L);return [m.x(u[0]),m.y(u[1]),m.x(w[0]),m.y(w[1])];}));
  const own=[[p.left,m.y(0),p.left+p.width,m.y(0)],[m.x(0),p.top,m.x(0),p.top+p.height]];
  const nowL=g.now.map(a=>coord(a,L)),origins=f.params.scenario==='flashes'||f.params.scenario==='objects'&&g.events.length?g.events.map(e=>coord(e,L)):[zoom?coord(selected(f,key),L):[0,0]];
  const extra=[[m.x(nowL[0][0]),m.y(nowL[0][1]),m.x(nowL[1][0]),m.y(nowL[1][1])],...g.events.map(e=>{const y=m.y(coord(e,L)[1]);return [p.left,y,p.left+p.width,y];}),
    ...(cone?origins.flatMap(a=>[-1,1].map(sg=>[m.x(a[0]-range),m.y(a[1]-sg*range),m.x(a[0]+range),m.y(a[1]+sg*range)])):[])];
  let names=[];
  if(!f.thumbnail)names=axisLabels(s,m,p,{x:primed?'x′ / L':'x / L',y:primed?'ct′ / L':'ct / L',avoid:[...wl,...curve,...guides,...extra,...own]})||[];
  const diag={names,interval:null,worldlines:wl,guides,extra,curve,own};(s.diag||(s.diag={}))[key]=diag;
  if(!f.thumbnail&&!f.graph)for(const record of namedEvents(f))eventLetter(s,f,p,m,key,record,[...curve,...own],[...guides,...extra]);
  // The caption goes last so it keeps clear of the event letters as well.
  if(curve.length)diag.interval=intervalCaption(s,f,p,m,key,curve,[...wl,...guides],extra);
  return m;
}
function spatial(s,f,p){
  const L=f.params.length,selectedFrame=f.params.frame,g=f.geometry[selectedFrame],points=g.worldlines.flatMap(l=>l.points),solids=f.geometry.solids;
  // Full worldline endpoints bound every authored spatial position; never follow motion.
  const xs=points.map(a=>a.x/L),ys=points.map(a=>a.y/L);const extent=Math.max(2,...xs.map(Math.abs),...ys.map(Math.abs));
  const m=mapPanel(s,p,[-extent,extent,-extent,extent],'spatial');axes(s,m,p,{title:f.graph?'':'Spatial slice · '+(selectedFrame==='ground'?'S':'S′'),x:'x / L',y:'y / L',labels:!f.thumbnail});
  clipPanel(s,p,()=>{
  for(const [i,solid] of solids.entries()){
    const a=solid[selectedFrame];a.forEach((v,j)=>{if(a.length>1&&(j||a.length>2)){const prev=a[(j+a.length-1)%a.length];line(s,m,p,[prev.x/L,prev.y/L],[v.x/L,v.y/L],colors[i%6],2);}
      if(inside(m,p,v.x/L,v.y/L,4))s.circle(m.x(v.x/L),m.y(v.y/L),a.length===1?4:2,colors[i%6]);});
  }
  for(const flash of f.geometry.wavefronts)if(flash.visible)for(const ring of flash.rings.slice(0,1))for(let i=1;i<ring.length;i++)line(s,m,p,[ring[i-1].x/L,ring[i-1].y/L],[ring[i].x/L,ring[i].y/L],'#efd1ac',1.5);
  if(!solids.length&&!f.geometry.wavefronts.length){
    for(const [i,l] of g.worldlines.entries()){for(let j=1;j<l.points.length;j++)line(s,m,p,[l.points[j-1].x/L,l.points[j-1].y/L],[l.points[j].x/L,l.points[j].y/L],l.kind==='light'?'#efd1ac60':colors[i%6]+'55',1);
      for(let j=1;j<l.points.length;j++){const a=l.points[j-1],b=l.points[j];if(f.t<a.t||f.t>b.t)continue;const u=(f.t-a.t)/(b.t-a.t),x=(a.x+u*(b.x-a.x))/L,y=(a.y+u*(b.y-a.y))/L;if(inside(m,p,x,y,4))s.circle(m.x(x),m.y(y),l.kind==='light'?4:6,l.kind==='light'?'#efd1ac':colors[i%6]);}}
  }
  });
}
function calculator(s,f,p){
  const c=f.geometry.calculator,isTensor=f.params.scenario==='tensor',values=isTensor?c.tensor.cubeGround.concat(c.tensor.cubeMoving):[c.vector.ground,c.vector.moving];
  const e=Math.max(1,...values.flat().map(Math.abs))*1.25,m=mapPanel(s,p,[-e,e,-e,e],'components');axes(s,m,p,{title:f.graph?'':isTensor?'Tensor · x / ct projection':'Four-vector · x / ct projection',x:'x component',y:'ct component',labels:!f.thumbnail});
  clipPanel(s,p,()=>{
  if(isTensor){for(const [k,arr] of [c.tensor.cubeGround,c.tensor.cubeMoving].entries())for(let i=0;i<16;i++)for(let bit=0;bit<4;bit++){const j=i^(1<<bit);if(j>i)line(s,m,p,[arr[i][1],arr[i][0]],[arr[j][1],arr[j][0]],colors[k]+'90',1);}}
  else [c.vector.ground,c.vector.moving].forEach((a,i)=>s.arrow(m.x(0),m.y(0),m.x(a[1]),m.y(a[0]),colors[i],2.5));
  });
}
export function paramVisible(spec,p){const k=spec.key,sc=p.scenario;
  if(['scenario','frame','beta','length'].includes(k))return true;
  if(k==='uBeta')return sc==='velocity-addition';if(k==='barnRatio')return sc==='pole-barn';
  if(['betaY','betaZ'].includes(k))return ['objects','flashes','four-vector','tensor'].includes(sc);
  if(k.startsWith('vector'))return sc==='four-vector';
  if(k==='symmetry')return sc==='tensor';
  // Tensor and extra-body components remain reachable through validated tutor actions.
  if(k.startsWith('tensor')||k.startsWith('body')&&k!=='bodyCount')return false;
  if(sc!=='objects')return false;
  if(['objectType','bodyCount'].includes(k))return true;
  if(k.startsWith('objectBeta'))return p.objectType!=='flash';
  if(k==='widthRatio')return ['rectangle','rocket','barn'].includes(p.objectType);
  return p.objectType==='flash'&&['emissionTime','offsetX'].includes(k);
}
// Pane geometry shared by drawing and the zoom chips, which sit just under the panes.
function layoutFor(s,f){
  const calc=['four-vector','tensor'].includes(f.params.scenario),spatialZoom=f.closeup==='event'&&['objects','flashes','light-clock'].includes(f.params.scenario);
  const hasEvents=!calc&&!spatialZoom&&namedEvents(f).length>0,tail=f.closeup==='transform'?142:hasEvents?108:46,maxHeight=hasEvents?262:320,opts=s.w<470?{tail,bottom:hasEvents?204:130,top:f.closeup?78:44,maxHeight,maxStacked:160}:{tail,bottom:tail+56,top:f.closeup?78:30,maxHeight,maxStacked:160},ps=panels(s,{...opts,center:true}),last=ps[s.w<470?1:0],calcBase=f.closeup?85:40,ct=tail===142?142:46,calcHeight=Math.min(s.h-calcBase-ct-30,330),calcTop=calcBase+Math.max(0,(s.h-22-calcHeight-ct)/2+22-calcBase);
  return {calc,spatialZoom,hasEvents,ps,calcTop,calcHeight,need:calc?calcBase+330+ct+30:blockHeight(s,opts),cap:(22+(calc?calcHeight:ps[0].height)+(calc?ct:tail))/.72,paneBottom:calc?calcTop+calcHeight:last.top+last.height,paneHeight:calc?calcHeight:ps[0].height,chipTop:(calc?calcTop+calcHeight:last.top+last.height)+4};
}
export const view={closeups,graphs,paramVisible,
  mount(shell){holdShell(shell);shell.scene.style.minHeight='620px';shell.scene.style.flexBasis='620px';},
  graphDescriptors:p=>graphs.filter(g=>g.id==='four-vector'?p.scenario==='four-vector':g.id==='tensor'?p.scenario==='tensor':true).map(g=>g.id==='clocks'?{...g,window:10*gamma(p.beta)*p.length/C}:g),
  key:f=>['four-vector','tensor'].includes(f.params.scenario)?'Blue: S \u00b7 warm: S\u2032':f.closeup==='event'&&['objects','flashes','light-clock'].includes(f.params.scenario)?'Spatial slice'+(f.geometry.wavefronts.some(a=>a.visible)||f.geometry.ground.worldlines.some(a=>a.kind==='light')?' \u00b7 warm: light':''):'Worldlines'+(f.geometry.ground.worldlines.some(a=>a.kind==='light')?' \u00b7 warm: light':'')+' \u00b7 dashed: other-frame axes'+(f.breakdown?' \u00b7 green: c\u00b2t\u00b2 \u2212 x\u00b2 = L\u00b2':''),
  closeupAnchors:(s,f)=>{const l=layoutFor(s,f),xs=s.w<470||l.calc?[s.w*.27,s.w*.73]:l.ps.map(a=>a.left+a.width/2);return {event:{x:xs[0],y:l.chipTop},transform:{x:xs[1],y:l.chipTop}};},
  draw(s,f){
    if(f.thumbnail||s.w<200||s.h<180){f={...f,thumbnail:true,breakdown:false};drawDiagram(s,f,{left:28,top:28,width:s.w-45,height:s.h-58},'ground',{cone:true});return;}
    const layout=layoutFor(s,f),{hasEvents,ps}=layout;fitScene(s,layout.need,620,f.breakdown?layout.cap:0);s.paneBottom=layout.paneBottom;s.paneHeight=layout.paneHeight;
    if(['four-vector','tensor'].includes(f.params.scenario))calculator(s,f,{left:40,top:layout.calcTop,width:s.w-65,height:layout.calcHeight});
    else if(f.closeup==='event'&&['objects','flashes','light-clock'].includes(f.params.scenario))spatial(s,f,{left:40,top:85,width:s.w-65,height:s.h-190});
    else for(const [i,k] of ['ground','moving'].entries())drawDiagram(s,f,ps[i],k,{cone:true,calibration:f.breakdown,zoom:!!f.closeup});
    if(hasEvents)eventReadouts(f).forEach((text,i)=>s.text(text,s.w/2,layout.chipTop+46+i*18,'#b8cce4',s.w<470?10:11));
    if(f.closeup==='transform')s.text(`\u03b2 = ${num(f.params.beta,3)}    \u03b3 = ${num(f.sample.gamma,3)}`,s.w/2,layout.chipTop+46+4*18+14,'#bfd0e7',s.w<470?10:12);
    s.camera={bounds:[...(s.w<470?context(f).narrowBounds:context(f).bounds)],zoom:f.closeup};s.snap=false;
  },
  equations(f){const a=context(f).selected,b=boost(a,beta(f.params)),L=f.params.length,g=f.sample.gamma;
    const threeD=typeof beta(f.params)==='object'&&(f.params.betaY||f.params.betaZ);
    const formula=threeD?['ct\'=\\gamma(ct-\\boldsymbol\\beta\\cdot\\mathbf r)',
      '\\begin{gathered}\\mathbf r\'=\\mathbf r+A\\boldsymbol\\beta\\\\A=(\\gamma-1)\\frac{\\boldsymbol\\beta\\cdot\\mathbf r}{\\beta^2}-\\gamma ct\\end{gathered}']:['\\begin{gathered}x\'=\\gamma(x-\\beta ct)\\\\ct\'=\\gamma(ct-\\beta x)\\end{gathered}'];
    const calculator=f.params.scenario==='four-vector'?[`A_\\mu A^\\mu=${tex(f.sample.vectorNorm)}`]:f.params.scenario==='tensor'?[`T_{\\mu\\nu}T^{\\mu\\nu}=${tex(f.sample.tensorContraction)}`]:[];
    return [...formula,
      threeD?`\\begin{gathered}\\boldsymbol\\beta=(${tex(f.params.beta)},${tex(f.params.betaY)},${tex(f.params.betaZ)})\\\\\\gamma=${tex(g)}\\end{gathered}`:`\\beta=${tex(f.params.beta)},\\quad\\gamma=${tex(g)}`,
      `\\begin{gathered}x/L=${tex(a.x/L)},\\quad ct/L=${tex(C*a.t/L)}\\\\x'/L=${tex(b.x/L)},\\quad ct'/L=${tex(C*b.t/L)}\\end{gathered}`,
      '\\Delta s^2=c^2\\Delta t^2-\\Delta x^2-\\Delta y^2-\\Delta z^2',
      `\\begin{gathered}s^2/L^2=${tex(interval(a)/L**2)}\\\\\\text{in both }S\\text{ and }S'\\end{gathered}`,...calculator];
  },
  closeupEquation(f){const p=f.params,L=p.length,T=L/C,b=p.beta,g=f.sample.gamma;
    if(f.closeup==='transform')return view.equations(f).slice(0,3);
    switch(p.scenario){
      case 'moving-mirror':case 'comoving-mirrors':return ['ct=L+vt',`t_{hit}=\\frac{L}{c-v}=\\frac{${tex(T)}}{1-(${tex(b)})}=${tex(f.sample.catchTime)}\\,\\mathrm{s}`,p.scenario==='moving-mirror'?'t_{round}=2L/(c-v)':'t_{round}=L/(c-v)+L/(c+v)',`t_{round}=${tex(f.sample.roundTripTime)}\\,\\mathrm{s}`];
      case 'light-clock':return ['(c\\Delta t/2)^2=L^2+(v\\Delta t/2)^2',`\\Delta t=\\gamma\\,2L/c=${tex(g)}(2)(${tex(T)})=${tex(2*g*T)}\\,\\mathrm{s}`];
      case 'twins':return ['\\tau=\\int\\sqrt{1-u^2/c^2}\\,dt',`\\tau_{home}=${tex(f.sample.homeAge)}\\,\\mathrm{s}`,`\\tau_{travel}=${tex(f.sample.travelerAge)}\\,\\mathrm{s}`];
      case 'velocity-addition':return ['u=\\frac{u\'+v}{1+u\'v/c^2}',`u/c=\\frac{${tex(p.uBeta)}+(${tex(b)})}{1+(${tex(p.uBeta)})(${tex(b)})}=${tex(addVelocity(p.uBeta*C,b*C)/C)}`];
      case 'objects':{if(p.objectType==='flash')return ['|\\mathbf r-\\mathbf r_e|=c(t-t_e)',`R/c=${tex((f.geometry.wavefronts[0]?.radius||0)/C)}\\,\\mathrm{s}`];const restGamma=gamma(Math.hypot(p.objectBetaX,p.objectBetaY,p.objectBetaZ)),gu=p.frame==='moving'?boost({t:restGamma,x:restGamma*C*p.objectBetaX,y:restGamma*C*p.objectBetaY,z:restGamma*C*p.objectBetaZ},beta(p)).t:restGamma,vertices=f.geometry.solids[0]?.[p.frame]||[],xs=vertices.map(a=>a.x);return ['\\Delta r_{parallel}=\\Delta r_{0,parallel}/\\gamma_u',`\\gamma_u=${tex(gu)}`,`\\Delta x=${tex((xs.length?(Math.max(...xs)-Math.min(...xs))/C:0))}\\,\\mathrm{light\\ seconds}`,'\\Delta t=0\\quad\\text{in the measuring frame}'];}
      case 'length-contraction':case 'pole-barn':return ['L=L_0/\\gamma',`L=${tex(T)}/${tex(g)}=${tex(T/g)}\\,\\mathrm{light\\ seconds}`,'\\Delta t=0\\quad\\text{in the measuring frame}'];
      case 'flashes':return ['|\\mathbf r-\\mathbf r_e|=c(t-t_e)',`t=${tex(f.t)}\\,\\mathrm{s}`,'c^2\\Delta t^2-|\\Delta\\mathbf r|^2=0'];
      case 'four-vector':return ['A\'=\\Lambda A',`A_\\mu A^\\mu=${tex(f.sample.vectorNorm)}`];
      case 'tensor':return ['T\'=\\Lambda T\\Lambda^T',`T_{\\mu\\nu}T^{\\mu\\nu}=${tex(f.sample.tensorContraction)}`];
      default:return ['\\Delta t\'=\\gamma(\\Delta t-\\beta\\Delta x/c)',`\\Delta t'=-(${tex(g)})(${tex(b)})(${tex(T)})=${tex(f.sample.simultaneityOffset)}\\,\\mathrm{s}`];
    }
  },
  drawGraph(s,d,f){
    f={...f,graph:true};
    const p={left:40,top:38,width:s.w-60,height:s.h-75};
    if(d.id==='worldlines'){
      const key=f.params.frame==='moving'?'moving':'ground',lines=f.geometry[key].worldlines,l=lines.find(l=>l.kind==='light')||lines[0];
      const points=l?.points.map(a=>[C*a.t/f.params.length,a.x/f.params.length])||[];let marker=null;
      for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];const ct=C*f.t/f.params.length;if(ct>=a[0]&&ct<=b[0])marker=[ct,a[1]+(b[1]-a[1])*(ct-a[0])/(b[0]-a[0])];}
      plot(s,{title:(l?.label||'Position')+' · '+(key==='ground'?'S':'S′'),xLabel:'ct / L',yLabel:'x / L',points,marker});return;
    }
    if(d.id==='spatial'){spatial(s,f,p);return;}
    if(d.id==='four-vector'||d.id==='tensor'){calculator(s,f,p);return;}
    const key=f.params.frame==='moving'?'moving':'ground';drawDiagram(s,f,p,key,{cone:true,calibration:d.id==='calibration'});
    s.text(`cursor t = ${num(f.t,3)} s`,s.w/2,s.h-7,'#9eb0c9',10);
  },
};
