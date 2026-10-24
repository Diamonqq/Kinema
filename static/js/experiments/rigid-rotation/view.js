import * as THREE from '/vendor/three/build/three.module.js';
import {model} from './model.js';
import {num,texNum} from '../kit/format.js';

// z is up in both the physics and the drawing. Vectors have independent SI scales.
const C={omega:'#82b5ff',L:'#8fd5b4',torque:'#efa67f',axes:['#d99ba8','#d7c77e','#a7a0df'],body:'#6f92bd'};
const norm=v=>Math.hypot(...v);
export const readoutNumber=num;
const v=a=>new THREE.Vector3(...a), q=a=>new THREE.Quaternion(a[1],a[2],a[3],a[0]);
export const closeups=[
 {id:'body',label:'Body frame'},{id:'frames',label:'Compare frames'},
 {id:'axis',label:'Zoom · middle axis'},{id:'inertia',label:'Zoom · inertia'},
 {id:'gravity',label:'Zoom · gravity'},{id:'tilt',label:'Zoom · CM torque'},
 {id:'precession',label:'Zoom · precession'},{id:'energy',label:'Zoom · energy geometry'},
 {id:'support',label:'Zoom · support'},
];
// Every legend entry owns a visible curve. Without a potential energy E is the kinetic energy itself, and without an external torque W stays at zero, so those entries are named or dropped.
const sentenceCase=text=>text?text[0].toUpperCase()+text.slice(1):text;
export function energySeries(params){const heavy=params.mode==='heavy-top'?params.mass*params.g*params.distance:params.mode==='tilt-torque'?params.tiltTorque:0,hasU=Math.abs(heavy)>1e-12,hasW=params.mode!=='fixed-axis'&&Math.hypot(params.torquex||0,params.torquey||0,params.torquez||0)>1e-12;
 return [...(hasU?[{key:'energy',label:'E',color:C.L},{key:'kinetic',label:'T',color:C.omega},{key:'potential',label:'U',color:C.torque}]:[{key:'kinetic',label:'E = T',color:C.omega}]),...(hasW?[{key:'work',label:'W',color:'#d6bd7f'}]:[])];}
export const graphs=[
 {id:'omega',label:'Body angular velocity',unit:'rad/s',series:[{key:'w1',label:'ω₁',color:C.axes[0]},{key:'w2',label:'ω₂',color:C.axes[1]},{key:'w3',label:'ω₃',color:C.axes[2]}]},
 {id:'energy',label:'Energy and external work',unit:'J',series:[{key:'energy',label:'E',color:C.L},{key:'kinetic',label:'T',color:C.omega},{key:'potential',label:'U',color:C.torque},{key:'work',label:'W',color:'#d6bd7f'}]},
 {id:'momentum',label:'Space angular momentum',unit:'kg m²/s',series:[{key:'Lx',label:'Lx',color:C.axes[0]},{key:'Ly',label:'Ly',color:C.axes[1]},{key:'Lz',label:'Lz',color:C.axes[2]},{key:'angularMomentum',label:'|L|',color:C.L}]},
 {id:'angles',label:'Tilt',unit:'rad',series:[{key:'theta',label:'θ',color:C.omega}]},
 {id:'precession',label:'Space precession rate',unit:'rad/s',series:[{key:'precessionRate',label:'φ̇',color:C.L}]},
 {id:'polhode',label:'Body polhode projection',unit:'rad/s',kind:'phase',series:[{key:'w1',label:'ω₁'},{key:'w3',label:'ω₃'}]},
];
for(const graph of graphs)if(!graph.kind)graph.window=12;
// Estimate two near-separatrix flips, or five linearized/precession periods.
// This only evaluates the initial state; it never integrates a preview eagerly.
export function graphWindow(params){
 const instance=model.create(params),g=instance.geometry(),s=instance.sample(),I=g.principalMoments,w=g.omegaBody;
 let seconds;
 if(params.mode==='heavy-top'||params.mode==='tilt-torque')seconds=10*Math.PI/Math.max(.01,Math.abs(s.precessionRate)||Math.abs(g.tiltTorqueCoefficient/(I[2]*w[2]||1)));
 else {const i=w.reduce((a,x,j)=>Math.abs(x)>Math.abs(w[a])?j:a,0),j=(i+1)%3,k=(i+2)%3;
  const rate=Math.abs(w[i])*Math.sqrt(Math.abs((I[i]-I[j])*(I[i]-I[k])/(I[j]*I[k])));
  const unstable=(I[i]-I[j])*(I[i]-I[k])<0;
  seconds=unstable?4*Math.log(Math.max(4,4*Math.abs(w[i])/Math.max(1e-6,Math.hypot(w[j],w[k]))))/Math.max(.01,rate):10*Math.PI/Math.max(.01,rate||norm(w));
 }
 return Math.max(.2,Math.min(60,seconds));
}
export function available(f){const p=f.params;return ['body','frames','inertia',...(p.mode==='free'?['axis','energy']:p.mode==='heavy-top'?['gravity','precession']:p.mode==='tilt-torque'?['tilt','precession']:['support'])];}
function euler(f){const {principalMoments:I,omegaBody:w,torqueBody:t}=f.geometry;return I.map((a,i)=>{const j=(i+1)%3,k=(i+2)%3,alpha=(t[i]+(I[j]-I[k])*w[j]*w[k])/a;return [`I_${i+1}\\dot\\omega_${i+1}=\\tau_${i+1}+(I_${j+1}-I_${k+1})\\omega_${j+1}\\omega_${k+1}`,f.narrow?`\\dot\\omega_${i+1}=${texNum(alpha)}\\,\\mathrm{rad/s^2}`:`\\dot\\omega_${i+1}=\\frac{${texNum(t[i])}+(${texNum(I[j])}-${texNum(I[k])})(${texNum(w[j])})(${texNum(w[k])})}{${texNum(a)}}=${texNum(alpha)}\\,\\mathrm{rad/s^2}`];}).flat();}
function rawCloseupEquations(f){const g=f.geometry,p=f.params,s=f.sample,I=g.principalMoments;
 switch(f.closeup){
 case 'body':case 'frames':return ['\\mathbf L_s=R(q)\\mathbf L_b,\\quad\\boldsymbol\\omega_s=R(q)\\boldsymbol\\omega_b',`L_1=I_1\\omega_1=(${texNum(I[0])})(${texNum(g.omegaBody[0])})=${texNum(g.angularMomentumBody[0])}\\,\\mathrm{kg\\,m^2/s}`];
 case 'axis':{const rate=Math.abs(g.omegaBody[1])*Math.sqrt(Math.max(0,(I[2]-I[1])*(I[1]-I[0])/(I[0]*I[2])));return ['\\lambda=|\\omega_2|\\sqrt{\\frac{(I_3-I_2)(I_2-I_1)}{I_1I_3}}',`\\lambda=${texNum(rate)}\\,\\mathrm{s}^{-1}\\quad\\text{(linear regime)}`];}
 case 'inertia':return [p.shape==='box'?'I_1=\\frac{m(b^2+c^2)}{12}':p.shape==='corner-masses'?'I_1=\\frac{m(b^2+c^2)}4':p.shape==='plate'?'I_3=I_1+I_2':p.shape==='custom'?'\\text{Entered principal moments about CM}':'I_3=\\tfrac12 m(a/2)^2',`(I_1,I_2,I_3)_{\\rm CM}=(${g.centreMoments.map(x=>texNum(x)).join(',')})\\,\\mathrm{kg\\,m^2}`];
 case 'gravity':return ['\\boldsymbol\\tau_g=\\mathbf r\\times(-mg\\hat{\\mathbf z})',...(f.narrow?['|\\tau_g|=mgd\\sin\\theta',`|\\tau_g|=${texNum(norm(g.tiltTorqueSpace))}\\,\\mathrm{N\\,m}`]:[`|\\tau_g|=mgd\\sin\\theta=(${texNum(p.mass*p.g*p.distance)})\\sin(${texNum(s.theta)})=${texNum(norm(g.tiltTorqueSpace))}\\,\\mathrm{N\\,m}`]),'\\frac{d\\mathbf L}{dt}=\\boldsymbol\\tau_g+\\boldsymbol\\tau_{ext}'];
 case 'tilt':return ['\\boldsymbol\\tau=\\kappa\\hat{\\mathbf z}\\times\\hat{\\mathbf e}_3',`|\\tau|=|${texNum(p.tiltTorque)}|\\sin(${texNum(s.theta)})=${texNum(norm(g.tiltTorqueSpace))}\\,\\mathrm{N\\,m}`,`U=\\kappa\\cos\\theta=${texNum(p.tiltTorque*Math.cos(s.theta))}\\,\\mathrm J`];
 case 'precession':return ['I_1\\cos\\theta\\,\\Omega^2-I_3\\omega_3\\Omega+C=0',`C=${texNum(g.tiltTorqueCoefficient)}\\,\\mathrm{N\\,m},\\quad\\dot\\phi=${texNum(s.precessionRate)}\\,\\mathrm{rad/s}`,`\\theta=${texNum(s.theta)}\\,\\mathrm{rad}`];
 case 'energy':return ['\\sum_i I_i\\omega_i^2=2T=\\boldsymbol\\omega\\cdot\\mathbf L',`2T=${texNum(2*s.kinetic)}\\,\\mathrm J`,'\\text{Body polhode; space herpolhode on }\\boldsymbol\\omega\\cdot\\mathbf L=2T'];
 case 'support':return ['\\boldsymbol\\tau_{support}=\\boldsymbol\\omega\\times\\mathbf L',`\\boldsymbol\\tau\\cdot\\boldsymbol\\omega=${texNum(g.torqueSpace.reduce((a,t,i)=>a+t*g.omegaSpace[i],0))}\\,\\mathrm W`];
 default:return [];
 }
}
export function closeupEquations(f){
 if(!f.narrow)return rawCloseupEquations(f);
 const g=f.geometry,p=f.params,s=f.sample;
 switch(f.closeup){
 case 'body':case 'frames':return ['\\mathbf L_s=R(q)\\mathbf L_b','\\boldsymbol\\omega_s=R(q)\\boldsymbol\\omega_b',`L_1=I_1\\omega_1=${texNum(g.angularMomentumBody[0])}\\,\\mathrm{kg\\,m^2/s}`];
 case 'inertia':return [rawCloseupEquations(f)[0],...g.centreMoments.map((x,i)=>`I_{${i+1},\\rm CM}=${texNum(x)}\\,\\mathrm{kg\\,m^2}`)];
 case 'tilt':return ['\\boldsymbol\\tau=\\kappa\\hat{\\mathbf z}\\times\\hat{\\mathbf e}_3','|\\tau|=|\\kappa|\\sin\\theta',`|\\tau|=${texNum(norm(g.tiltTorqueSpace))}\\,\\mathrm{N\\,m}`,`U=\\kappa\\cos\\theta=${texNum(p.tiltTorque*Math.cos(s.theta))}\\,\\mathrm J`];
 case 'precession':return [rawCloseupEquations(f)[0],`C=${texNum(g.tiltTorqueCoefficient)}\\,\\mathrm{N\\,m}`,`\\dot\\phi=${texNum(s.precessionRate)}\\,\\mathrm{rad/s}`,`\\theta=${texNum(s.theta)}\\,\\mathrm{rad}`];
 case 'energy':return [rawCloseupEquations(f)[0],`2T=${texNum(2*s.kinetic)}\\,\\mathrm J`,'\\text{Body polhode; space herpolhode}'];
 default:return rawCloseupEquations(f);
 }
}
// Retained GPU resources. Capacity covers the existing 800-point trace exactly.
export function createRetainedLayer(group,T=THREE){
 const arrows=new Map(),lines=new Map(),meshes=new Map(),direction=new T.Vector3();let ai=0,li=0;
 const allocations={arrows:0,lines:0,meshes:0,labels:0,leaders:0};
 return {allocations,begin(){ai=li=0;for(const o of group.children)o.visible=false;},clear(){dispose(group);arrows.clear();lines.clear();meshes.clear();},
  arrow(origin,vector,length,color,role){const key=role??ai++;if(norm(vector)<1e-10)return null;let a=arrows.get(key);if(!a){a=new T.ArrowHelper(direction.set(0,1,0),direction.set(0,0,0),1,color);a.traverse(o=>{o.renderOrder=30;if(o.material){o.material.depthTest=false;o.material.depthWrite=false;o.material.transparent=true;}});group.add(a);arrows.set(key,a);allocations.arrows++;}a.visible=true;a.position.fromArray(origin);a.setDirection(direction.fromArray(vector).normalize());a.setLength(length,Math.min(.09,length*.22),Math.min(.05,length*.12));if(a.userData.color!==color){a.setColor(color);a.userData.color=color;}return a;},
  line(points,color,dashed=false){const key=(li++)+':'+dashed;let mesh=lines.get(key);if(!mesh){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(800*3),3));if(dashed)geometry.setAttribute('lineDistance',new T.BufferAttribute(new Float32Array(800),1));const material=dashed?new T.LineDashedMaterial({color,dashSize:.07,gapSize:.04}):new T.LineBasicMaterial({color,transparent:true,opacity:.8});mesh=new T.Line(geometry,material);mesh.frustumCulled=false;group.add(mesh);lines.set(key,mesh);allocations.lines++;}mesh.visible=true;mesh.material.color.set(color);const position=mesh.geometry.attributes.position,distance=mesh.geometry.attributes.lineDistance;let total=0;for(let i=0;i<points.length;i++){position.setXYZ(i,...points[i]);if(distance){if(i)total+=Math.hypot(position.getX(i)-position.getX(i-1),position.getY(i)-position.getY(i-1),position.getZ(i)-position.getZ(i-1));distance.setX(i,total);}}position.needsUpdate=true;if(distance)distance.needsUpdate=true;mesh.geometry.setDrawRange(0,points.length);return mesh;},
  mesh(key,make){let mesh=meshes.get(key);if(!mesh){mesh=make();meshes.set(key,mesh);group.add(mesh);allocations.meshes++;}mesh.visible=true;return mesh;}
 };
}
function line(group,points,color,dashed=false){return group.userData.retained.line(points,color,dashed);}
function arrow(group,origin,vector,length,color,role){return group.userData.retained.arrow(origin,vector,length,color,role);}
function dispose(group){group.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});group.clear();}
function makeBody(f){const p=f.params,g=f.geometry,b=new THREE.Group(),a=p.a,c=p.shape==='plate'?Math.min(.015,Math.min(p.a,p.b)*.025):p.c;
 let geo;if(p.shape==='rod'||p.shape==='symmetric-top'){geo=new THREE.CylinderGeometry(a/2,a/2,c,48);geo.rotateX(Math.PI/2);}else if(p.shape==='custom')geo=new THREE.IcosahedronGeometry(.35,1);else geo=new THREE.BoxGeometry(a,p.b,c);
 if(p.shape==='corner-masses'){
  const box=new THREE.EdgesGeometry(geo);b.add(new THREE.LineSegments(box,new THREE.LineBasicMaterial({color:C.body})));
  for(const x of [-a/2,a/2])for(const y of [-p.b/2,p.b/2])for(const z of [-c/2,c/2]){const sphere=new THREE.Mesh(new THREE.SphereGeometry(Math.min(a,p.b,c)*.11,16,12),new THREE.MeshStandardMaterial({color:C.body,roughness:.35}));sphere.position.set(x,y,z);b.add(sphere);}geo.dispose();
 }else {const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:C.body,metalness:.18,roughness:.42,transparent:true,opacity:p.shape==='custom'?.35:.86,wireframe:p.shape==='custom'}));b.add(mesh);const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:'#b9cde5',transparent:true,opacity:.45}));b.add(edge);}
 const mark=new THREE.Mesh(new THREE.SphereGeometry(Math.max(.014,Math.min(a,p.b,c)*.09),14,10),new THREE.MeshBasicMaterial({color:'#f0d690'}));mark.position.set(a*.3,(p.shape==='rod'||p.shape==='symmetric-top')?0:p.b*.4,c*.51);if(p.shape!=='custom')b.add(mark);
 b.position.copy(v(g.centreOfMass));b.quaternion.copy(q(g.quaternion));return b;
}

// Reserve real caption/chip rows first; the remaining viewport never grows past
// the scene. Compact scenes retain the mode's target and inertia on one row.
export function sceneLayout(width,height,closeup='') {
 const compact=height<420,top=closeup?(compact?96:108):(compact?85:110);
 const bottom=closeup?32:70;
 return {compact,top,bottom,area:{x:0,y:top,w:width,h:Math.max(1,height-top-bottom)}};
}
// Compact desktop panels are wide enough for tip captions beside the apparatus.
// Use almost the full fixed motion sphere rather than the spacious main-view
// margin. The 1.6 sphere margin in rebuild leaves 4% around the full motion here.
export function cameraExtentFactor(width,height,closeup='') {
 return width>=430&&height<420&&!closeup ? .65 : 1;
}
// Shrink only a finite tangent patch around its physically correct center.
// Its projected corners stay inside 90% of its own panel, without edge clipping.
export function finitePatchScale(center,corners){
 let scale=1;for(const corner of corners)for(const axis of ['x','y']){const delta=corner[axis]-center[axis];if(delta>0)scale=Math.min(scale,(.9-center[axis])/delta);else if(delta<0)scale=Math.min(scale,(-.9-center[axis])/delta);}
 return Math.max(0,scale);
}
// Convex hull (monotone chain) of projected corner points, and tests against it for label boxes.
// The whole polhode (tip of ω in the body frame) and the herpolhode (tip of ω in space) for a torque-free setup, from t = 0 until the
// polhode closes (at most 20 s). Both lie on ΣIω² = 2T and on the plane ω·L = 2T, so they are drawn from the first frame.
const dot=f=>f.params.shape==='custom'?'':' · yellow dot: marked point';
const curveCache={params:null,result:null};
export function energyCurves(params){
 if(curveCache.params===params)return curveCache.result;
 const inst=model.create(params),body=[],space=[];let reach=0,closed=false,first=null,last=null,steps=0;
 for(let i=0;i<=1000;i++){
  const g=inst.geometry(),b=g.omegaBody;if(!first)first=b;
  const d=Math.hypot(b[0]-first[0],b[1]-first[1],b[2]-first[2]);reach=Math.max(reach,d);
  const stride=last?Math.hypot(b[0]-last[0],b[1]-last[1],b[2]-last[2]):0;
  if(i>3&&reach>1e-6&&d<Math.max(.02*reach,1.2*stride)&&reach>3*stride){closed=true;body.push([...first]);space.push(space[0]);break;}
  body.push([...b]);space.push([...g.omegaSpace]);last=b;steps=i;inst.step(.02);
 }
 const result={body,space,closed};curveCache.params=params;curveCache.result=result;return result;
}
export function convexHull(points){
 const p=points.slice().sort((a,b)=>a.x-b.x||a.y-b.y);if(p.length<3)return p;
 const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x),lower=[],upper=[];
 for(const pt of p){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),pt)<=0)lower.pop();lower.push(pt);}
 for(let i=p.length-1;i>=0;i--){const pt=p[i];while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),pt)<=0)upper.pop();upper.push(pt);}
 lower.pop();upper.pop();return lower.concat(upper);
}
function outward(poly){let area=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];area+=a.x*b.y-b.x*a.y;}return area>=0?1:-1;}
// True when the rectangle (grown by pad) overlaps the convex polygon.
export function rectHitsConvex(rect,poly,pad=0){
 if(poly.length<3)return false;
 const x0=rect.x-pad,y0=rect.y-pad,x1=rect.x+rect.width+pad,y1=rect.y+rect.height+pad;
 if(x1<=Math.min(...poly.map(p=>p.x))||x0>=Math.max(...poly.map(p=>p.x))||y1<=Math.min(...poly.map(p=>p.y))||y0>=Math.max(...poly.map(p=>p.y)))return false;
 const sign=outward(poly),corners=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
 for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],nx=(b.y-a.y)*sign,ny=(a.x-b.x)*sign;if(corners.every(([x,y])=>nx*(x-a.x)+ny*(y-a.y)>=0))return false;}
 return true;
}
// Distance from a point to the polygon edge when the point is inside it, else 0.
export function pointDepth(poly,x,y){
 if(poly.length<3)return 0;const sign=outward(poly);let depth=1e9;
 for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],nx=(b.y-a.y)*sign,ny=(a.x-b.x)*sign,n=Math.hypot(nx,ny)||1,d=(nx*(x-a.x)+ny*(y-a.y))/n;if(d>0)return 0;depth=Math.min(depth,-d);}
 return depth;
}
function visibleTargets(f){return available(f).filter(id=>!['body','frames'].includes(id));}
export const view={graphs,closeups,
  paramVisible(spec,values){return !/^I[123]$/.test(spec.key)||values.shape==='custom';},
 graphDescriptors(params){const window=graphWindow(params);return graphs.map(g=>g.kind?g:{...g,window,...(g.id==='energy'?{series:energySeries(params)}:{})});},
 key:f=>f.compact?'\u03c9 rad/s \u00b7 L kg m\u00b2/s \u00b7 \u03c4 N m'+dot(f):f.closeup==='energy'?'Velocity space · radius is angular speed':'ω rad/s · L kg m²/s · τ N m · arrows use separate fixed scales'+dot(f),
 closeupAnchors(s,f){return f.rotationAnchors||Object.fromEntries(visibleTargets(f).map((id,i)=>[id,{x:s.w*(i===0?.27:i===1?.73:.5),y:i<2?(s.h<420?42:67):s.h-62}]));},
 equations(f){const g=f.geometry;return [...euler(f),...(f.params.mode==='heavy-top'?closeupEquations({...f,closeup:'gravity'}):f.params.mode==='tilt-torque'?closeupEquations({...f,closeup:'tilt'}):f.params.mode==='fixed-axis'?closeupEquations({...f,closeup:'support'}):['\\frac{d\\mathbf L_s}{dt}=\\boldsymbol\\tau_s']),`T=\\tfrac12\\sum I_i\\omega_i^2=${texNum(f.sample.kinetic)}\\,\\mathrm J`];},
 closeupEquation:closeupEquations,
 // Honest projected gallery thumbnail; the full experiment always mounts three.js.
 draw(s,f){
  // Same body, colors and lighting as the scene: visible faces of the oblique projection, flat-shaded, with the scene's soft edge color.
  const {w,h}=s,ctx=s.ctx,p=f.params,rot=q(f.geometry.quaternion),view=[-.35,1,-.25],light=new THREE.Vector3(.35,-.5,.8).normalize();
  const project=a=>{const pt=v(a).applyQuaternion(rot);return [pt.x+.35*pt.y,-pt.z-.25*pt.y];};
  const half=[p.a/2,p.shape==='rod'||p.shape==='symmetric-top'?p.a/2:p.b/2,p.c/2],corners=[];
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])corners.push(project([x*half[0],y*half[1],z*half[2]]));
  const lo=[0,1].map(i=>Math.min(...corners.map(c=>c[i]))),hi=[0,1].map(i=>Math.max(...corners.map(c=>c[i]))),scale=.7*Math.min(w/(hi[0]-lo[0]||1),h/(hi[1]-lo[1]||1));
  const place=c=>[w/2+scale*(c[0]-(lo[0]+hi[0])/2),h/2+scale*(c[1]-(lo[1]+hi[1])/2)];
  const base=[1,3,5].map(i=>parseInt(C.body.slice(i,i+2),16)),faces=[];
  for(const axis of [0,1,2])for(const sign of [-1,1]){
   const normal=v([axis===0?sign:0,axis===1?sign:0,axis===2?sign:0]).applyQuaternion(rot);
   if(normal.x*view[0]+normal.y*view[1]+normal.z*view[2]>=0)continue;
   const u=(axis+1)%3,t=(axis+2)%3,quad=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([i,j])=>{const a=[0,0,0];a[axis]=sign*half[axis];a[u]=i*half[u];a[t]=j*half[t];return place(project(a));});
   faces.push({quad,shade:.8+.32*Math.max(0,normal.dot(light))});
  }
  ctx.lineJoin='round';
  for(const {quad,shade} of faces){ctx.fillStyle=`rgb(${base.map(x=>Math.round(Math.min(255,x*shade))).join(',')})`;ctx.strokeStyle='rgba(185,205,229,.55)';ctx.lineWidth=1.2;ctx.beginPath();quad.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();ctx.stroke();}
 },
 mount(shell){
  const host=shell.scene,root=document.createElement('div');root.className='rr-view';root.innerHTML='<div class="rr-captions"><span class="rr-title"></span><span class="rr-readout"></span></div><svg class="rr-leaders" aria-hidden="true"></svg><div class="rr-vector-labels"></div><div class="rr-frame-captions"></div>';
  const style=document.createElement('style');style.textContent=`.rr-experiment .exp-scene{min-height:470px;flex-basis:470px}.rr-experiment .exp-scene.is-closeup{min-height:450px}.rr-experiment.is-graphs-open .exp-scene{min-height:280px;flex:0 0 280px}.rr-experiment.rr-breakdown{overflow-y:auto;scrollbar-width:thin}.rr-view{position:absolute;inset:0;pointer-events:none}.rr-compact .rr-readout{font-size:10px}.rr-compact .rr-captions{font-size:11px}.rr-experiment .exp-note{padding-bottom:14px}.rr-experiment .exp-transport{background:#191e26;z-index:5;margin-top:auto}.rr-experiment .exp-tools{background:#191e26;z-index:5}.rr-leaders{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none}.rr-view canvas{position:absolute;inset:0;width:100%;height:100%}.rr-captions{position:absolute;left:12px;right:12px;top:12px;display:flex;flex-direction:column;gap:6px;text-align:center;font-size:12px;z-index:1}.rr-title{color:#d5e0ed}.rr-readout{color:#8d9db2;font-size:11px;font-variant-numeric:tabular-nums}.is-closeup .rr-captions{top:45px}.rr-vector-labels{position:absolute;inset:0;z-index:1}.rr-vector-labels span{position:absolute;font-size:12px;padding:2px 5px;white-space:nowrap}.rr-frame-captions{position:absolute;inset:0;display:flex;justify-content:space-around;color:#8d9db2;font-size:11px}.rr-experiment .exp-closeups,.rr-experiment .exp-key{z-index:2}.rr-experiment .exp-key{font-size:10px;line-height:1.4}.rr-experiment .exp-equation{min-width:0;overflow:auto}.rr-experiment .exp-equation .katex{font-size:1em}@media(max-width:500px){.rr-experiment .is-closeup .rr-captions{top:53px}.rr-experiment .exp-scene{min-height:465px}.rr-experiment .exp-scene.is-closeup{min-height:340px;flex-basis:340px}.rr-experiment .exp-key{left:14px;right:14px}.rr-captions{font-size:11px}.rr-readout{font-size:10px}}`;
  shell.host.classList.add('rr-experiment');shell.host.append(style);host.append(root);
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x000000,0);root.prepend(renderer.domElement);renderer.domElement.setAttribute('aria-label','3D rigid body, angular velocity, angular momentum and torque');
  const scene=new THREE.Scene(),content=new THREE.Group();scene.add(content);scene.add(new THREE.HemisphereLight(0xdcecff,0x192131,2.4));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,-4,6);scene.add(light);
  const camera=new THREE.OrthographicCamera();camera.up.set(0,0,1);camera.position.set(3.6,-5.4,3.2);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);const camRight=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),camUp=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),scratch=new THREE.Vector3();
  let instance=null,referenceGeometry=null,body=null,geometryLayer=new THREE.Group(),vectorLayer=new THREE.Group(),bounds=1,zoom=1,lastTime=0,traceBody=[],traceSpace=[],lastTrace=-1,scales={};content.add(geometryLayer,vectorLayer);const retained=createRetainedLayer(vectorLayer);vectorLayer.userData.retained=retained;shell.rotationAllocations=retained.allocations;let paramsIdentity=null,renderWidth=0,renderHeight=0,previousRender=null,idleFrames=0;const chipSizes=new WeakMap();shell.rotationRenderStats={draws:0,skipped:0};
  const leaders=root.querySelector('.rr-leaders'),labels=root.querySelector('.rr-vector-labels'),caption=root.querySelector('.rr-title'),readout=root.querySelector('.rr-readout'),frameCaptions=root.querySelector('.rr-frame-captions');
  function rebuild(f){retained.clear();paramsIdentity=f.params;dispose(geometryLayer);body=makeBody(f);geometryLayer.add(body);const p=f.params,g=f.geometry;bounds=Math.max(.6,Math.hypot(p.a,p.shape==='rod'||p.shape==='symmetric-top'?p.a:p.b,p.c)/2+(p.mode==='heavy-top'?p.distance:0))*1.6;
   referenceGeometry=model.create(p).geometry();
   const probe=f.instance;scales={omega:bounds*.6/Math.max(1,norm(g.omegaSpace)),L:bounds*.75/Math.max(.01,norm(g.angularMomentumSpace)),torque:bounds*.6/Math.max(.01,norm(g.torqueSpace))};
   // Fixed axes span the body bounding sphere, never follow individual corners.
   instance=probe;traceBody=[];traceSpace=[];lastTrace=-1;
  }
  function cameraFor(width,height,extent){const aspect=width/Math.max(1,height);const halfHeight=extent/Math.min(1,aspect);camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;camera.top=halfHeight;camera.bottom=-halfHeight;camera.near=.01;camera.far=100;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);}
  const origin3=new THREE.Vector3(),labelNodes=new Map(),leaderNodes=new Map(),panelLabels=[];let labelSession=null,currentPanel=0,currentObstacles=[],currentShapes=[],hullBoxes=[],arrowBoxes=[],topMargin=3,area3={x:0,y:0,w:0,h:0},leaderLengths=[],tips=[];
  function cachedText(el,text){if(el.textContent!==text)el.textContent=text;}
  function cachedAttribute(el,name,value){if(el.getAttribute(name)!==value)el.setAttribute(name,value);}

  // A label stays on the line of its arrow just beyond the tip. Candidates are fixed
  // (angle then gap tier) relative to that direction; the previous choice is kept while
  // it stays valid, so a label never flips between frames and always follows its tip.
  const LABEL_TURNS=Array.from({length:32},(_,i)=>(i%2?1:-1)*Math.ceil(i/2)*11.25*Math.PI/180),LABEL_TIERS=[0,8,16,24,36,48,64,80],LABEL_LEASH=30,LABEL_SIDE={'ω':1,'L':-1,'τ':1,'e₁':1,'e₂':-1,'e₃':1};
  // A torque arrow and the axis it lies along share one ray; their labels take opposite sides of it.
  const LABEL_TURN_PREFERENCE={'τ':1,'e₂':-1};
  function textAt(text,point,color,rect,placed,overlay=false){
   const projected=point.clone().project(camera),x=rect.x+(projected.x+1)*rect.w/2,y=rect.y+(1-projected.y)*rect.h/2;
   const centre=origin3.set(0,0,0).project(camera),ox=rect.x+(centre.x+1)*rect.w/2,oy=rect.y+(1-centre.y)*rect.h/2;
   const nodeKey=currentPanel+':'+text;let entry=labelNodes.get(nodeKey);
   if(!entry){const el=document.createElement('span');el.textContent=text;el.style.color=color;labels.append(el);entry={el,width:el.offsetWidth,height:el.offsetHeight,choice:-1};labelNodes.set(nodeKey,entry);retained.allocations.labels++;}
   const el=entry.el;entry.used=true;el.hidden=false;tips.push({text,x,y,box:null,panel:currentPanel});tips.at(-1).el=el;if(entry.color!==color){el.style.color=color;entry.color=color;}
   const width=entry.width,height=entry.height;
   let dx=x-ox,dy=y-oy;const len=Math.hypot(dx,dy);if(len<1e-6){dx=1;dy=0;}else{dx/=len;dy/=len;}
   const intersects=a=>placed.some(b=>a.x<b.x+b.width+6&&a.x+width+6>b.x&&a.y<b.y+b.height+6&&a.y+height+6>b.y);
   // Clear of every recorded shaft and head (plus a pixel or two); the label's own tip keeps its 3 px gap.
   const hitsArrow=a=>{for(const o of currentObstacles){const dx=o.x1-o.x0,dy=o.y1-o.y0,len=Math.hypot(dx,dy),n=Math.max(1,Math.ceil(len/1.5));for(let i=0;i<=n;i++){const t=i/n,px=o.x0+dx*t,py=o.y0+dy*t,back=len*(1-t),clear=Math.max(1.5,back<o.hl?o.hr*back/Math.max(1e-6,o.hl):0)+2;if(Math.hypot(Math.max(a.x-px,0,px-a.x-width),Math.max(a.y-py,0,py-a.y-height))<clear-.01)return true;}}return false;};
   const side=LABEL_SIDE[text]??1;
   // A label also stays outside the projected body. A tip that lies inside the silhouette extends the leash by its depth.
   const depth=currentShapes.reduce((m,poly)=>Math.max(m,pointDepth(poly,x,y)),0);let leash=LABEL_LEASH+depth;tips.at(-1).depth=depth;
   const hitsBody=(a,pad)=>currentShapes.some(poly=>rectHitsConvex({x:a.x,y:a.y,width,height},poly,pad));
   const leaderLength=a=>Math.hypot(Math.max(a.x,Math.min(a.x+width,x))-x,Math.max(a.y,Math.min(a.y+height,y))-y);
   // A panel edge may be crossed only as a last resort (stacked comparison panels in a short scene); the scene itself is never left.
   let bounds=rect;const valid=(a,pad=1)=>a.x>=bounds.x+3&&a.y>=bounds.y+topMargin&&a.x+width<=bounds.x+bounds.w-3&&a.y+height<=bounds.y+bounds.h-3&&leaderLength(a)<=leash&&!intersects(a)&&!hitsArrow(a)&&(overlay||!hitsBody(a,pad));
   let squeeze=false;
   const candidate=n=>{const tier=LABEL_TIERS[Math.floor(n/LABEL_TURNS.length)],turn=LABEL_TURNS[n%LABEL_TURNS.length]*side,c=Math.cos(turn),s=Math.sin(turn),ux=dx*c-dy*s,uy=dx*s+dy*c,reachOut=Math.abs(ux)*width/2+Math.abs(uy)*height/2+3+tier;const c0={x:x+ux*reachOut-width/2,y:y+uy*reachOut-height/2};return squeeze?{x:Math.max(bounds.x+3,Math.min(bounds.x+bounds.w-3-width,c0.x)),y:Math.max(bounds.y+topMargin,Math.min(bounds.y+bounds.h-3-height,c0.y))}:c0;};
   let first=-1,position=null;const count=LABEL_TURNS.length*LABEL_TIERS.length;
   // A new choice keeps 16 px from the silhouette so a turning body does not push it away again at once; a kept one may come within 1 px.
   const pref=LABEL_TURN_PREFERENCE[text]||0,turnOf=n=>LABEL_TURNS[n%LABEL_TURNS.length]*side,onSide=n=>!pref||turnOf(n)*pref>=0;
   const search=()=>{for(const pad of [16,8,1]){if(pref)for(let n=0;n<count;n++)if(onSide(n)&&valid(candidate(n),pad))return n;for(let n=0;n<count;n++)if(valid(candidate(n),pad))return n;}return -1;};
   const searchNear=()=>{const near=search();if(near<0||leaderLength(candidate(near))<=8)return near;let best=near,score=leaderLength(candidate(near));for(const [pad,cost] of [[8,3],[1,6]])for(let n=0;n<count;n++){const c=candidate(n),v=leaderLength(c)+cost;if(v<score&&(onSide(n)||!onSide(near))&&valid(c,pad)){score=v;best=n;}}return best;};
   first=entry.choice<0?searchNear():search();
   if(first<0){squeeze=true;bounds={x:0,y:area3.y,w:area3.w,h:area3.h};first=search();}
   // A crowded cluster may take a longer leader rather than lose the label.
   if(first<0){leash+=24;tips.at(-1).depth=depth+24;squeeze=false;bounds=rect;first=search();if(first<0){squeeze=true;bounds={x:0,y:area3.y,w:area3.w,h:area3.h};first=search();}}
   // Keep the previous choice while it is valid; when it is not, move to the valid candidate nearest the old position.
   if(first>=0&&entry.choice>=0&&entry.choice<count){if(valid(candidate(entry.choice))){if(leaderLength(candidate(entry.choice))<=24||leaderLength(candidate(first))>10)first=entry.choice;}else{const was=candidate(entry.choice);let best=1e9;for(const cap of [1e9]){for(const pad of [16,8,1]){for(let n=0;n<count;n++){const c=candidate(n),d=Math.hypot(c.x-was.x,c.y-was.y);if(d<best&&leaderLength(c)<=cap&&valid(c,pad)){best=d;first=n;}}if(best<1e9)break;}if(best<1e9)break;}}}
   if(first<0){entry.choice=-1;el.hidden=true;return;}
   entry.choice=first;position=candidate(first);
   tips.at(-1).box={x:position.x,y:position.y,width,height};
   const transform=`translate(${position.x}px,${position.y}px)`;if(el.style.transform!==transform){el.style.transition=entry.ready?'transform 120ms ease-out':'none';el.style.transform=transform;}entry.ready=true;entry.bounds={...position,width,height,text};placed.push(entry.bounds);
   const length=leaderLength(position);leaderLengths.push(length);
   if(length>7){
    const tx=Math.max(position.x,Math.min(position.x+width,x)),ty=Math.max(position.y,Math.min(position.y+height,y));
    let record=leaderNodes.get(nodeKey);if(!record){const el=document.createElementNS('http://www.w3.org/2000/svg','path');el.setAttribute('fill','none');el.setAttribute('stroke-opacity','.7');el.setAttribute('stroke-width','1');leaders.append(el);record={el};leaderNodes.set(nodeKey,record);retained.allocations.leaders++;}record.used=true;record.el.style.display='';cachedAttribute(record.el,'d',`M${x},${y} L${tx},${ty}`+(depth>0?` M${x-2.5},${y} a2.5,2.5 0 1,0 5,0 a2.5,2.5 0 1,0 -5,0`:''));cachedAttribute(record.el,'stroke',color);
   }
  }
  function chipSizes_(ids){return ids.map(id=>{const button=shell.q(`.exp-closeups [data-id="${id}"]`);let size=button&&chipSizes.get(button);if(!size||!size.w){size={w:button?.offsetWidth||0,h:button?.offsetHeight||0};if(button&&size.w)chipSizes.set(button,size);}return size.w?size:{w:130,h:32};});}
  // Rows below the apparatus, centred and wrapping: the fallback when no chip can sit beside its target (phone widths).
  function chipRows(ids,width){const sizes=chipSizes_(ids),rows=[[]],gap=8;let used=0;sizes.forEach((z,i)=>{if(rows.at(-1).length&&used+gap+z.w>width-16){rows.push([]);used=0;}used+=(rows.at(-1).length?gap:0)+z.w;rows.at(-1).push(i);});return {sizes,rows,rowH:36,gap};}
  const sphereOf=f=>{const p=f.params;return norm(f.geometry.centreOfMass)+Math.hypot(p.a,p.shape==='rod'||p.shape==='symmetric-top'?p.a:p.b,p.c)/2;};
  const reachOf=f=>Math.max(sphereOf(f),.78*bounds);
  // Home points (space frame, t = 0) each chip sits beside; null means beside the body.
  function chipTargets(f){const g0=referenceGeometry,unit=a=>norm(a)>1e-10?v(a).normalize():null,arrow=(a,k)=>{const d=unit(a);return d&&d.multiplyScalar(Math.min(bounds*.93,norm(a)*k));};
   return {inertia:null,axis:v(g0.principalAxes[1]).applyQuaternion(q(g0.quaternion)).normalize().multiplyScalar(bounds*.6),energy:arrow(g0.omegaSpace,scales.omega),precession:arrow(g0.angularMomentumSpace,scales.L),gravity:v(g0.centreOfMass).add(v([0,0,-bounds*.48])),tilt:v([0,0,bounds*.7]),support:arrow(g0.torqueSpace,scales.torque)};}
  // Chips sit on the keep-out circle (the motion sphere, which the body never leaves) at the angle of their target's home
  // point, pushed out far enough to leave the tip's label room, and nudged by the smallest angle that fits. Offsets are
  // relative to the apparatus centre, so they are the same in Scene and Breakdown. Returns ok=false when they do not fit.
  function placeNear(f,ids,width,ppu,ref){
   const sizes=chipSizes_(ids),targets=chipTargets(f),R=sphereOf(f)*ppu+6,cyRef=ref.area.y+ref.area.h/2,minX=8-width/2,maxX=width/2-8,minY=ref.area.y-cyRef,maxY=ref.height-44-cyRef;
   const screen=d=>d&&{x:d.dot(camRight)*ppu,y:-d.dot(camUp)*ppu},g0=referenceGeometry;
   const homes=[['precession',g0.angularMomentumSpace,scales.L],['energy',g0.omegaSpace,scales.omega],['support',g0.torqueSpace,scales.torque]].filter(([,a])=>norm(a)>1e-10).map(([id,a,k])=>({id,...screen(v(a).normalize().multiplyScalar(Math.min(bounds*.93,norm(a)*k)))}));
   const gap=(r,pt)=>Math.hypot(Math.max(r.x-pt.x,0,pt.x-r.x-r.w),Math.max(r.y-pt.y,0,pt.y-r.y-r.h));
   const slots=[135,45,90,160,20],order=ids.map((id,i)=>i).sort((i,j)=>(targets[ids[i]]?0:1)-(targets[ids[j]]?0:1)||(targets[ids[i]]?screen(targets[ids[i]]).y-screen(targets[ids[j]]).y:0)||i-j),placed=[],out={};let slot=0,ok=true;
   for(const i of order){const id=ids[i],{w,h}=sizes[i],target=screen(targets[id]),base=target?Math.atan2(target.y,target.x):slots[slot++%slots.length]*Math.PI/180,radius=Math.max(R,target?Math.hypot(target.x,target.y)+26:0);let best=null;
    const fits=r=>!(r.x<minX||r.x+w>maxX||r.y<minY||r.y+h>maxY||placed.some(b=>r.x<b.x+b.w+6&&r.x+w+6>b.x&&r.y<b.y+b.h+6&&r.y+h+6>b.y)||homes.some(t=>t.id!==id&&gap(r,t)<24&&!(target&&Math.hypot(t.x-target.x,t.y-target.y)<6)));
    // A drawn target: the free spot with the smallest gap to it (beside it on any of its four sides), outside the body circle.
    if(target){let top=1e9;for(const d of [20,26,32,38,44,12,6])for(let o=-72;o<=72;o+=8){
      for(const r of [{x:target.x+d,y:target.y+o-h/2},{x:target.x-d-w,y:target.y+o-h/2},{x:target.x+o*2-w/2,y:target.y-d-h},{x:target.x+o*2-w/2,y:target.y+d}]){r.w=w;r.h=h;
       const score=gap(r,target)+(d<20?24:0)+.02*Math.abs(Math.atan2(r.y+h/2-target.y,r.x+w/2-target.x)-base);
       if(score<top&&gap(r,{x:0,y:0})>=R&&fits(r)){top=score;best=r;}}}}
    for(let k=0;k<37&&!best;k++){const ang=base+(k%2?1:-1)*Math.ceil(k/2)*10*Math.PI/180,ux=Math.cos(ang),uy=Math.sin(ang),sup=Math.abs(ux)*w/2+Math.abs(uy)*h/2,cx=ux*(radius+sup+3),cy=uy*(radius+sup+3),r={x:cx-w/2,y:cy-h/2,w,h};
     if(fits(r))best=r;}
    if(!best){ok=false;break;}
    placed.push(best);out[id]={x:best.x+w/2,y:best.y,w,h,target};}
   return {ok,out,R,sizes};}
  const sceneCache={};
  // One scale for Scene and Breakdown: pixels per world unit come from a reference height (the smaller of this scene and the
  // 470/465 px minimum), so a taller Scene and a minimum-height Breakdown show the apparatus at one scale.
  function sceneScale(f,width,height){
   const ids=visibleTargets(f),refH=Math.min(height,width<=500?465:470),sizes=chipSizes_(ids).map(z=>z.w+'x'+z.h).join(),p=f.params,
    c=sceneCache;if(c.params===f.params&&c.width===width&&c.refH===refH&&c.sizes===sizes&&c.ids===ids.join())return c.result;
   const factor=cameraExtentFactor(width,refH,''),pad=factor<1&&p.shape==='corner-masses'?.11*Math.min(p.a,p.b,p.c):0,extent=bounds*factor+pad,ref=sceneLayout(width,refH,'').area,aspect=Math.min(1,ref.w/Math.max(1,ref.h)),ppu0=(ref.h/2)/(extent/aspect);
   let result,near=placeNear(f,ids,width,ppu0,{area:ref,height:refH});
   if(near.ok)result={ppu:ppu0,near};
   else {const {rows,rowH}=chipRows(ids,width),cy=ref.y+ref.h/2,allow=Math.max(40,refH-68-(rows.length-1)*rowH-4-cy-10),want=reachOf(f)*ppu0;result={ppu:want>allow?ppu0*allow/want:ppu0,near:null};}
   Object.assign(c,{params:f.params,width,refH,sizes,ids:ids.join(),result});return result;}
  function extentFor(f,zm,width,height){const p=f.params;
   if(f.closeup){const factor=cameraExtentFactor(width,height,f.closeup),pad=factor<1&&p.shape==='corner-masses'?.11*Math.min(p.a,p.b,p.c):0;return bounds/zm*factor+pad;}
   const {ppu}=sceneScale(f,width,height),area=sceneLayout(width,height,'').area;
   return (area.h/2)*Math.min(1,area.w/Math.max(1,area.h))/ppu/zm;}
  function chipLayout(f,ids,width,height,area){
   const cx=area.x+area.w/2,cy=area.y+area.h/2,dual=f.closeup==='frames'||f.closeup==='energy';
   if(!f.closeup){const {ppu,near}=sceneScale(f,width,height);
    if(near){const anchors={},targets={},sizes=chipSizes_(ids);ids.forEach(id=>{const o=near.out[id];anchors[id]={x:cx+o.x,y:cy+o.y};targets[id]=o.target?{x:cx+o.target.x,y:cy+o.target.y}:null;});return {anchors,sizes,keep:{x:cx,y:cy,r:near.R},targets};}}
   const {sizes,rows,rowH,gap}=chipRows(ids,width),ext=extentFor(f,f.closeup?1.18:1,width,height),ppu=(area.h/2)/(ext/Math.min(1,area.w/Math.max(1,area.h))),keep=reachOf(f)*ppu+10,anchors={};
   const y0=Math.max(area.y,Math.min(height-64-(rows.length-1)*rowH,dual?area.y+area.h:cy+keep+4));
   rows.forEach((row,r)=>{const total=row.reduce((t,i)=>t+sizes[i].w,0)+gap*(row.length-1);let x=(width-total)/2;for(const i of row){anchors[ids[i]]={x:x+sizes[i].w/2,y:y0+r*rowH};x+=sizes[i].w+gap;}});
   return {anchors,sizes,keep:{x:cx,y:cy,r:keep},targets:{}};
  }
  function draw(f){
   // Keep camera-frame choices in Setup. Preserve the kit's validated close-up
   // actions and ordinary shared buttons, without exposing these as zoom chips.
   let controls=shell.setup.querySelector('.rr-frame-controls');
   if(!controls){controls=document.createElement('div');controls.className='rr-frame-controls';controls.innerHTML='<div>Viewing frame</div><div class="exp-presets" role="group" aria-label="Viewing frame"><button data-exp="scene">Space frame</button></div>';shell.setup.prepend(controls);}
   for(const id of ['body','frames']){const button=shell.q(`.exp-closeups [data-id="${id}"]`);if(button)controls.lastElementChild.append(button);}
   for(const button of controls.querySelectorAll('button'))cachedAttribute(button,'aria-pressed',String((button.dataset.id||'')===f.closeup));
   host.classList.toggle('is-closeup',!!f.closeup);shell.host.classList.toggle('rr-breakdown',f.breakdown);const width=host.clientWidth,height=host.clientHeight;if(!width||!height)return;f.narrow=width<430;
   const unchanged=previousRender&&previousRender.params===f.params&&previousRender.instance===f.instance&&previousRender.t===f.t&&previousRender.closeup===f.closeup&&previousRender.breakdown===f.breakdown&&previousRender.width===width&&previousRender.height===height&&!shell.stage.snap;
   idleFrames=unchanged?idleFrames+1:0;if(idleFrames>100){f.compact=height<420;f.rotationAnchors=shell.rotationAnchors;shell.rotationRenderStats.skipped++;return;}
   previousRender={params:f.params,instance:f.instance,t:f.t,closeup:f.closeup,breakdown:f.breakdown,width,height};shell.rotationRenderStats.draws++;
   if(width!==renderWidth||height!==renderHeight){renderer.setSize(width,height,false);renderWidth=width;renderHeight=height;}shell.stage.w=width;shell.stage.h=height;
   if(paramsIdentity!==f.params){rebuild(f);}else if(instance!==f.instance){instance=f.instance;const g=f.geometry;scales={omega:bounds*.6/Math.max(1,norm(g.omegaSpace)),L:bounds*.75/Math.max(.01,norm(g.angularMomentumSpace)),torque:bounds*.6/Math.max(.01,norm(g.torqueSpace))};traceBody=[];traceSpace=[];lastTrace=-1;}if(f.t<lastTime){traceBody=[];traceSpace=[];lastTrace=-1;}lastTime=f.t;
   const p=f.params,g=f.geometry,isBody=['body','axis','inertia','energy'].includes(f.closeup),compare=f.closeup==='frames',energy=f.closeup==='energy';
   const layout=sceneLayout(width,height,f.closeup);f.compact=layout.compact;root.classList.toggle('rr-compact',layout.compact);const ids=visibleTargets(f,height);for(const b of shell.q('.exp-closeups').children){const hidden=!ids.includes(b.dataset.id);if(b.hidden!==hidden)b.hidden=hidden;}
   cachedText(caption,f.closeup?sentenceCase(closeups.find(c=>c.id===f.closeup)?.label.replace('Zoom · ','')):'Space frame · '+(p.shape==='custom'?'independent inertia':p.shape.replaceAll('-',' ')));
   let readoutText=energy?'Body ellipsoid / space tangent plane':f.closeup==='inertia'?`a = ${num(p.a)} m · b = ${num(p.b)} m · c = ${num(p.c)} m`:`θ = ${num(f.sample.theta)} rad · T = ${num(f.sample.kinetic)} J`;
   if(norm(g.torqueSpace)<1e-10&&!energy)readoutText+=' · τ = 0 N m';cachedText(readout,readoutText);
   leaderLengths=[];tips=[];arrowBoxes=[];hullBoxes=[];if(labelSession!==f.closeup){for(const entry of labelNodes.values()){entry.choice=-1;entry.ready=false;}labelSession=f.closeup;}for(const entry of labelNodes.values())entry.used=false;for(const entry of leaderNodes.values())entry.used=false;for(const label of panelLabels)label.hidden=true;cachedAttribute(leaders,'viewBox',`0 0 ${width} ${height}`);
   if(f.t-lastTrace>.025){traceBody.push([...g.omegaBody]);traceSpace.push([...g.omegaSpace]);if(traceBody.length>800){traceBody.shift();traceSpace.shift();}lastTrace=f.t;}
   const target=f.closeup?1.18:1,dt=Math.min(.1,(performance.now()-(draw.last||performance.now()))/1000);draw.last=performance.now();zoom+= (target-zoom)*(1-Math.exp(-dt*10));if(shell.stage.snap){zoom=target;shell.stage.snap=false;}
   const narrow=width<430,{top,area}=layout,showAxes=!layout.compact||f.closeup==='axis';
   const dual=compare||energy,vertical=dual&&narrow;const panels=dual?[{x:0,y:top,w:vertical?width:width/2,h:vertical?area.h/2:area.h},{x:vertical?0:width/2,y:vertical?top+area.h/2:top,w:vertical?width:width/2,h:vertical?area.h/2:area.h}]:[area];
   const projectedBodies=[];const placed=[];
   {const chips=chipLayout(f,ids,width,height,area);f.rotationAnchors=chips.anchors;shell.rotationAnchors=chips.anchors;shell.rotationKeepOut=chips.keep;shell.rotationChipTargets=chips.targets;
    for(const button of shell.q('.exp-closeups').children){const a=chips.anchors[button.dataset.id];if(!a||button.hidden)continue;const {w,h}=chips.sizes[ids.indexOf(button.dataset.id)],x=Math.max(w/2+8,Math.min(width-w/2-8,a.x));placed.push({x:x-w/2,y:Math.min(height-40,a.y),width:w,height:h});}}
   renderer.setScissorTest(false);renderer.clear();renderer.setScissorTest(true);
   panels.forEach((r,index)=>{
    retained.begin();currentPanel=index;topMargin=3;area3=area;if(dual)placed.push({x:r.x+8,y:r.y+3,width:96,height:14});const bodyFrame=energy?index===0:compare?index===1:isBody;
    content.quaternion.copy(bodyFrame?q(g.quaternion).invert():new THREE.Quaternion());body.position.copy(v(g.centreOfMass));body.quaternion.copy(q(g.quaternion));body.visible=!energy;
    const extent=extentFor(f,zoom,width,height);cameraFor(r.w,r.h,extent);renderer.setViewport(r.x,height-r.y-r.h,r.w,r.h);renderer.setScissor(r.x,height-r.y-r.h,r.w,r.h);
    content.updateMatrixWorld(true);
    const parts=[],projected=[],shapes=[];body.traverse(object=>{if(!object.geometry||object.isLine||object.isLineSegments)return;if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();const box=object.geometry.boundingBox,pts=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const point=scratch.set(x,y,z).applyMatrix4(object.matrixWorld).project(camera),pt={x:r.x+(point.x+1)*r.w/2,y:r.y+(1-point.y)*r.h/2};pts.push(pt);projected.push(pt);}parts.push({object,box});if(body.visible)shapes.push(convexHull(pts));});
    currentShapes=shapes;hullBoxes.push({panel:index,polys:shapes});
    // Distance along a unit content-space direction from the origin to where it leaves the body (0 when it never meets it).
    const exitAlong=dir=>{if(!body.visible)return 0;const D=dir.clone().applyQuaternion(content.quaternion);let best=0;
     for(const {object,box} of parts){const inv=object.matrixWorld.clone().invert(),o=new THREE.Vector3().applyMatrix4(inv),d=D.clone().transformDirection(inv);let t0=-1e9,t1=1e9;
      for(const k of ['x','y','z']){if(Math.abs(d[k])<1e-9){if(o[k]<box.min[k]||o[k]>box.max[k]){t0=1e9;break;}}else{let lo=(box.min[k]-o[k])/d[k],hi=(box.max[k]-o[k])/d[k];if(lo>hi)[lo,hi]=[hi,lo];t0=Math.max(t0,lo);t1=Math.min(t1,hi);}}
      if(t0<=t1&&t1>0)best=Math.max(best,t1);}
     return best;};
    const queue=[],later=(pri,fn)=>queue.push({pri,fn}),obstacles=[],pxPerUnit=(r.h/2)/camera.top;currentObstacles=obstacles;
    // Every arrow is recorded in pixels (shaft and head) so labels keep clear of all of them; longer arrows draw first, shorter ones on top.
    const A=(o,vec,len,color,role,order)=>{const ar=arrow(vectorLayer,o,vec,len,color,role);if(!ar)return ar;const rank=order??30+Math.round(40*(1-Math.min(1,len/bounds)));ar.traverse(x=>{x.renderOrder=rank;});
     const dir=v(vec).normalize(),p0=v(o).applyQuaternion(content.quaternion).project(camera),p1=v(o).add(dir.clone().multiplyScalar(len)).applyQuaternion(content.quaternion).project(camera);
     const box={x0:r.x+(p0.x+1)*r.w/2,y0:r.y+(1-p0.y)*r.h/2,x1:r.x+(p1.x+1)*r.w/2,y1:r.y+(1-p1.y)*r.h/2,hl:Math.min(.09,len*.22)*pxPerUnit,hr:Math.min(.05,len*.12)/2*pxPerUnit,panel:index};obstacles.push(box);arrowBoxes.push(box);return ar;};
    const origin=[0,0,0],basis=bodyFrame?[[1,0,0],[0,1,0],[0,0,1]]:g.principalAxes;
    if(energy){
     content.quaternion.identity();const scale=bounds*.65/Math.max(...g.inertiaEllipsoidRadii,1);const point=(bodyFrame?g.omegaBody:g.omegaSpace).map(x=>x*scale);
     if(bodyFrame){const ell=retained.mesh('ellipsoid',()=>new THREE.Mesh(new THREE.SphereGeometry(1,36,24),new THREE.MeshBasicMaterial({color:C.omega,wireframe:true,transparent:true,opacity:.07})));ell.scale.set(...g.inertiaEllipsoidRadii.map(x=>x*scale));}
     else {const size=bounds*.9,plane=retained.mesh('tangent',()=>new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshBasicMaterial({color:C.L,side:THREE.DoubleSide,transparent:true,opacity:.12})));const L=v(g.angularMomentumSpace);plane.quaternion.setFromUnitVectors(v([0,0,1]),L.clone().normalize());plane.position.copy(L.clone().multiplyScalar(2*f.sample.kinetic/(L.lengthSq()||1)*scale));const center=plane.position.clone().project(camera),corners=[];for(const x of [-size/2,size/2])for(const y of [-size/2,size/2])corners.push(v([x,y,0]).applyQuaternion(plane.quaternion).add(plane.position).project(camera));plane.scale.setScalar(finitePatchScale(center,corners));}
     const curves=energyCurves(f.params),trace=bodyFrame?curves.body:curves.space;shell.rotationEnergyCurves={body:curves.body.length,space:curves.space.length,closed:curves.closed,drawn:trace.length>1};
     if(trace.length>1){const sig=curves.body.length+':'+Math.round(scale*1e4)+':'+bodyFrame,tube=retained.mesh('polhode-'+(bodyFrame?'body':'space'),()=>{const m=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:C.L,depthTest:false,depthWrite:false,transparent:true,opacity:.95}));m.renderOrder=25;return m;});
      if(tube.userData.sig!==sig){const stride=Math.max(1,Math.floor(trace.length/240)),pts=trace.filter((a,i)=>i%stride===0||i===trace.length-1).map(a=>new THREE.Vector3(...a).multiplyScalar(scale));tube.geometry.dispose();tube.geometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts,false),Math.min(480,pts.length*2),bounds*.0065,5,false);tube.userData.sig=sig;}}
     // The ellipsoid is the drawing's body here: labels keep clear of its outline.
     if(bodyFrame){content.updateMatrixWorld(true);const rad=g.inertiaEllipsoidRadii.map(x=>x*scale),pts=[];for(let i=0;i<=12;i++)for(let j=0;j<24;j++){const th=Math.PI*i/12,ph=2*Math.PI*j/24,pt=scratch.set(rad[0]*Math.sin(th)*Math.cos(ph),rad[1]*Math.sin(th)*Math.sin(ph),rad[2]*Math.cos(th)).applyMatrix4(content.matrixWorld).project(camera);pts.push({x:r.x+(pt.x+1)*r.w/2,y:r.y+(1-pt.y)*r.h/2});}shapes.push(convexHull(pts));}else if(trace.length>1){content.updateMatrixWorld(true);const pts=trace.map(a=>{const pt=scratch.set(a[0]*scale,a[1]*scale,a[2]*scale).applyMatrix4(content.matrixWorld).project(camera);return {x:r.x+(pt.x+1)*r.w/2,y:r.y+(1-pt.y)*r.h/2};});shapes.push(convexHull(pts));}
     A(origin,point,norm(point),C.omega,'energy-angular-velocity');
     textAt(bodyFrame?'ω body':'ω space',v(point),C.omega,r,placed);
    }else {
     const axisTips=[];for(let i=0;i<3&&showAxes;i++){const axis=v(basis[i]).applyQuaternion(q(g.quaternion));const len=Math.min(bounds*.8,Math.max(bounds*.46,exitAlong(axis)+bounds*.09));A(origin,axis.toArray(),len,C.axes[i],'axis-'+i,20);axisTips.push(axis.clone().multiplyScalar(len).applyQuaternion(content.quaternion));}
     const vectors=[['ω',g.omegaSpace,C.omega,scales.omega],['L',g.angularMomentumSpace,C.L,scales.L],['τ',g.torqueSpace,C.torque,scales.torque]];
     for(const [label,a,color,scale] of vectors){const length=Math.min(bounds*.93,norm(a)*scale);A(origin,a,length,color,label);if(norm(a)>1e-10)later(0,()=>textAt(label,v(a).normalize().multiplyScalar(length).applyQuaternion(content.quaternion),color,r,placed));}
     axisTips.forEach((tip,i)=>later(2,()=>textAt('e'+['₁','₂','₃'][i],tip,C.axes[i],r,placed)));
     if(p.mode==='heavy-top'){
      line(vectorLayer,[origin,g.centreOfMass],C.torque);retained.mesh('pivot',()=>new THREE.Mesh(new THREE.SphereGeometry(bounds*.025,12,10),new THREE.MeshBasicMaterial({color:'#d2d9e3'})));
      if(f.breakdown||['gravity','precession'].includes(f.closeup)){
       const arm=g.centreOfMass,forceLength=bounds*.48;A(arm,g.gravityForce,forceLength,C.torque,'gravity');later(1,()=>textAt('mg',v(arm).add(v([0,0,-forceLength])).applyQuaternion(content.quaternion),C.torque,r,placed));if(!narrow)later(3,()=>textAt('r',v(arm).multiplyScalar(.25).applyQuaternion(content.quaternion),'#d6bd82',r,placed));
       line(vectorLayer,[origin,[0,0,p.distance]],'#8a99ad',true);line(vectorLayer,[arm,[0,0,arm[2]]],'#d6bd82',true);
       const az=Math.atan2(arm[1],arm[0]),arc=Array.from({length:33},(_,i)=>{const t=f.sample.theta*i/32;return [Math.cos(az)*Math.sin(t)*p.distance*.7,Math.sin(az)*Math.sin(t)*p.distance*.7,Math.cos(t)*p.distance*.7];});{const arcLine=line(vectorLayer,arc,'#d6bd82');arcLine.material.depthTest=false;arcLine.material.opacity=1;arcLine.renderOrder=24;}
       if(!narrow)later(3,()=>textAt('θ',v(arc[16]).applyQuaternion(content.quaternion),'#d6bd82',r,placed,true));
      }
     }
     if(f.closeup==='precession'){const radius=Math.sin(f.sample.theta)*bounds*.65,z=Math.cos(f.sample.theta)*bounds*.65;line(vectorLayer,Array.from({length:81},(_,i)=>[radius*Math.cos(i*Math.PI/40),radius*Math.sin(i*Math.PI/40),z]),'#6f8296',true);}
     if(f.closeup==='tilt'){line(vectorLayer,[origin,[0,0,bounds*.7]],'#9ba8b9',true);later(3,()=>textAt('z space',v([0,0,bounds*.7]).applyQuaternion(content.quaternion),'#9ba8b9',r,placed));}
     if(f.closeup==='inertia'&&['box','corner-masses'].includes(p.shape)){
      const local=[[-p.a/2,-p.b/2,-p.c/2],[p.a/2,-p.b/2,-p.c/2],[-p.a/2,p.b/2,-p.c/2],[-p.a/2,-p.b/2,p.c/2]];
      const points=local.map(a=>v(a).applyQuaternion(q(g.quaternion)).add(v(g.centreOfMass)));
      for(let i=1;i<4;i++){line(vectorLayer,[points[0].toArray(),points[i].toArray()],C.axes[i-1]);later(3,()=>textAt(['a','b','c'][i-1],points[0].clone().add(points[i]).multiplyScalar(.5).applyQuaternion(content.quaternion),C.axes[i-1],r,placed));}
     }
     if(bodyFrame){for(let i=0;i<3;i++){const a=[0,0,0];a[i]=bounds*.8;line(vectorLayer,[origin,a],'#536279',true);}}
     // Place labels in priority order; a label that finds no clear spot is promoted and the whole panel is placed again (a few rounds at most).
     {const base={placed:placed.length,tips:tips.length,leaders:leaderLengths.length};let order=queue.slice().sort((x,y)=>x.pri-y.pri);
      for(let round=0;round<4;round++){placed.length=base.placed;tips.length=base.tips;leaderLengths.length=base.leaders;for(const [key,rec] of leaderNodes)if(key.startsWith(index+':'))rec.used=false;order.forEach(item=>item.fn());
       const failed=order.filter((item,i)=>tips[base.tips+i]&&!tips[base.tips+i].box);if(!failed.length)break;failed.forEach(item=>{item.pri=-1-round;});order=order.slice().sort((x,y)=>x.pri-y.pri);}}
    }
    // Inspect actual rendered body geometry, including its corner marker. Keep
    // the camera fixed to the full-motion sphere; these bounds are evidence only.
    // Evidence of the rendered body bounds (corner points computed above).
    projectedBodies.push({visible:body.visible,panel:{...r},x:Math.min(...projected.map(p=>p.x)),right:Math.max(...projected.map(p=>p.x)),y:Math.min(...projected.map(p=>p.y)),bottom:Math.max(...projected.map(p=>p.y))});
    renderer.render(scene,camera);
    if(dual){let label=panelLabels[index];if(!label){label=document.createElement('span');panelLabels[index]=label;frameCaptions.append(label);retained.allocations.labels++;}label.hidden=false;cachedText(label,energy?(index?'Space tangent plane':'Body inertia ellipsoid'):(index?'Body frame':'Space frame'));const css=`position:absolute;left:${r.x+8}px;top:${r.y+3}px;color:#9caec5;font-size:10px`;if(label.style.cssText!==css)label.style.cssText=css;}

   });renderer.setScissorTest(false);
   // Record actual visible DOM bounds for the same overlap checks as canvas stages.
   for(const entry of labelNodes.values())if(!entry.used)entry.el.hidden=true;
   for(const entry of leaderNodes.values())if(!entry.used)entry.el.style.display='none';
   const hr=host.getBoundingClientRect();shell.stage.labels=[caption,readout,...panelLabels].filter(el=>!el.hidden&&el.textContent).map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,x:r.x-hr.x,y:r.y-hr.y,width:r.width,height:r.height};});
   for(const entry of labelNodes.values())if(entry.used&&!entry.el.hidden)shell.stage.labels.push(entry.bounds);
   shell.rotationLeaderLengths=[...leaderLengths];shell.rotationTips=tips.map(({el,...t})=>Object.defineProperty(t,'el',{value:el}));shell.rotationArrows=arrowBoxes.map(o=>({...o}));shell.rotationBodyHulls=hullBoxes;shell.rotationBodyBounds={scene:{width,height},compact:layout.compact,panels:projectedBodies};shell.rotationCamera={bounds,zoom,position:camera.position.toArray(),target:[0,0,0],fixed:true};
  }
  return {draw,resize(){},destroy(){dispose(content);renderer.dispose();renderer.forceContextLoss();root.remove();style.remove();shell.host.classList.remove('rr-experiment');}};
 }
};
