import * as THREE from '/vendor/three/build/three.module.js';
import {model} from './model.js';

// z is up in both the physics and the drawing. Vectors have independent SI scales.
const C={omega:'#82b5ff',L:'#8fd5b4',torque:'#efa67f',axes:['#d99ba8','#d7c77e','#a7a0df'],body:'#6f92bd'};
const n=x=>Math.abs(x)<1e-10?'0':String(Number(x.toPrecision(4))), norm=v=>Math.hypot(...v);
export const readoutNumber=x=>Math.abs(x)<1e-10?'0':x.toPrecision(3).replace('-', '\u2212');
const v=a=>new THREE.Vector3(...a), q=a=>new THREE.Quaternion(a[1],a[2],a[3],a[0]);
export const closeups=[
 {id:'body',label:'Body frame'},{id:'frames',label:'Compare frames'},
 {id:'axis',label:'Zoom · middle axis'},{id:'inertia',label:'Zoom · inertia'},
 {id:'gravity',label:'Zoom · gravity'},{id:'tilt',label:'Zoom · CM torque'},
 {id:'precession',label:'Zoom · precession'},{id:'energy',label:'Zoom · energy geometry'},
 {id:'support',label:'Zoom · support'},
];
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
function euler(f){const {principalMoments:I,omegaBody:w,torqueBody:t}=f.geometry;return I.map((a,i)=>{const j=(i+1)%3,k=(i+2)%3,alpha=(t[i]+(I[j]-I[k])*w[j]*w[k])/a;return [`I_${i+1}\\dot\\omega_${i+1}=\\tau_${i+1}+(I_${j+1}-I_${k+1})\\omega_${j+1}\\omega_${k+1}`,f.narrow?`\\dot\\omega_${i+1}=${readoutNumber(alpha)}\\,\\mathrm{rad/s^2}`:`\\dot\\omega_${i+1}=\\frac{${n(t[i])}+(${n(I[j])}-${n(I[k])})(${n(w[j])})(${n(w[k])})}{${n(a)}}=${n(alpha)}\\,\\mathrm{rad/s^2}`];}).flat();}
function rawCloseupEquations(f){const g=f.geometry,p=f.params,s=f.sample,I=g.principalMoments;
 switch(f.closeup){
 case 'body':case 'frames':return ['\\mathbf L_s=R(q)\\mathbf L_b,\\quad\\boldsymbol\\omega_s=R(q)\\boldsymbol\\omega_b',`L_1=I_1\\omega_1=(${n(I[0])})(${n(g.omegaBody[0])})=${n(g.angularMomentumBody[0])}\\,\\mathrm{kg\\,m^2/s}`];
 case 'axis':{const rate=Math.abs(g.omegaBody[1])*Math.sqrt(Math.max(0,(I[2]-I[1])*(I[1]-I[0])/(I[0]*I[2])));return ['\\lambda=|\\omega_2|\\sqrt{\\frac{(I_3-I_2)(I_2-I_1)}{I_1I_3}}',`\\lambda=${n(rate)}\\,\\mathrm{s}^{-1}\\quad\\text{(linear regime)}`];}
 case 'inertia':return [p.shape==='box'?'I_1=\\frac{m(b^2+c^2)}{12}':p.shape==='corner-masses'?'I_1=\\frac{m(b^2+c^2)}4':p.shape==='plate'?'I_3=I_1+I_2':p.shape==='custom'?'\\text{Entered principal moments about CM}':'I_3=\\tfrac12 m(a/2)^2',`(I_1,I_2,I_3)_{\\rm CM}=(${g.centreMoments.map(n).join(',')})\\,\\mathrm{kg\\,m^2}`];
 case 'gravity':return ['\\boldsymbol\\tau_g=\\mathbf r\\times(-mg\\hat{\\mathbf z})',...(f.narrow?['|\\tau_g|=mgd\\sin\\theta',`|\\tau_g|=${readoutNumber(norm(g.tiltTorqueSpace))}\\,\\mathrm{N\\,m}`]:[`|\\tau_g|=mgd\\sin\\theta=(${n(p.mass*p.g*p.distance)})\\sin(${n(s.theta)})=${n(norm(g.tiltTorqueSpace))}\\,\\mathrm{N\\,m}`]),'\\frac{d\\mathbf L}{dt}=\\boldsymbol\\tau_g+\\boldsymbol\\tau_{ext}'];
 case 'tilt':return ['\\boldsymbol\\tau=\\kappa\\hat{\\mathbf z}\\times\\hat{\\mathbf e}_3',`|\\tau|=|${n(p.tiltTorque)}|\\sin(${n(s.theta)})=${n(norm(g.tiltTorqueSpace))}\\,\\mathrm{N\\,m}`,`U=\\kappa\\cos\\theta=${n(p.tiltTorque*Math.cos(s.theta))}\\,\\mathrm J`];
 case 'precession':return ['I_1\\cos\\theta\\,\\Omega^2-I_3\\omega_3\\Omega+C=0',`C=${n(g.tiltTorqueCoefficient)}\\,\\mathrm{N\\,m},\\quad\\dot\\phi=${n(s.precessionRate)}\\,\\mathrm{rad/s}`,`\\theta=${n(s.theta)}\\,\\mathrm{rad}`];
 case 'energy':return ['\\sum_i I_i\\omega_i^2=2T=\\boldsymbol\\omega\\cdot\\mathbf L',`2T=${n(2*s.kinetic)}\\,\\mathrm J`,'\\text{Body polhode; space herpolhode on }\\boldsymbol\\omega\\cdot\\mathbf L=2T'];
 case 'support':return ['\\boldsymbol\\tau_{support}=\\boldsymbol\\omega\\times\\mathbf L',`\\boldsymbol\\tau\\cdot\\boldsymbol\\omega=${n(g.torqueSpace.reduce((a,t,i)=>a+t*g.omegaSpace[i],0))}\\,\\mathrm W`];
 default:return [];
 }
}
export function closeupEquations(f){
 if(!f.narrow)return rawCloseupEquations(f);
 const g=f.geometry,p=f.params,s=f.sample;
 switch(f.closeup){
 case 'body':case 'frames':return ['\\mathbf L_s=R(q)\\mathbf L_b','\\boldsymbol\\omega_s=R(q)\\boldsymbol\\omega_b',`L_1=I_1\\omega_1=${readoutNumber(g.angularMomentumBody[0])}\\,\\mathrm{kg\\,m^2/s}`];
 case 'inertia':return [rawCloseupEquations(f)[0],...g.centreMoments.map((x,i)=>`I_{${i+1},\\rm CM}=${readoutNumber(x)}\\,\\mathrm{kg\\,m^2}`)];
 case 'tilt':return ['\\boldsymbol\\tau=\\kappa\\hat{\\mathbf z}\\times\\hat{\\mathbf e}_3','|\\tau|=|\\kappa|\\sin\\theta',`|\\tau|=${readoutNumber(norm(g.tiltTorqueSpace))}\\,\\mathrm{N\\,m}`,`U=\\kappa\\cos\\theta=${readoutNumber(p.tiltTorque*Math.cos(s.theta))}\\,\\mathrm J`];
 case 'precession':return [rawCloseupEquations(f)[0],`C=${readoutNumber(g.tiltTorqueCoefficient)}\\,\\mathrm{N\\,m}`,`\\dot\\phi=${readoutNumber(s.precessionRate)}\\,\\mathrm{rad/s}`,`\\theta=${readoutNumber(s.theta)}\\,\\mathrm{rad}`];
 case 'energy':return [rawCloseupEquations(f)[0],`2T=${readoutNumber(2*s.kinetic)}\\,\\mathrm J`,'\\text{Body: polhode}','\\text{Space: herpolhode}','\\boldsymbol\\omega\\cdot\\mathbf L=2T'];
 default:return rawCloseupEquations(f);
 }
}
function line(group,points,color,dashed=false){const geometry=new THREE.BufferGeometry().setFromPoints(points.map(v));const material=dashed?new THREE.LineDashedMaterial({color,dashSize:.07,gapSize:.04}):new THREE.LineBasicMaterial({color,transparent:true,opacity:.8});const mesh=new THREE.Line(geometry,material);if(dashed)mesh.computeLineDistances();group.add(mesh);return mesh;}
function arrow(group,origin,vector,length,color){if(norm(vector)<1e-10)return null;const a=new THREE.ArrowHelper(v(vector).normalize(),v(origin),length,color,Math.min(.09,length*.22),Math.min(.05,length*.12));a.traverse(o=>{o.renderOrder=30;if(o.material){o.material.depthTest=false;o.material.depthWrite=false;o.material.transparent=true;}});group.add(a);return a;}
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
function visibleTargets(f){return available(f).filter(id=>!['body','frames'].includes(id));}
export const view={graphs,closeups,
 graphDescriptors(params){const window=graphWindow(params);return graphs.map(g=>g.kind?g:{...g,window});},
 key:f=>f.compact?'\u03c9 rad/s \u00b7 L kg m\u00b2/s \u00b7 \u03c4 N m':f.closeup==='energy'?'Velocity space · radius is angular speed':'ω rad/s · L kg m²/s · τ N m · arrows use separate fixed scales',
 closeupAnchors(s,f){return f.rotationAnchors||Object.fromEntries(visibleTargets(f).map((id,i)=>[id,{x:s.w*(i===0?.27:i===1?.73:.5),y:i<2?(s.h<420?42:67):s.h-62}]));},
 equations(f){const g=f.geometry;return [...euler(f),...(f.params.mode==='heavy-top'?closeupEquations({...f,closeup:'gravity'}):f.params.mode==='tilt-torque'?closeupEquations({...f,closeup:'tilt'}):f.params.mode==='fixed-axis'?closeupEquations({...f,closeup:'support'}):['\\frac{d\\mathbf L_s}{dt}=\\boldsymbol\\tau_s']),`T=\\tfrac12\\sum I_i\\omega_i^2=${n(f.sample.kinetic)}\\,\\mathrm J`];},
 closeupEquation:closeupEquations,
 // Honest projected gallery thumbnail; the full experiment always mounts three.js.
 draw(s,f){const {w,h}=s,body=f.geometry,points=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){const point=v([x*f.params.a/2,y*f.params.b/2,z*f.params.c/2]).applyQuaternion(q(body.quaternion));points.push([point.x+.35*point.y,-point.z-.25*point.y]);}const lo=[0,1].map(i=>Math.min(...points.map(p=>p[i]))),hi=[0,1].map(i=>Math.max(...points.map(p=>p[i]))),scale=.78*Math.min(w/(hi[0]-lo[0]||1),h/(hi[1]-lo[1]||1));const corners=points.map(p=>[w/2+scale*(p[0]-(lo[0]+hi[0])/2),h/2+scale*(p[1]-(lo[1]+hi[1])/2)]);for(let i=0;i<8;i++)for(let j=i+1;j<8;j++)if([1,2,4].includes(i^j))s.line(...corners[i],...corners[j],C.body,2);},
 mount(shell){
  const host=shell.scene,root=document.createElement('div');root.className='rr-view';root.innerHTML='<div class="rr-captions"><span class="rr-title"></span><span class="rr-readout"></span></div><svg class="rr-leaders" aria-hidden="true"></svg><div class="rr-vector-labels"></div><div class="rr-frame-captions"></div>';
  const style=document.createElement('style');style.textContent=`.rr-experiment .exp-scene{min-height:470px;flex-basis:470px}.rr-experiment .exp-scene.is-closeup{min-height:450px}.rr-experiment.is-graphs-open .exp-scene{min-height:280px;flex:0 0 280px}.rr-view{position:absolute;inset:0;pointer-events:none}.rr-experiment.rr-breakdown .exp-scene{min-height:520px;flex:1 0 520px}.rr-compact .rr-readout{font-size:10px}.rr-compact .rr-captions{font-size:11px}.rr-experiment .exp-note{padding-bottom:14px}.rr-experiment .exp-transport{background:#191e26;z-index:5;margin-top:auto}.rr-experiment .exp-tools{background:#191e26;z-index:5}.rr-leaders{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none}.rr-view canvas{position:absolute;inset:0;width:100%;height:100%}.rr-captions{position:absolute;left:12px;right:12px;top:12px;display:flex;flex-direction:column;gap:6px;text-align:center;font-size:12px;z-index:1}.rr-title{color:#d5e0ed}.rr-readout{color:#8d9db2;font-size:11px;font-variant-numeric:tabular-nums}.is-closeup .rr-captions{top:45px}.rr-vector-labels{position:absolute;inset:0;z-index:1}.rr-vector-labels span{position:absolute;font-size:12px;padding:2px 5px;white-space:nowrap}.rr-frame-captions{position:absolute;inset:0;display:flex;justify-content:space-around;color:#8d9db2;font-size:11px}.rr-experiment .exp-closeups,.rr-experiment .exp-key{z-index:2}.rr-experiment .exp-key{font-size:10px;line-height:1.4}.rr-experiment .exp-equation{min-width:0;overflow:auto}.rr-experiment .exp-equation .katex{font-size:1em}@media(max-width:500px){.rr-experiment .exp-scene{min-height:465px}.rr-experiment .exp-scene.is-closeup{min-height:510px}.rr-experiment .exp-key{left:14px;right:14px}.rr-captions{font-size:11px}.rr-readout{font-size:10px}}`;
  shell.host.classList.add('rr-experiment');shell.host.append(style);host.append(root);
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x000000,0);root.prepend(renderer.domElement);renderer.domElement.setAttribute('aria-label','3D rigid body, angular velocity, angular momentum and torque');
  const scene=new THREE.Scene(),content=new THREE.Group();scene.add(content);scene.add(new THREE.HemisphereLight(0xdcecff,0x192131,2.4));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,-4,6);scene.add(light);
  const camera=new THREE.OrthographicCamera();camera.up.set(0,0,1);camera.position.set(3.6,-5.4,3.2);camera.lookAt(0,0,0);
  let instance=null,referenceGeometry=null,body=null,geometryLayer=new THREE.Group(),vectorLayer=new THREE.Group(),bounds=1,zoom=1,lastTime=0,traceBody=[],traceSpace=[],lastTrace=-1,scales={};content.add(geometryLayer,vectorLayer);
  const leaders=root.querySelector('.rr-leaders'),labels=root.querySelector('.rr-vector-labels'),caption=root.querySelector('.rr-title'),readout=root.querySelector('.rr-readout'),frameCaptions=root.querySelector('.rr-frame-captions');
  function rebuild(f){dispose(geometryLayer);body=makeBody(f);geometryLayer.add(body);const p=f.params,g=f.geometry;bounds=Math.max(.6,Math.hypot(p.a,p.shape==='rod'||p.shape==='symmetric-top'?p.a:p.b,p.c)/2+(p.mode==='heavy-top'?p.distance:0))*1.6;
   referenceGeometry=model.create(p).geometry();
   const probe=f.instance;scales={omega:bounds*.6/Math.max(1,norm(g.omegaSpace)),L:bounds*.75/Math.max(.01,norm(g.angularMomentumSpace)),torque:bounds*.6/Math.max(.01,norm(g.torqueSpace))};
   // Fixed axes span the body bounding sphere, never follow individual corners.
   instance=probe;traceBody=[];traceSpace=[];lastTrace=-1;
  }
  function cameraFor(width,height,extent){const aspect=width/Math.max(1,height);const halfHeight=extent/Math.min(1,aspect);camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;camera.top=halfHeight;camera.bottom=-halfHeight;camera.near=.01;camera.far=100;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);}
  const labelPositions=new Map();let leaderLengths=[];
  function textAt(text,point,color,rect,placed){
   const projected=point.clone().project(camera),x=rect.x+(projected.x+1)*rect.w/2,y=rect.y+(1-projected.y)*rect.h/2;
   const el=document.createElement('span');el.textContent=text;el.style.color=color;labels.append(el);
   const width=el.offsetWidth,height=el.offsetHeight,key=[shell.closeup,rect.x,rect.y,rect.w,rect.h,text].join(':');
   const intersects=a=>placed.some(b=>a.x<b.x+b.width+4&&a.x+width+4>b.x&&a.y<b.y+b.height+4&&a.y+height+4>b.y);
   const leaderLength=a=>Math.hypot(Math.max(a.x,Math.min(a.x+width,x))-x,Math.max(a.y,Math.min(a.y+height,y))-y);
   const valid=a=>a.x>=rect.x+3&&a.y>=rect.y+18&&a.x+width<=rect.x+rect.w-3&&a.y+height<=rect.y+rect.h-3&&!intersects(a)&&leaderLength(a)<=40;
   // Prefer a label just beside its real projected tip. Alternatives are bounded
   // near that same tip, never a distant row that resembles another force vector.
   const offsets=[...(text==='mg'?[[-width-12,-height/2],[-width-12,8]]:[]),[9,-height/2],[9,-height-6],[9,7],[-width-9,-height/2],[-width/2,-height-12],[-width/2,13],[20,-height-18],[-width-20,13],[-width/2,27]];
   const target=offsets.map(([dx,dy])=>({x:x+dx,y:y+dy})).find(valid);
   if(!target){el.remove();labelPositions.delete(key);return;}
   const previous=labelPositions.get(key),smooth=previous?{x:previous.x+(target.x-previous.x)*.2,y:previous.y+(target.y-previous.y)*.2}:target;
   const position=valid(smooth)?smooth:target;labelPositions.set(key,position);
   el.style.left=position.x+'px';el.style.top=position.y+'px';placed.push({...position,width,height,text});
   const length=leaderLength(position);leaderLengths.push(length);
   if(length>7&&text!=='\u03c4 = 0'){
    const tx=Math.max(position.x,Math.min(position.x+width,x)),ty=Math.max(position.y,Math.min(position.y+height,y));
    const guide=document.createElementNS('http://www.w3.org/2000/svg','path');guide.setAttribute('d',`M${x},${y} L${tx},${ty}`);guide.setAttribute('fill','none');guide.setAttribute('stroke',color);guide.setAttribute('stroke-opacity','.5');guide.setAttribute('stroke-width','1');leaders.append(guide);
   }
  }
  function draw(f){
   // Keep camera-frame choices in Setup. Preserve the kit's validated close-up
   // actions and ordinary shared buttons, without exposing these as zoom chips.
   let controls=shell.setup.querySelector('.rr-frame-controls');
   if(!controls){controls=document.createElement('div');controls.className='rr-frame-controls';controls.innerHTML='<div>Viewing frame</div><div class="exp-presets" role="group" aria-label="Viewing frame"><button data-exp="scene">Space frame</button></div>';shell.setup.prepend(controls);}
   for(const id of ['body','frames']){const button=shell.q(`.exp-closeups [data-id="${id}"]`);if(button)controls.lastElementChild.append(button);}
   for(const button of controls.querySelectorAll('button'))button.setAttribute('aria-pressed',String((button.dataset.id||'')===f.closeup));
   host.classList.toggle('is-closeup',!!f.closeup);shell.host.classList.toggle('rr-breakdown',f.breakdown);const width=host.clientWidth,height=host.clientHeight;if(!width||!height)return;f.narrow=width<430;renderer.setSize(width,height,false);shell.stage.w=width;shell.stage.h=height;
   if(instance!==f.instance){rebuild(f);}if(f.t<lastTime){traceBody=[];traceSpace=[];lastTrace=-1;}lastTime=f.t;
   const p=f.params,g=f.geometry,isBody=['body','axis','inertia','energy'].includes(f.closeup),compare=f.closeup==='frames',energy=f.closeup==='energy';
   const layout=sceneLayout(width,height,f.closeup);f.compact=layout.compact;root.classList.toggle('rr-compact',layout.compact);const ids=visibleTargets(f,height);for(const b of shell.q('.exp-closeups').children)b.hidden=!ids.includes(b.dataset.id);
   caption.textContent=f.closeup?closeups.find(c=>c.id===f.closeup)?.label.replace('Zoom · ',''):'Space frame · '+(p.shape==='custom'?'independent inertia':p.shape.replaceAll('-',' '));
   readout.textContent=energy?'Body ellipsoid / space tangent plane':f.closeup==='inertia'?`a ${readoutNumber(p.a)} m · b ${readoutNumber(p.b)} m · c ${readoutNumber(p.c)} m`:`θ ${readoutNumber(f.sample.theta)} rad · T ${readoutNumber(f.sample.kinetic)} J`;
   if(norm(g.torqueSpace)<1e-10&&!energy)readout.textContent+=' · τ 0 N m';
   leaderLengths=[];frameCaptions.replaceChildren();labels.replaceChildren();leaders.replaceChildren();leaders.setAttribute('viewBox',`0 0 ${width} ${height}`);dispose(vectorLayer);
   if(f.t-lastTrace>.025){traceBody.push([...g.omegaBody]);traceSpace.push([...g.omegaSpace]);if(traceBody.length>800){traceBody.shift();traceSpace.shift();}lastTrace=f.t;}
   const target=f.closeup?1.18:1,dt=Math.min(.1,(performance.now()-(draw.last||performance.now()))/1000);draw.last=performance.now();zoom+= (target-zoom)*(1-Math.exp(-dt*10));if(shell.stage.snap){zoom=target;shell.stage.snap=false;}
   const narrow=width<430,{top,area}=layout;
   const dual=compare||energy,vertical=dual&&narrow;const panels=dual?[{x:0,y:top,w:vertical?width:width/2,h:vertical?area.h/2:area.h},{x:vertical?0:width/2,y:vertical?top+area.h/2:top,w:vertical?width:width/2,h:vertical?area.h/2:area.h}]:[area];
   const projectedBodies=[];const placed=[];renderer.setScissorTest(false);renderer.clear();renderer.setScissorTest(true);
   panels.forEach((r,index)=>{
    dispose(vectorLayer);const bodyFrame=energy?index===0:compare?index===1:isBody;
    content.quaternion.copy(bodyFrame?q(g.quaternion).invert():new THREE.Quaternion());body.position.copy(v(g.centreOfMass));body.quaternion.copy(q(g.quaternion));body.visible=!energy;
    const factor=f.breakdown&&!f.closeup ? .7 : cameraExtentFactor(width,height,f.closeup),cornerPadding=factor<1&&p.shape==='corner-masses' ? .11*Math.min(p.a,p.b,p.c) : 0;
    const extent=bounds/zoom*factor+cornerPadding;cameraFor(r.w,r.h,extent);renderer.setViewport(r.x,height-r.y-r.h,r.w,r.h);renderer.setScissor(r.x,height-r.y-r.h,r.w,r.h);
    if(!f.closeup){
     const points=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
      const point=v([x*p.a/2,y*(p.shape==='rod'||p.shape==='symmetric-top'?p.a:p.b)/2,z*p.c/2]).applyQuaternion(q(referenceGeometry.quaternion)).add(v(referenceGeometry.centreOfMass)).project(camera);
      points.push({x:r.x+(point.x+1)*r.w/2,y:r.y+(1-point.y)*r.h/2});
     }
     const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x)),above=Math.min(...points.map(p=>p.y)),below=Math.max(...points.map(p=>p.y)),cy=(above+below)/2;
     const lowerRow=Math.min(height-106,below+12);
     f.rotationAnchors=Object.fromEntries(ids.map((id,i)=>[id,narrow?{x:width*(['gravity','precession'].includes(id)?.26:i===0?.28:i===1?.72:.5),y:i===0?Math.max(60,Math.min(above-42,lowerRow-44)):lowerRow+(i-1)*44}:i<2?{x:i===0?left-74:right+74,y:cy-16}:{x:id==='precession'?left-74:width/2,y:Math.min(height-62,below+12)}]));
     shell.rotationAnchors=f.rotationAnchors;
     for(const button of shell.q('.exp-closeups').children){const a=f.rotationAnchors[button.dataset.id];if(!a||button.hidden)continue;const w=button.offsetWidth,h=button.offsetHeight,x=Math.max(w/2+8,Math.min(width-w/2-8,a.x));placed.push({x:x-w/2,y:Math.min(height-40,a.y),width:w,height:h});}
    }
    const origin=[0,0,0],basis=bodyFrame?[[1,0,0],[0,1,0],[0,0,1]]:g.principalAxes;
    if(energy){
     content.quaternion.identity();const scale=bounds*.65/Math.max(...g.inertiaEllipsoidRadii,1);const point=(bodyFrame?g.omegaBody:g.omegaSpace).map(x=>x*scale);
     if(bodyFrame){const ell=new THREE.Mesh(new THREE.SphereGeometry(1,36,24),new THREE.MeshBasicMaterial({color:C.omega,wireframe:true,transparent:true,opacity:.18}));ell.scale.set(...g.inertiaEllipsoidRadii.map(x=>x*scale));vectorLayer.add(ell);}
     else {const size=bounds*.9,plane=new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshBasicMaterial({color:C.L,side:THREE.DoubleSide,transparent:true,opacity:.12}));const L=v(g.angularMomentumSpace);plane.quaternion.setFromUnitVectors(v([0,0,1]),L.clone().normalize());plane.position.copy(L.clone().multiplyScalar(2*f.sample.kinetic/(L.lengthSq()||1)*scale));const center=plane.position.clone().project(camera),corners=[];for(const x of [-size/2,size/2])for(const y of [-size/2,size/2])corners.push(v([x,y,0]).applyQuaternion(plane.quaternion).add(plane.position).project(camera));plane.scale.setScalar(finitePatchScale(center,corners));vectorLayer.add(plane);}
     const trace=bodyFrame?traceBody:traceSpace;if(trace.length>1)line(vectorLayer,trace.map(a=>a.map(x=>x*scale)),bodyFrame?C.omega:C.L);arrow(vectorLayer,origin,point,norm(point),C.omega);
     textAt(bodyFrame?'ω body':'ω space',v(point),C.omega,r,placed);
    }else {
     for(let i=0;i<3;i++){const axis=v(basis[i]).applyQuaternion(q(g.quaternion));arrow(vectorLayer,origin,axis.toArray(),bounds*.57,C.axes[i]);if(f.closeup==='axis'&&(!narrow||i===1))textAt('e'+['₁','₂','₃'][i],axis.multiplyScalar(bounds*.57).applyQuaternion(content.quaternion),C.axes[i],r,placed);}
     const vectors=[['ω',g.omegaSpace,C.omega,scales.omega],['L',g.angularMomentumSpace,C.L,scales.L],['τ',g.torqueSpace,C.torque,scales.torque]];
     for(const [label,a,color,scale] of vectors){const length=Math.min(bounds*.93,norm(a)*scale);arrow(vectorLayer,origin,a,length,color);if(norm(a)>1e-10)textAt(label,v(a).normalize().multiplyScalar(length).applyQuaternion(content.quaternion),color,r,placed);}
     if(p.mode==='heavy-top'){
      line(vectorLayer,[origin,g.centreOfMass],C.torque);const pivot=new THREE.Mesh(new THREE.SphereGeometry(bounds*.025,12,10),new THREE.MeshBasicMaterial({color:'#d2d9e3'}));vectorLayer.add(pivot);
      if(f.breakdown||['gravity','precession'].includes(f.closeup)){
       const arm=g.centreOfMass,forceLength=bounds*.48;arrow(vectorLayer,arm,g.gravityForce,forceLength,C.torque);textAt('mg',v(arm).add(v([0,0,-forceLength])).applyQuaternion(content.quaternion),C.torque,r,placed);if(!narrow)textAt('r',v(arm).multiplyScalar(.5).applyQuaternion(content.quaternion),'#d6bd82',r,placed);
       line(vectorLayer,[origin,[0,0,p.distance]],'#8a99ad',true);line(vectorLayer,[arm,[0,0,arm[2]]],'#d6bd82',true);
       const az=Math.atan2(arm[1],arm[0]),arc=Array.from({length:33},(_,i)=>{const t=f.sample.theta*i/32;return [Math.cos(az)*Math.sin(t)*p.distance*.45,Math.sin(az)*Math.sin(t)*p.distance*.45,Math.cos(t)*p.distance*.45];});line(vectorLayer,arc,'#d6bd82');
       if(!narrow)textAt('θ',v(arc[16]).applyQuaternion(content.quaternion),'#d6bd82',r,placed);
      }
     }
     if(f.closeup==='precession'){const radius=Math.sin(f.sample.theta)*bounds*.65,z=Math.cos(f.sample.theta)*bounds*.65;line(vectorLayer,Array.from({length:81},(_,i)=>[radius*Math.cos(i*Math.PI/40),radius*Math.sin(i*Math.PI/40),z]),'#6f8296',true);}
     if(f.closeup==='tilt'){line(vectorLayer,[origin,[0,0,bounds*.7]],'#9ba8b9',true);textAt('z space',v([0,0,bounds*.7]).applyQuaternion(content.quaternion),'#9ba8b9',r,placed);}
     if(f.closeup==='inertia'&&['box','corner-masses'].includes(p.shape)){
      const local=[[-p.a/2,-p.b/2,-p.c/2],[p.a/2,-p.b/2,-p.c/2],[-p.a/2,p.b/2,-p.c/2],[-p.a/2,-p.b/2,p.c/2]];
      const points=local.map(a=>v(a).applyQuaternion(q(g.quaternion)).add(v(g.centreOfMass)));
      for(let i=1;i<4;i++){line(vectorLayer,[points[0].toArray(),points[i].toArray()],C.axes[i-1]);textAt(['a','b','c'][i-1],points[i].clone().applyQuaternion(content.quaternion),C.axes[i-1],r,placed);}
     }
     if(bodyFrame){for(let i=0;i<3;i++){const a=[0,0,0];a[i]=bounds*.8;line(vectorLayer,[origin,a],'#536279',true);}}
    }
    // Inspect actual rendered body geometry, including its corner marker. Keep
    // the camera fixed to the full-motion sphere; these bounds are evidence only.
    content.updateMatrixWorld(true);const projected=[];
    body.traverse(object=>{if(!object.geometry)return;object.geometry.computeBoundingBox();const box=object.geometry.boundingBox;for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const point=v([x,y,z]).applyMatrix4(object.matrixWorld).project(camera);projected.push({x:r.x+(point.x+1)*r.w/2,y:r.y+(1-point.y)*r.h/2});}});
    projectedBodies.push({visible:body.visible,panel:{...r},x:Math.min(...projected.map(p=>p.x)),right:Math.max(...projected.map(p=>p.x)),y:Math.min(...projected.map(p=>p.y)),bottom:Math.max(...projected.map(p=>p.y))});
    renderer.render(scene,camera);
    if(dual){const label=document.createElement('span');label.textContent=energy?(index?'Space tangent plane':'Body inertia ellipsoid'):(index?'Body frame':'Space frame');label.style.cssText=`position:absolute;left:${r.x+8}px;top:${r.y+3}px;color:#9caec5;font-size:10px`;frameCaptions.append(label);}
   });renderer.setScissorTest(false);
   // Record actual visible DOM bounds for the same overlap checks as canvas stages.
   const hr=host.getBoundingClientRect();shell.stage.labels=[...root.querySelectorAll('span')].filter(el=>el.getClientRects().length&&el.textContent).map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,x:r.x-hr.x,y:r.y-hr.y,width:r.width,height:r.height};});
   shell.rotationLeaderLengths=[...leaderLengths];shell.rotationBodyBounds={scene:{width,height},compact:layout.compact,panels:projectedBodies};shell.rotationCamera={bounds,zoom,position:camera.position.toArray(),target:[0,0,0],fixed:true};
  }
  return {draw,resize(){},destroy(){dispose(content);renderer.dispose();renderer.forceContextLoss();root.remove();style.remove();shell.host.classList.remove('rr-experiment');}};
 }
};
