import {C,boost,interval,gamma,addVelocity} from './model.js';
import {colors,fmt,panels,mapPanel,line,inside,axes,plot} from './drawing.js';
const cache=new WeakMap();
export const closeups=[{id:'event',label:'Zoom · events'},{id:'transform',label:'Zoom · transform'}];
export const graphs=[
  {id:'worldlines',label:'Position vs time',kind:'custom'},{id:'clocks',label:'Clock ages',unit:'s',series:[{key:'groundTime',label:'ground',color:colors[0]},{key:'properTime',label:'proper',color:colors[1]}]},
  {id:'light-cone',label:'Light cone',kind:'custom'},{id:'calibration',label:'Calibration',kind:'custom'},
  {id:'spatial',label:'Spatial view',kind:'custom'},{id:'four-vector',label:'Four-vector',kind:'custom'},{id:'tensor',label:'Tensor',kind:'custom'},
];
function beta(p){return ['objects','flashes','four-vector','tensor'].includes(p.scenario)?{x:p.beta,y:p.betaY,z:p.betaZ}:p.beta;}
const invert=b=>typeof b==='number'?-b:{x:-b.x,y:-b.y,z:-b.z};
const coord=(a,L)=>[a.x/L,C*a.t/L];
export function boundsFor(g,L){
  const points=['ground','moving'].flatMap(k=>[...g[k].events,...g[k].worldlines.flatMap(l=>l.points)]).map(a=>coord(a,L));
  if(!points.length)return [-2,2,-1,3];
  let x0=Math.min(-.3,...points.map(a=>a[0])),x1=Math.max(.3,...points.map(a=>a[0])),y0=Math.min(-.3,...points.map(a=>a[1])),y1=Math.max(.3,...points.map(a=>a[1]));
  const dx=(x1-x0)*.13,dy=(y1-y0)*.1;return [x0-dx,x1+dx,y0-dy,y1+dy];
}
function context(f){let c=cache.get(f.instance);if(!c){const g=f.geometry,L=f.params.length;
  c={bounds:boundsFor(g,L),selected:g.ground.events.find(e=>e.id==='reflect'||e.id==='turn'||e.id==='right-strike')||g.ground.events.at(-1)||{t:0,x:0,y:0,z:0}};cache.set(f.instance,c);}return c;}
function selected(f,key){const c=context(f);return key==='moving'?boost(c.selected,beta(f.params)):c.selected;}
function eventBounds(f,key){const a=coord(selected(f,key),f.params.length),span=Math.max(.4,Math.min(1.4,(context(f).bounds[3]-context(f).bounds[2])*.18));return [a[0]-span,a[0]+span,a[1]-span,a[1]+span];}
function drawDiagram(s,f,p,key,{cone=true,calibration=false,zoom=false}={}){
  const L=f.params.length,g=f.geometry[key],b=beta(f.params),base=context(f).bounds;
  const bounds=zoom?eventBounds(f,key):base,m=mapPanel(s,p,bounds,key),primed=key==='moving';
  axes(s,m,p,{title:primed?'S′ · moving frame':'S · ground frame',x:primed?'x′ / L':'x / L',y:primed?'ct′ / L':'ct / L',labels:!f.thumbnail});
  // The other frame's axes are transformed basis vectors, not an ordinary rotation.
  const transform=primed?b:invert(b),ex=coord(boost({t:0,x:L},transform),L),et=coord(boost({t:L/C,x:0},transform),L);
  const range=Math.max(...bounds.map(Math.abs))*4+4;
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
  for(const e of g.events){const [x,y]=coord(e,L);if(inside(m,p,x,y,4))s.circle(m.x(x),m.y(y),e.id===context(f).selected.id?4:2.7,'#e8f2ff');}
  const a=coord(selected(f,key),L);
  if(inside(m,p,...a,4)){s.ctx.strokeStyle='#e8f2ff';s.ctx.beginPath();s.ctx.arc(m.x(a[0]),m.y(a[1]),7,0,2*Math.PI);s.ctx.stroke();}
  // A fixed pane caption avoids labels chasing crossing rays/events.
  return m;
}
function spatial(s,f,p){
  const L=f.params.length,selectedFrame=f.params.frame,g=f.geometry[selectedFrame],points=g.worldlines.flatMap(l=>l.points),solids=f.geometry.solids;
  // Full worldline endpoints bound every authored spatial position; never follow motion.
  const xs=points.map(a=>a.x/L),ys=points.map(a=>a.y/L);const extent=Math.max(2,...xs.map(Math.abs),...ys.map(Math.abs));
  const m=mapPanel(s,p,[-extent,extent,-extent,extent],'spatial');axes(s,m,p,{title:'Spatial slice · '+(selectedFrame==='ground'?'S':'S′'),x:'x / L',y:'y / L',labels:!f.thumbnail});
  for(const [i,solid] of solids.entries()){
    const a=solid[selectedFrame];a.forEach((v,j)=>{if(a.length>1&&(j||a.length>2)){const prev=a[(j+a.length-1)%a.length];line(s,m,p,[prev.x/L,prev.y/L],[v.x/L,v.y/L],colors[i%6],2);}
      if(inside(m,p,v.x/L,v.y/L,4))s.circle(m.x(v.x/L),m.y(v.y/L),a.length===1?4:2,colors[i%6]);});
  }
  for(const flash of f.geometry.wavefronts)if(flash.visible)for(const ring of flash.rings.slice(0,1))for(let i=1;i<ring.length;i++)line(s,m,p,[ring[i-1].x/L,ring[i-1].y/L],[ring[i].x/L,ring[i].y/L],'#efd1ac',1.5);
  if(!solids.length&&!f.geometry.wavefronts.length){
    for(const [i,l] of g.worldlines.entries()){for(let j=1;j<l.points.length;j++)line(s,m,p,[l.points[j-1].x/L,l.points[j-1].y/L],[l.points[j].x/L,l.points[j].y/L],l.kind==='light'?'#efd1ac60':colors[i%6]+'55',1);
      for(let j=1;j<l.points.length;j++){const a=l.points[j-1],b=l.points[j];if(f.t<a.t||f.t>b.t)continue;const u=(f.t-a.t)/(b.t-a.t),x=(a.x+u*(b.x-a.x))/L,y=(a.y+u*(b.y-a.y))/L;if(inside(m,p,x,y,4))s.circle(m.x(x),m.y(y),l.kind==='light'?4:6,l.kind==='light'?'#efd1ac':colors[i%6]);}}
  }
}
function calculator(s,f,p){
  const c=f.geometry.calculator,isTensor=f.params.scenario==='tensor',values=isTensor?c.tensor.cubeGround.concat(c.tensor.cubeMoving):[c.vector.ground,c.vector.moving];
  const e=Math.max(1,...values.flat().map(Math.abs))*1.25,m=mapPanel(s,p,[-e,e,-e,e],'components');axes(s,m,p,{title:isTensor?'Tensor · x / ct projection':'Four-vector · x / ct projection',x:'x component',y:'ct component',labels:!f.thumbnail});
  if(isTensor){for(const [k,arr] of [c.tensor.cubeGround,c.tensor.cubeMoving].entries())for(let i=0;i<16;i++)for(let bit=0;bit<4;bit++){const j=i^(1<<bit);if(j>i)line(s,m,p,[arr[i][1],arr[i][0]],[arr[j][1],arr[j][0]],colors[k]+'90',1);}}
  else [c.vector.ground,c.vector.moving].forEach((a,i)=>s.arrow(m.x(0),m.y(0),m.x(a[1]),m.y(a[0]),colors[i],2.5));
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
export const view={closeups,graphs,paramVisible,
  mount(shell){shell.scene.style.minHeight='440px';shell.scene.style.flexBasis='440px';},
  graphDescriptors:p=>graphs.filter(g=>g.id==='four-vector'?p.scenario==='four-vector':g.id==='tensor'?p.scenario==='tensor':true),
  key:f=>f.closeup==='transform'?'Blue: S · warm: S′ · interval stays invariant':'Bodies · warm light · dashed: other frame axes',
  closeupAnchors:s=>({event:{x:s.w*.28,y:s.h-74},transform:{x:s.w*.73,y:s.h-74}}),
  draw(s,f){
    if(f.thumbnail||s.w<200||s.h<180){f={...f,thumbnail:true,breakdown:false};drawDiagram(s,f,{left:28,top:28,width:s.w-45,height:s.h-58},'ground',{cone:true});return;}
    const ps=panels(s,{bottom:130,top:f.closeup?78:44});
    if(['four-vector','tensor'].includes(f.params.scenario))calculator(s,f,{left:40,top:f.closeup?85:55,width:s.w-65,height:s.h-(f.closeup?190:160)});
    else if(f.closeup==='event'&&['objects','flashes','light-clock'].includes(f.params.scenario))spatial(s,f,{left:40,top:85,width:s.w-65,height:s.h-190});
    else for(const [i,k] of ['ground','moving'].entries())drawDiagram(s,f,ps[i],k,{cone:true,calibration:f.breakdown,zoom:!!f.closeup});
    const event=context(f).selected;
    s.text(f.closeup==='transform'?`β = ${fmt(f.params.beta)}    γ = ${fmt(f.sample.gamma)}`:(event.label||'Selected origin event'),s.w/2,s.h-103,'#bfd0e7',s.w<470?10:12);
    s.camera={bounds:[...context(f).bounds],zoom:f.closeup};s.snap=false;
  },
  equations(f){const a=context(f).selected,b=boost(a,beta(f.params)),L=f.params.length,g=f.sample.gamma;
    const threeD=typeof beta(f.params)==='object'&&(f.params.betaY||f.params.betaZ);
    const formula=threeD?['ct\'=\\gamma(ct-\\boldsymbol\\beta\\cdot\\mathbf r)',
      '\\begin{gathered}\\mathbf r\'=\\mathbf r+A\\boldsymbol\\beta\\\\A=(\\gamma-1)\\frac{\\boldsymbol\\beta\\cdot\\mathbf r}{\\beta^2}-\\gamma ct\\end{gathered}']:['\\begin{gathered}x\'=\\gamma(x-\\beta ct)\\\\ct\'=\\gamma(ct-\\beta x)\\end{gathered}'];
    const calculator=f.params.scenario==='four-vector'?[`A_\\mu A^\\mu=${fmt(f.sample.vectorNorm)}`]:f.params.scenario==='tensor'?[`T_{\\mu\\nu}T^{\\mu\\nu}=${fmt(f.sample.tensorContraction)}`]:[];
    return [...formula,
      threeD?`\\begin{gathered}\\boldsymbol\\beta=(${fmt(f.params.beta)},${fmt(f.params.betaY)},${fmt(f.params.betaZ)})\\\\\\gamma=${fmt(g)}\\end{gathered}`:`\\beta=${fmt(f.params.beta)},\\quad\\gamma=${fmt(g)}`,
      `\\begin{gathered}x/L=${fmt(a.x/L)},\\quad ct/L=${fmt(C*a.t/L)}\\\\x'/L=${fmt(b.x/L)},\\quad ct'/L=${fmt(C*b.t/L)}\\end{gathered}`,
      '\\Delta s^2=c^2\\Delta t^2-\\Delta x^2-\\Delta y^2-\\Delta z^2',
      `s^2/L^2=${fmt(interval(a)/L**2)}=${fmt(interval(b)/L**2)}\\quad(S,S')`,...calculator];
  },
  closeupEquation(f){const p=f.params,L=p.length,T=L/C,b=p.beta,g=f.sample.gamma;
    if(f.closeup==='transform')return view.equations(f).slice(0,3);
    switch(p.scenario){
      case 'moving-mirror':case 'comoving-mirrors':return ['ct=L+vt',`t_{hit}=\\frac{L}{c-v}=\\frac{${fmt(T)}}{1-(${fmt(b)})}=${fmt(f.sample.catchTime)}\\,\\mathrm{s}`,p.scenario==='moving-mirror'?'t_{round}=2L/(c-v)':'t_{round}=L/(c-v)+L/(c+v)',`t_{round}=${fmt(f.sample.roundTripTime)}\\,\\mathrm{s}`];
      case 'light-clock':return ['(c\\Delta t/2)^2=L^2+(v\\Delta t/2)^2',`\\Delta t=\\gamma\\,2L/c=${fmt(g)}(2)(${fmt(T)})=${fmt(2*g*T)}\\,\\mathrm{s}`];
      case 'twins':return ['\\tau=\\int\\sqrt{1-u^2/c^2}\\,dt',`\\tau_{home}=${fmt(f.sample.homeAge)}\\,\\mathrm{s}`,`\\tau_{travel}=${fmt(f.sample.travelerAge)}\\,\\mathrm{s}`];
      case 'velocity-addition':return ['u=\\frac{u\'+v}{1+u\'v/c^2}',`u/c=\\frac{${fmt(p.uBeta)}+(${fmt(b)})}{1+(${fmt(p.uBeta)})(${fmt(b)})}=${fmt(addVelocity(p.uBeta*C,b*C)/C)}`];
      case 'objects':{if(p.objectType==='flash')return ['|\\mathbf r-\\mathbf r_e|=c(t-t_e)',`R/c=${fmt((f.geometry.wavefronts[0]?.radius||0)/C)}\\,\\mathrm{s}`];const restGamma=gamma(Math.hypot(p.objectBetaX,p.objectBetaY,p.objectBetaZ)),gu=p.frame==='moving'?boost({t:restGamma,x:restGamma*C*p.objectBetaX,y:restGamma*C*p.objectBetaY,z:restGamma*C*p.objectBetaZ},beta(p)).t:restGamma,vertices=f.geometry.solids[0]?.[p.frame]||[],xs=vertices.map(a=>a.x);return ['\\Delta r_{parallel}=\\Delta r_{0,parallel}/\\gamma_u',`\\gamma_u=${fmt(gu)}`,`\\Delta x=${fmt((xs.length?(Math.max(...xs)-Math.min(...xs))/C:0))}\\,\\mathrm{light\\ seconds}`,'\\Delta t=0\\quad\\text{in the measuring frame}'];}
      case 'length-contraction':case 'pole-barn':return ['L=L_0/\\gamma',`L=${fmt(T)}/${fmt(g)}=${fmt(T/g)}\\,\\mathrm{light\\ seconds}`,'\\Delta t=0\\quad\\text{in the measuring frame}'];
      case 'flashes':return ['|\\mathbf r-\\mathbf r_e|=c(t-t_e)',`t=${fmt(f.t)}\\,\\mathrm{s}`,'c^2\\Delta t^2-|\\Delta\\mathbf r|^2=0'];
      case 'four-vector':return ['A\'=\\Lambda A',`A_\\mu A^\\mu=${fmt(f.sample.vectorNorm)}`];
      case 'tensor':return ['T\'=\\Lambda T\\Lambda^T',`T_{\\mu\\nu}T^{\\mu\\nu}=${fmt(f.sample.tensorContraction)}`];
      default:return ['\\Delta t\'=\\gamma(\\Delta t-\\beta\\Delta x/c)',`\\Delta t'=-(${fmt(g)})(${fmt(b)})(${fmt(T)})=${fmt(f.sample.simultaneityOffset)}\\,\\mathrm{s}`];
    }
  },
  drawGraph(s,d,f){
    const p={left:40,top:38,width:s.w-60,height:s.h-75};
    if(d.id==='worldlines'){
      const key=f.params.frame==='moving'?'moving':'ground',lines=f.geometry[key].worldlines,l=lines.find(l=>l.kind==='light')||lines[0];
      const points=l?.points.map(a=>[a.t,a.x/f.params.length])||[];let marker=null;
      for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(f.t>=a[0]&&f.t<=b[0])marker=[f.t,a[1]+(b[1]-a[1])*(f.t-a[0])/(b[0]-a[0])];}
      plot(s,{title:(l?.label||'Position')+' · '+(key==='ground'?'S':'S′'),xLabel:'coordinate time · s',yLabel:'x / L',points,marker});return;
    }
    if(d.id==='spatial'){spatial(s,f,p);return;}
    if(d.id==='four-vector'||d.id==='tensor'){calculator(s,f,p);return;}
    const key=f.params.frame==='moving'?'moving':'ground';drawDiagram(s,f,p,key,{cone:true,calibration:d.id==='calibration'});
    s.text(`cursor t = ${fmt(f.t)} s`,s.w/2,s.h-7,'#9eb0c9',10);
  },
};
