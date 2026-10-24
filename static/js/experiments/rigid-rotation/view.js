import * as THREE from '/vendor/three/build/three.module.js';

// z is up in both the physics and the drawing. Vectors have independent SI scales.
const C={omega:'#82b5ff',L:'#8fd5b4',torque:'#efa67f',axes:['#d99ba8','#d7c77e','#a7a0df'],body:'#6f92bd'};
const n=x=>Math.abs(x)<1e-10?'0':String(Number(x.toPrecision(4))), norm=v=>Math.hypot(...v);
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
 {id:'norm',label:'Attitude normalization',unit:'',series:[{key:'quaternionNorm',label:'|q|',color:C.L}]},
];
export function available(f){const p=f.params;return ['body','frames','inertia',...(p.mode==='free'?['axis','energy']:p.mode==='heavy-top'?['gravity','precession']:p.mode==='tilt-torque'?['tilt','precession']:['support'])];}
function euler(f){const {principalMoments:I,omegaBody:w,torqueBody:t}=f.geometry;return I.map((a,i)=>{const j=(i+1)%3,k=(i+2)%3;return [`I_${i+1}\\dot\\omega_${i+1}=\\tau_${i+1}+(I_${j+1}-I_${k+1})\\omega_${j+1}\\omega_${k+1}`,`${n(a)}\\dot\\omega_${i+1}=${n(t[i])}+(${n(I[j])}-${n(I[k])})(${n(w[j])})(${n(w[k])})`];}).flat();}
export function closeupEquations(f){const g=f.geometry,p=f.params,s=f.sample,I=g.principalMoments;
 switch(f.closeup){
 case 'body':case 'frames':return ['\\mathbf L_s=R(q)\\mathbf L_b,\\quad\\boldsymbol\\omega_s=R(q)\\boldsymbol\\omega_b',`L_1=I_1\\omega_1=(${n(I[0])})(${n(g.omegaBody[0])})=${n(g.angularMomentumBody[0])}`];
 case 'axis':{const rate=Math.abs(g.omegaBody[1])*Math.sqrt(Math.max(0,(I[2]-I[1])*(I[1]-I[0])/(I[0]*I[2])));return ['\\lambda=|\\omega_2|\\sqrt{\\frac{(I_3-I_2)(I_2-I_1)}{I_1I_3}}',`\\lambda=${n(rate)}\\,\\mathrm{s}^{-1}\\quad\\text{(linear regime)}`];}
 case 'inertia':return [p.shape==='box'?'I_1=\\frac{m(b^2+c^2)}{12}':p.shape==='corner-masses'?'I_1=\\frac{m(b^2+c^2)}4':p.shape==='plate'?'I_3=I_1+I_2':p.shape==='custom'?'\\text{Entered principal moments about CM}':'I_3=\\tfrac12 m(a/2)^2',`(I_1,I_2,I_3)_{\\rm CM}=(${g.centreMoments.map(n).join(',')})\\,\\mathrm{kg\\,m^2}`];
 case 'gravity':return ['\\boldsymbol\\tau_g=\\mathbf r\\times(-mg\\hat{\\mathbf z})',`|\\tau_g|=mgd\\sin\\theta=(${n(p.mass*p.g*p.distance)})\\sin(${n(s.theta)})=${n(norm(g.tiltTorqueSpace))}\\,\\mathrm{N\\,m}`,'\\frac{d\\mathbf L}{dt}=\\boldsymbol\\tau_g+\\boldsymbol\\tau_{ext}'];
 case 'tilt':return ['\\boldsymbol\\tau=\\kappa\\hat{\\mathbf z}\\times\\hat{\\mathbf e}_3',`|\\tau|=|${n(p.tiltTorque)}|\\sin(${n(s.theta)})=${n(norm(g.tiltTorqueSpace))}\\,\\mathrm{N\\,m}`,'U=\\kappa\\cos\\theta'];
 case 'precession':return ['I_1\\cos\\theta\\,\\Omega^2-I_3\\omega_3\\Omega+C=0',`C=${n(g.tiltTorqueCoefficient)}\\,\\mathrm{N\\,m},\\quad\\dot\\phi=${n(s.precessionRate)}\\,\\mathrm{rad/s}`,`\\theta=${n(s.theta)}\\,\\mathrm{rad}`];
 case 'energy':return ['\\sum_i I_i\\omega_i^2=2T=\\boldsymbol\\omega\\cdot\\mathbf L',`2T=${n(2*s.kinetic)}\\,\\mathrm J`,'\\text{Body polhode; space herpolhode on }\\boldsymbol\\omega\\cdot\\mathbf L=2T'];
 case 'support':return ['\\boldsymbol\\tau_{support}=\\boldsymbol\\omega\\times\\mathbf L',`\\boldsymbol\\tau\\cdot\\boldsymbol\\omega=${n(g.torqueSpace.reduce((a,t,i)=>a+t*g.omegaSpace[i],0))}\\,\\mathrm W`];
 default:return [];
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

export const view={graphs,closeups,
 key:f=>f.closeup==='energy'?'Velocity space · radius is angular speed':'ω rad/s · L kg m²/s · τ N m · independent fixed arrow scales',
 closeupAnchors(s,f){const ids=available(f);return Object.fromEntries(ids.map((id,i)=>[id,{x:s.w*(i%2?.73:.27),y:s.h-134+Math.floor(i/2)*30}]));},
 equations(f){const g=f.geometry;return [...euler(f),...(f.params.mode==='heavy-top'?closeupEquations({...f,closeup:'gravity'}):f.params.mode==='tilt-torque'?closeupEquations({...f,closeup:'tilt'}):f.params.mode==='fixed-axis'?closeupEquations({...f,closeup:'support'}):['\\frac{d\\mathbf L_s}{dt}=\\boldsymbol\\tau_s']),`T=\\tfrac12\\sum I_i\\omega_i^2=${n(f.sample.kinetic)}\\,\\mathrm J`];},
 closeupEquation:closeupEquations,
 // Honest projected gallery thumbnail; the full experiment always mounts three.js.
 draw(s,f){const {w,h}=s,cy=h*.46,scale=Math.min(w,h)*.52/Math.max(f.params.a,f.params.b,f.params.c,1),body=f.geometry;const corners=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){const point=v([x*f.params.a/2,y*f.params.b/2,z*f.params.c/2]).applyQuaternion(q(body.quaternion));corners.push([w/2+scale*(point.x+.35*point.y),cy-scale*(point.z+.25*point.y)]);}for(let i=0;i<8;i++)for(let j=i+1;j<8;j++)if([1,2,4].includes(i^j))s.line(...corners[i],...corners[j],C.body,2);s.text('A spinning body. A fixed angular momentum.',w/2,h-25,C.L,11);},
 mount(shell){
  const host=shell.scene,root=document.createElement('div');root.className='rr-view';root.innerHTML='<div class="rr-captions"><span class="rr-title"></span><span class="rr-readout"></span></div><svg class="rr-leaders" aria-hidden="true"></svg><div class="rr-vector-labels"></div><div class="rr-frame-captions"></div>';
  const style=document.createElement('style');style.textContent=`.rr-experiment .exp-scene{min-height:470px;flex-basis:470px}.rr-experiment .exp-scene.is-closeup{min-height:450px}.rr-experiment.is-graphs-open .exp-scene{min-height:470px;flex:0 0 470px}.rr-view{position:absolute;inset:0;pointer-events:none}.rr-experiment.rr-breakdown .exp-scene{min-height:620px}.rr-experiment .exp-tools{background:#191e26;z-index:5}.rr-leaders{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none}.rr-view canvas{position:absolute;inset:0;width:100%;height:100%}.rr-captions{position:absolute;left:12px;right:12px;top:12px;display:flex;flex-direction:column;gap:6px;text-align:center;font-size:12px;z-index:1}.rr-title{color:#d5e0ed}.rr-readout{color:#8d9db2;font-size:11px;font-variant-numeric:tabular-nums}.is-closeup .rr-captions{top:45px}.rr-vector-labels{position:absolute;inset:0;z-index:1}.rr-vector-labels span{position:absolute;font-size:12px;padding:2px 5px;background:#111923d9;border-radius:4px;white-space:nowrap}.rr-frame-captions{position:absolute;inset:0;display:flex;justify-content:space-around;color:#8d9db2;font-size:11px}.rr-experiment .exp-closeups,.rr-experiment .exp-key{z-index:2}.rr-experiment .exp-closeups button{font-size:10px;padding:4px 7px;min-height:26px;height:26px;max-height:26px;line-height:16px;box-sizing:border-box}.rr-experiment .exp-key{font-size:10px;line-height:1.4}.rr-experiment .exp-equation{min-width:0;overflow:auto}.rr-experiment .exp-equation .katex{font-size:1em}@media(max-width:500px){.rr-experiment .exp-scene{min-height:465px}.rr-experiment .exp-scene.is-closeup{min-height:510px}.rr-experiment .exp-key{left:14px;right:14px}.rr-captions{font-size:11px}.rr-readout{font-size:10px}}`;
  shell.host.classList.add('rr-experiment');shell.host.append(style);host.append(root);
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x000000,0);root.prepend(renderer.domElement);renderer.domElement.setAttribute('aria-label','3D rigid body, angular velocity, angular momentum and torque');
  const scene=new THREE.Scene(),content=new THREE.Group();scene.add(content);scene.add(new THREE.HemisphereLight(0xdcecff,0x192131,2.4));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,-4,6);scene.add(light);
  const camera=new THREE.OrthographicCamera();camera.up.set(0,0,1);camera.position.set(3.6,-5.4,3.2);camera.lookAt(0,0,0);
  let instance=null,body=null,geometryLayer=new THREE.Group(),vectorLayer=new THREE.Group(),bounds=1,zoom=1,lastTime=0,traceBody=[],traceSpace=[],lastTrace=-1,scales={},lastMode='';content.add(geometryLayer,vectorLayer);
  const leaders=root.querySelector('.rr-leaders'),labels=root.querySelector('.rr-vector-labels'),caption=root.querySelector('.rr-title'),readout=root.querySelector('.rr-readout'),frameCaptions=root.querySelector('.rr-frame-captions');
  function rebuild(f){dispose(geometryLayer);body=makeBody(f);geometryLayer.add(body);const p=f.params,g=f.geometry;bounds=Math.max(.6,Math.hypot(p.a,p.shape==='rod'||p.shape==='symmetric-top'?p.a:p.b,p.c)/2+(p.mode==='heavy-top'?p.distance:0))*1.6;
   const probe=f.instance;scales={omega:bounds*.6/Math.max(1,norm(g.omegaSpace)),L:bounds*.75/Math.max(.01,norm(g.angularMomentumSpace)),torque:bounds*.6/Math.max(.01,norm(g.torqueSpace))};
   // Fixed axes span the body bounding sphere, never follow individual corners.
   instance=probe;traceBody=[];traceSpace=[];lastTrace=-1;
  }
  function cameraFor(width,height,extent){const aspect=width/Math.max(1,height);const halfHeight=extent/Math.min(1,aspect);camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;camera.top=halfHeight;camera.bottom=-halfHeight;camera.near=.01;camera.far=100;camera.updateProjectionMatrix();}
  function textAt(text,point,color,rect,placed){const p=point.clone().project(camera),x=rect.x+(p.x+1)*rect.w/2,y=rect.y+(1-p.y)*rect.h/2;const el=document.createElement('span');el.textContent=text;el.style.color=color;labels.append(el);const width=el.offsetWidth,height=el.offsetHeight;let px=Math.max(rect.x+4,Math.min(rect.x+rect.w-width-4,x+5)),py=Math.max(rect.y+22,Math.min(rect.y+rect.h-height-4,y-12));const primary=['\u03c9','L','\u03c4','\u03c4 = 0'].includes(text);if(primary){const slot=text==='\u03c9'?0:text==='L'?1:2;px=rect.x+rect.w*(.2+slot*.3)-width/2;py=rect.y+rect.h-height-3;}for(let tries=0;tries<12&&placed.some(r=>px<r.x+r.width+3&&px+width+3>r.x&&py<r.y+r.height+3&&py+height+3>r.y);tries++)py+=height+3;if(primary&&text!=='\u03c4 = 0'){const guide=document.createElementNS('http://www.w3.org/2000/svg','path');guide.setAttribute('d',`M${x},${y} L${px+width/2},${py}`);guide.setAttribute('fill','none');guide.setAttribute('stroke',color);guide.setAttribute('stroke-opacity','.38');guide.setAttribute('stroke-width','1');leaders.append(guide);}if(py+height>rect.y+rect.h){el.remove();return;}el.style.left=px+'px';el.style.top=py+'px';placed.push({x:px,y:py,width,height,text});}
  function draw(f){
   const width=host.clientWidth,height=host.clientHeight;if(!width||!height)return;renderer.setSize(width,height,false);shell.stage.w=width;shell.stage.h=height;host.classList.toggle('is-closeup',!!f.closeup);shell.host.classList.toggle('rr-breakdown',f.breakdown);
   if(instance!==f.instance){rebuild(f);}if(f.t<lastTime){traceBody=[];traceSpace=[];lastTrace=-1;}lastTime=f.t;
   const p=f.params,g=f.geometry,isBody=['body','axis','inertia','energy'].includes(f.closeup),compare=f.closeup==='frames',energy=f.closeup==='energy';
   const ids=available(f);for(const b of shell.q('.exp-closeups').children)b.hidden=!ids.includes(b.dataset.id);
   caption.textContent=f.closeup?closeups.find(c=>c.id===f.closeup)?.label.replace('Zoom · ',''):'Space frame · '+(p.shape==='custom'?'independent inertia':p.shape.replaceAll('-',' '));
   readout.textContent=energy?'Body ellipsoid / space tangent plane':f.closeup==='inertia'?`a ${n(p.a)} m · b ${n(p.b)} m · c ${n(p.c)} m`:`θ ${n(f.sample.theta)} rad · T ${n(f.sample.kinetic)} J`;
   frameCaptions.replaceChildren();labels.replaceChildren();leaders.replaceChildren();leaders.setAttribute('viewBox',`0 0 ${width} ${height}`);dispose(vectorLayer);
   if(f.t-lastTrace>.025){traceBody.push([...g.omegaBody]);traceSpace.push([...g.omegaSpace]);if(traceBody.length>800){traceBody.shift();traceSpace.shift();}lastTrace=f.t;}
   const target=f.closeup?1.18:1,dt=Math.min(.1,(performance.now()-(draw.last||performance.now()))/1000);draw.last=performance.now();zoom+= (target-zoom)*(1-Math.exp(-dt*10));if(shell.stage.snap){zoom=target;shell.stage.snap=false;}
   const narrow=width<430,top=f.closeup?108:64,bottom=f.closeup?38:155,area={x:0,y:top,w:width,h:Math.max(180,height-top-bottom)};
   const dual=compare||energy,vertical=dual&&narrow;const panels=dual?[{x:0,y:top,w:vertical?width:width/2,h:vertical?area.h/2:area.h},{x:vertical?0:width/2,y:vertical?top+area.h/2:top,w:vertical?width:width/2,h:vertical?area.h/2:area.h}]:[area];
   const placed=[];renderer.setScissorTest(false);renderer.clear();renderer.setScissorTest(true);
   panels.forEach((r,index)=>{
    dispose(vectorLayer);const bodyFrame=energy?index===0:compare?index===1:isBody;
    content.quaternion.copy(bodyFrame?q(g.quaternion).invert():new THREE.Quaternion());body.position.copy(v(g.centreOfMass));body.quaternion.copy(q(g.quaternion));body.visible=!energy;
    const extent=bounds/zoom;cameraFor(r.w,r.h,extent);renderer.setViewport(r.x,height-r.y-r.h,r.w,r.h);renderer.setScissor(r.x,height-r.y-r.h,r.w,r.h);
    const origin=[0,0,0],basis=bodyFrame?[[1,0,0],[0,1,0],[0,0,1]]:g.principalAxes;
    if(energy){
     content.quaternion.identity();const scale=bounds*.65/Math.max(...g.inertiaEllipsoidRadii,1);const point=(bodyFrame?g.omegaBody:g.omegaSpace).map(x=>x*scale);
     if(bodyFrame){const ell=new THREE.Mesh(new THREE.SphereGeometry(1,36,24),new THREE.MeshBasicMaterial({color:C.omega,wireframe:true,transparent:true,opacity:.18}));ell.scale.set(...g.inertiaEllipsoidRadii.map(x=>x*scale));vectorLayer.add(ell);}
     else {const plane=new THREE.Mesh(new THREE.PlaneGeometry(bounds*1.4,bounds*1.4),new THREE.MeshBasicMaterial({color:C.L,side:THREE.DoubleSide,transparent:true,opacity:.12}));const L=v(g.angularMomentumSpace);plane.quaternion.setFromUnitVectors(v([0,0,1]),L.clone().normalize());plane.position.copy(L.clone().multiplyScalar(2*f.sample.kinetic/(L.lengthSq()||1)*scale));vectorLayer.add(plane);}
     const trace=bodyFrame?traceBody:traceSpace;if(trace.length>1)line(vectorLayer,trace.map(a=>a.map(x=>x*scale)),bodyFrame?C.omega:C.L);arrow(vectorLayer,origin,point,norm(point),C.omega);
     textAt(bodyFrame?'ω body':'ω space',v(point),C.omega,r,placed);
    }else {
     for(let i=0;i<3;i++){const axis=v(basis[i]).applyQuaternion(q(g.quaternion));arrow(vectorLayer,origin,axis.toArray(),bounds*.57,C.axes[i]);if(f.closeup==='axis')textAt('e'+['₁','₂','₃'][i],axis.multiplyScalar(bounds*.57).applyQuaternion(content.quaternion),C.axes[i],r,placed);}
     const vectors=[['ω',g.omegaSpace,C.omega,scales.omega],['L',g.angularMomentumSpace,C.L,scales.L],['τ',g.torqueSpace,C.torque,scales.torque]];
     for(const [label,a,color,scale] of vectors){const length=Math.min(bounds*.93,norm(a)*scale);arrow(vectorLayer,origin,a,length,color);if(norm(a)>1e-10)textAt(label,v(a).normalize().multiplyScalar(length).applyQuaternion(content.quaternion),color,r,placed);}
     if(norm(g.torqueSpace)<1e-10)textAt('τ = 0',v([0,0,-bounds*.7]),C.torque,r,placed);
     if(p.mode==='heavy-top'){
      line(vectorLayer,[origin,g.centreOfMass],C.torque);const pivot=new THREE.Mesh(new THREE.SphereGeometry(bounds*.025,12,10),new THREE.MeshBasicMaterial({color:'#d2d9e3'}));vectorLayer.add(pivot);
      if(f.breakdown||['gravity','precession'].includes(f.closeup)){
       const arm=g.centreOfMass,forceLength=bounds*.48;arrow(vectorLayer,arm,g.gravityForce,forceLength,C.torque);textAt('mg',v(arm).add(v([0,0,-forceLength])).applyQuaternion(content.quaternion),C.torque,r,placed);textAt('r',v(arm).multiplyScalar(.5).applyQuaternion(content.quaternion),'#d6bd82',r,placed);
       line(vectorLayer,[origin,[0,0,p.distance]],'#8a99ad',true);line(vectorLayer,[arm,[0,0,arm[2]]],'#d6bd82',true);
       const az=Math.atan2(arm[1],arm[0]),arc=Array.from({length:33},(_,i)=>{const t=f.sample.theta*i/32;return [Math.cos(az)*Math.sin(t)*p.distance*.45,Math.sin(az)*Math.sin(t)*p.distance*.45,Math.cos(t)*p.distance*.45];});line(vectorLayer,arc,'#d6bd82');
       textAt('θ',v(arc[16]).applyQuaternion(content.quaternion),'#d6bd82',r,placed);
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
    renderer.render(scene,camera);
    if(dual){const label=document.createElement('span');label.textContent=energy?(index?'Space tangent plane':'Body inertia ellipsoid'):(index?'Body frame':'Space frame');label.style.cssText=`position:absolute;left:${r.x+8}px;top:${r.y+3}px;color:#9caec5;font-size:10px`;frameCaptions.append(label);}
   });renderer.setScissorTest(false);
   // Record actual visible DOM bounds for the same overlap checks as canvas stages.
   const hr=host.getBoundingClientRect();shell.stage.labels=[...root.querySelectorAll('span')].filter(el=>el.getClientRects().length&&el.textContent).map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,x:r.x-hr.x,y:r.y-hr.y,width:r.width,height:r.height};});
   shell.rotationCamera={bounds,zoom,position:camera.position.toArray(),target:[0,0,0],fixed:true};
  }
  return {draw,resize(){},destroy(){dispose(content);renderer.dispose();renderer.forceContextLoss();root.remove();style.remove();shell.host.classList.remove('rr-experiment');}};
 }
};
