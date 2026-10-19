// Prescribed supports cannot be represented by the native constant-force scene
// solver. These checked Lagrange ODEs drive the established native 3D prop kit.
// The ordinary experiment viewer owns transport/popups/lifecycle; this module
// owns only its model and disposable offscreen WebGL apparatus.
import * as THREE from 'three';
import {createProp,disposeProp} from '/js/prop_library.js';
import {clay,steel,PALETTE as C} from '/js/studio.js';
const TAU=2*Math.PI;
export function rk4(f,t,y,h){const a=f(t,y),b=f(t+h/2,y.map((v,i)=>v+h*a[i]/2)),c=f(t+h/2,y.map((v,i)=>v+h*b[i]/2)),d=f(t+h,y.map((v,i)=>v+h*c[i]));return y.map((v,i)=>v+h*(a[i]+2*b[i]+2*c[i]+d[i])/6)}
export function modes(p){const m1=p.mass,m2=1,l1=p.l1,l2=p.l2,g=p.g,A=m1*l1*l2,B=-(m1+m2)*g*(l1+l2),D=(m1+m2)*g*g,disc=Math.sqrt(B*B-4*A*D),low=2*D/(-B+disc),high=(-B+disc)/(2*A),lambda=p.mode===1?high:low,ratio=((m1+m2)*g*l1-lambda*(m1+m2)*l1*l1)/(lambda*m2*l1*l2);return {low:Math.sqrt(low),high:Math.sqrt(high),omega:Math.sqrt(lambda),ratio}}
export function derivatives(id,t,y,p){const [q,v,q2=0,v2=0]=y;if(id==='driven')return[v,(p.A*p.omega**2*Math.cos(p.omega*t)*Math.cos(q)-p.g*Math.sin(q))/p.L];if(id==='inverted')return[v,(p.g-p.A*p.omega**2*Math.cos(p.omega*t))*Math.sin(q)/p.L];if(id==='hoop')return[v,Math.sin(q)*(p.omega*p.omega*Math.cos(q)-p.g/p.R)];if(id==='double'){
 const m1=p.mass,m2=1,a=(m1+m2)*p.l1*p.l1,b=m2*p.l1*p.l2*Math.cos(q-q2),d=m2*p.l2*p.l2,F=-(m1+m2)*p.g*p.l1*Math.sin(q)-m2*p.l1*p.l2*v2*v2*Math.sin(q-q2),H=-m2*p.g*p.l2*Math.sin(q2)+m2*p.l1*p.l2*v*v*Math.sin(q-q2),det=a*d-b*b;return[v,(F*d-b*H)/det,v2,(a*H-b*F)/det]}throw Error('Unknown Lagrange model')}
export function initial(id,p){if(id==='double'){const z=modes(p),a=.1/Math.max(1,Math.abs(z.ratio));return[a,0,a*z.ratio,0]}if(id==='hoop'){const eq=p.omega**2>p.g/p.R?Math.acos(p.g/(p.R*p.omega**2)):0;return[eq+.12,0]}return[p.theta0??.1,0]}
export function integrate(id,p,duration=8,h=1/6000){let y=initial(id,p),t=0;const rows=[{t,y:[...y]}],n=Math.ceil(duration/h);h=duration/n;const f=(t,y)=>derivatives(id,t,y,p);for(let i=1;i<=n;i++){y=rk4(f,t,y,h);t=i*h;if(i%12===0||i===n)rows.push({t,y:[...y]})}return rows}
export function cycloid(t,p){const theta=Math.min(p.end,t*Math.sqrt(p.g/p.a)),x=p.a*(theta-Math.sin(theta)),y=p.a*(1-Math.cos(theta)),speed=Math.sqrt(2*p.g*y);return {t,theta,x,y,speed,thetaRate:Math.sqrt(p.g/p.a),duration:p.end*Math.sqrt(p.a/p.g),B:2*p.a}}
export function forcedSmall(t,p){const w0=Math.sqrt(p.g/p.L),F=p.A*p.omega*p.omega/p.L,d=w0*w0-p.omega*p.omega;return Math.abs(d)<1e-9?.1*Math.cos(w0*t)+F*t*Math.sin(w0*t)/(2*w0):.1*Math.cos(w0*t)+F/d*(Math.cos(p.omega*t)-Math.cos(w0*t))}
export function straightRace(t,p){const X=p.a*(p.end-Math.sin(p.end)),Y=p.a*(1-Math.cos(p.end)),duration=Math.sqrt(2*(X*X+Y*Y)/(p.g*Y)),u=Math.min(1,(t/duration)**2);return {x:X*u,y:Y*u,duration}}
export function pose(id,t,y,p){if(id==='cycloid')return cycloid(t,p);const q=y[0],v=y[1],support=id==='driven'?[p.A*Math.cos(p.omega*t),0,0]:id==='inverted'?[0,p.A*Math.cos(p.omega*t),0]:[0,0,0],L=p.L||p.R||p.l1,up=id==='inverted',bob=id==='hoop'?[p.R*Math.sin(q)*Math.cos(p.omega*t),-p.R*Math.cos(q),-p.R*Math.sin(q)*Math.sin(p.omega*t)]:[support[0]+L*Math.sin(q),support[1]+(up?1:-1)*L*Math.cos(q),0],s={t,q,v,support,bob};if(id==='double'){s.q2=y[2];s.v2=y[3];s.bob2=[bob[0]+p.l2*Math.sin(y[2]),bob[1]-p.l2*Math.cos(y[2]),0];const m1=p.mass,m2=1;s.energy=.5*(m1+m2)*p.l1**2*v*v+.5*m2*p.l2**2*y[3]**2+m2*p.l1*p.l2*v*y[3]*Math.cos(q-y[2])-(m1+m2)*p.g*p.l1*Math.cos(q)-m2*p.g*p.l2*Math.cos(y[2]);Object.assign(s,modes(p))}if(id==='hoop'){s.energy=.5*p.R*p.R*v*v-p.g*p.R*Math.cos(q)-.5*p.omega*p.omega*p.R*p.R*Math.sin(q)**2;s.eq=p.omega*p.omega>p.g/p.R?Math.acos(p.g/(p.R*p.omega*p.omega)):0;s.small=p.omega*p.omega<=p.g/p.R?Math.sqrt(Math.max(0,p.g/p.R-p.omega*p.omega)):Math.sqrt(p.omega*p.omega-p.g*p.g/(p.omega*p.omega*p.R*p.R))}if(id==='inverted')s.slow2=p.A*p.A*p.omega*p.omega/(2*p.L*p.L)-p.g/p.L;return s}
function bar(a,b,r,mat){const d=new THREE.Vector3(...b).sub(new THREE.Vector3(...a)),m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,d.length(),12),mat);m.position.copy(new THREE.Vector3(...a).add(new THREE.Vector3(...b)).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return m}
// Gravity only: these are acceleration components (force divided by mass),
// never the total acceleration in an accelerating support frame.
export function gravityComponents(id,s,p,view='setup'){
 const cycl=id==='cycloid',up=id==='inverted',angle=cycl?s.theta/2:Math.atan2(Math.sin(s.q),Math.cos(s.q));
 let radial=cycl?[Math.cos(angle),Math.sin(angle),0]:[Math.sin(angle),up?Math.cos(angle):-Math.cos(angle),0];
 let tangential=cycl?[Math.sin(angle),-Math.cos(angle),0]:[Math.cos(angle),up?-Math.sin(angle):Math.sin(angle),0];
 let origin=cycl?[s.x,-s.y,0]:s.bob,referenceOrigin=cycl?origin:s.support;
 if(id==='hoop'){const phi=view==='side'?0:p.omega*s.t,rotate=v=>[v[0]*Math.cos(phi),v[1],-v[0]*Math.sin(phi)];radial=rotate(radial);tangential=rotate(tangential);origin=radial.map(v=>v*p.R);referenceOrigin=[0,0,0]}
 return {radial,tangential,gr:-p.g*radial[1],gt:-p.g*tangential[1],origin,referenceOrigin,reference:[0,up?1:-1,0],angle,up,normal:cycl}
}
export function canvasBands(width,height,breakdown=false){const top=28,bottom=breakdown?40:4;return {x:0,y:top,width,height:Math.max(1,height-top-bottom),captionBottom:top,footerTop:height-bottom}}
function signed(v){return (v>=0?'+':'')+v.toFixed(2)}
export function buildApparatus(id,p){const group=new THREE.Group(),parts=[],extra=new THREE.Group(),overlays=new THREE.Group();group.add(extra,overlays);let first,second,bead,wire,base;
 const addProp=(id,o)=>{const g=createProp(id,o),q={g,animate:g.userData.animate};group.add(g);parts.push(q);return q};
 if(id==='hoop')first=addProp('bead_hoop',{r:p.R});else if(id==='cycloid'){
  const pts=Array.from({length:201},(_,i)=>{const s=cycloid(i*p.end/200*Math.sqrt(p.a/p.g),p);return new THREE.Vector3(s.x,-s.y,0)});wire=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),240,.012,8,false),steel());extra.add(wire);bead=addProp('sphere',{r:.065,color:C.body});
  const end=pts.at(-1);extra.add(bar([0,0,-.08],[0,-.25,-.08],.025,steel()),bar([end.x,end.y,-.08],[end.x,end.y-.25,-.08],.025,steel()));
 }else{first=addProp('pendulum',{L:p.L||p.l1,arm:'rod',mount:id!=='inverted',r:.07,color:C.body});if(id==='double')second=addProp('pendulum',{L:p.l2,arm:'rod',mount:false,r:.07,color:C.body3});
  if(id==='driven'){base=bar([-.48,.12,-.08],[.48,.12,-.08],.018,steel());extra.add(base)}if(id==='inverted'){base=bar([0,-.35,-.08],[0,.35,-.08],.018,steel());extra.add(base);const drive=createProp('block',{size:[.24,.12,.15],color:C.support});drive.position.y=-.075;first.g.add(drive)}
 }
 const arrows={gravity:new THREE.ArrowHelper(),radial:new THREE.ArrowHelper(),tangential:new THREE.ArrowHelper()};
 arrows.gravity.setColor(C.weight);arrows.radial.setColor(C.body2);arrows.tangential.setColor(C.body3);overlays.add(...Object.values(arrows));
 const line=(count,color,dashed=false)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3));const l=new THREE.Line(g,dashed?new THREE.LineDashedMaterial({color,dashSize:.025,gapSize:.02}):new THREE.LineBasicMaterial({color}));overlays.add(l);return l};
 const reference=line(2,C.ink2,true),arc=line(33,C.ink2),triangle=line(5,C.ink2,true),axisR=line(2,C.ink2,true),axisT=line(2,C.ink2,true);
 function points(line,pts){const a=line.geometry.attributes.position;pts.forEach((v,i)=>a.setXYZ(i,...v));a.needsUpdate=true;line.geometry.computeBoundingSphere();line.computeLineDistances?.()}
 let components=null;
 function update(s,view='setup',breakdown=false){
  if(id==='hoop'){first.animate.setAngle(s.q);first.animate.spin(view==='side'?0:p.omega*s.t)}else if(id==='cycloid')bead.g.position.set(s.x,-s.y,0);else{first.g.position.set(...s.support);first.animate.setAngle(id==='inverted'?Math.PI-s.q:s.q);if(second){second.g.position.set(...s.bob);second.animate.setAngle(s.q2)}}
  components=gravityComponents(id,s,p,view);const b=components.origin,scale=.30*(p.L||p.R||p.l1||p.a*2)/p.g;
  const vecs={gravity:[0,-p.g,0],radial:components.radial.map(v=>v*components.gr),tangential:components.tangential.map(v=>v*components.gt)};
  for(const [key,a]of Object.entries(arrows)){const v=new THREE.Vector3(...vecs[key]),length=v.length()*scale;a.position.set(...b);a.visible=length>1e-9;if(a.visible){a.setDirection(v.normalize());a.setLength(length,Math.min(.055,length*.35),Math.min(.032,length*.22))}}
  const add=(o,v,k)=>o.map((x,i)=>x+k*v[i]),rEnd=add(b,components.radial,components.gr*scale),tEnd=add(b,components.tangential,components.gt*scale),gEnd=add(b,[0,-p.g,0],scale);
  points(triangle,[rEnd,gEnd,tEnd,b,rEnd]);points(axisR,[add(b,components.radial,-.12),add(b,components.radial,.32)]);points(axisT,[add(b,components.tangential,-.12),add(b,components.tangential,.32)]);
  const origin=components.referenceOrigin,radius=.18*(p.L||p.R||p.l1||p.a*2),q=components.angle;
  points(reference,[origin,add(origin,components.reference,radius*1.6)]);
  points(arc,Array.from({length:33},(_,i)=>{const a=q*i/32;return add(origin,[Math.sin(a),components.up?Math.cos(a):-Math.cos(a),0],radius)}));
  overlays.visible=breakdown;group.updateMatrixWorld(true)
 }
 function dispose(){for(const q of parts)disposeProp(q.g);extra.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of [].concat(o.material))m.dispose()});overlays.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of [].concat(o.material))m.dispose()})}
 return {group,update,dispose,parts,extra,overlays,arrows,reference,arc,get components(){return components}}}
export function createExperiment(spec,{createRenderer=options=>new THREE.WebGLRenderer(options)}={}){
 const id=spec.model;let cached='',rows=[],apparatus=null,renderer=null,scene=null,camera=null,shape='',fit=null;
 const duration=p=>id==='cycloid'?p.end*Math.sqrt(p.a/p.g):8;
 function evaluate(t,p){if(id==='cycloid')return cycloid(t,p);const k=JSON.stringify(p);if(k!==cached){rows=integrate(id,p,duration(p));cached=k}let i=Math.min(rows.length-2,Math.max(0,Math.floor(t/(rows[1].t||.002))));while(i<rows.length-2&&rows[i+1].t<t)i++;while(i>0&&rows[i].t>t)i--;const a=rows[i],b=rows[i+1],u=Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t)));return pose(id,t,a.y.map((v,j)=>v+u*(b.y[j]-v)),p)}
 return {duration,playbackRate:p=>id==='inverted'?.15:id==='cycloid'?.2:1,evaluate,
 draw(c,o){
  const {width:w,height:h,state:s,params:p,view,breakdown}=o,slot=canvasBands(w,h,breakdown);
  if(!renderer){renderer=createRenderer({alpha:false,antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,2));renderer.setClearColor(0x1b1b1b);renderer.outputColorSpace=THREE.SRGBColorSpace;scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xe6edff,0x34302b,2.5));const light=new THREE.DirectionalLight(0xffffff,2.7);light.position.set(-3,5,5);scene.add(light);camera=new THREE.PerspectiveCamera(36,1,.01,100)}
  const k=JSON.stringify(p);
  if(shape!==k){
   if(apparatus){scene.remove(apparatus.group);apparatus.dispose()}apparatus=buildApparatus(id,p);scene.add(apparatus.group);shape=k;apparatus.update(s,view,false);
   const bounds=new THREE.Box3();for(const q of apparatus.parts)bounds.expandByObject(q.g);bounds.expandByObject(apparatus.extra);
   if(id==='driven'||id==='inverted')for(const r of rows.filter((_,i)=>i%20===0)){const v=pose(id,r.t,r.y,p);for(const a of [v.support,v.bob]){bounds.expandByPoint(new THREE.Vector3(...a).addScalar(.09));bounds.expandByPoint(new THREE.Vector3(...a).addScalar(-.09))}}
   fit={target:bounds.getCenter(new THREE.Vector3()),size:bounds.getSize(new THREE.Vector3())};
  }
  apparatus.update(s,view,breakdown);renderer.setSize(slot.width,slot.height,false);camera.aspect=slot.width/slot.height;
  let target=fit.target.clone(),span=Math.max(fit.size.y+.1,(fit.size.x+.1)/camera.aspect),close=view==='pivot'||view==='bead';
  if(close){const point=view==='pivot'?s.support:(id==='cycloid'?[s.x,-s.y,0]:s.bob);target=new THREE.Vector3(...point);const L=p.L||p.R||p.l1||p.a*2;span=(view==='pivot'?.6:breakdown?.95:.65)*L;if(view==='bead'&&breakdown)target.y-=.12*L;span*=Math.max(1,1/camera.aspect)}
  const distance=span/(2*Math.tan(camera.fov*Math.PI/360))*1.18;camera.position.copy(target).add(new THREE.Vector3(view==='side'?0:distance*.12,distance*.04,distance));camera.lookAt(target);camera.updateProjectionMatrix();renderer.render(scene,camera);
  // The image is confined to its own viewport. No apparatus, reference arc or
  // close-up can ever draw behind either fixed text lane.
  c.save();c.beginPath();c.rect(slot.x,slot.y,slot.width,slot.height);c.clip();c.drawImage(renderer.domElement,slot.x,slot.y,slot.width,slot.height);c.restore();
  c.fillStyle='#c5d0df';c.font='12px system-ui';c.textAlign='left';c.textBaseline='top';
  const label=breakdown?'Gravity components (m/s²)':id==='inverted'?'Rigid rod · vertical drive':id==='driven'?'Rigid rod · horizontal drive':id==='hoop'?(view==='side'?'Rotating frame · hoop fixed':'Lab frame · rotating hoop'):id==='double'?'Two massless rods':'Cycloid wire · released from rest';c.fillText(label,10,8,w-20);
  if(breakdown){const d=apparatus.components;c.font='11px system-ui';c.fillStyle='#e2b286';c.fillText(`${d.normal?'gₙ':'gᵣ'} = ${signed(d.gr)}`,10,h-37);c.fillStyle='#86cbb6';c.fillText(`gₜ = ${signed(d.gt)}`,10,h-20);c.fillStyle='#b9c5d3';c.textAlign='right';c.fillText(`${d.normal?'α':'θ'} = ${(d.angle*180/Math.PI).toFixed(1)}°`,w-10,h-37);c.font='10px system-ui';c.fillText(d.normal?'+n / forward t':'outward r / +θ t',w-10,h-20)}
 },
 describe(s,p){if(id==='cycloid')return `v ${s.speed.toFixed(2)} m/s · T ${s.duration.toFixed(3)} s`;if(id==='double')return `ω− ${s.low.toFixed(2)} · ω+ ${s.high.toFixed(2)} rad/s`;if(id==='hoop')return `θ ${(s.q*180/Math.PI).toFixed(1)}° · ωsmall ${s.small.toFixed(2)} rad/s`;if(id==='inverted')return `θ ${(s.q*180/Math.PI).toFixed(2)}° · slow Ω² ${s.slow2.toFixed(2)} s⁻²`;return `θ ${(s.q*180/Math.PI).toFixed(1)}° · support ${s.support[0].toFixed(3)} m`},
 destroy(){apparatus?.dispose();renderer?.dispose();renderer?.forceContextLoss();apparatus=null;renderer=null;scene=null}
 }
}
