import * as THREE from 'three';
import { createProp, PROP_DEFS } from './prop_library.js';
export const SIZES = {point_mass:[.16,.16,.16],sphere:[.7,.7,.7],shell:[.8,.8,.8],rod:[.08,2,.08],disk:[1,1,.12],ring:[1,1,.08],cylinder:[.8,.8,1.2],tube:[.8,.8,1.2],box:[1,.7,.6],cone:[.9,1.4,.9],block:[.8,.6,.6],beam:[2,.15,.3],ladder:[.55,2.5,.12],wheel:[1,1,.25],pulley:[.8,.8,.2],spool:[.8,.8,.5],gyroscope:[1.2,1.2,.6],turntable:[1.5,.3,1.5],top:[.7,1.2,.7],bead_hoop:[1.5,2,.5],cart:[1.4,.7,.8],train:[2,1,1],elevator:[1.2,2,1],projectile:[1.3,.8,.7],rocket:[.7,2,.7],pendulum:[1,2,.3],spring:[.2,1,.2],rope:[2,.04,.04],hinge:[.3,.5,.3],pivot_stand:[.5,1,.5],support:[3,.2,1],wedge:[2,1,1],ramp:[2.5,1,1],rail:[3,.15,.3],track:[3,1.5,1],planet:[1.5,1.5,1.5],orbit:[3,2,.1],reference_frame:[1.5,1.5,1.5]};
// Build canonical art once per shape, then apply full bounding-box dimensions.
// Named anchors therefore have the same normalized coordinates at every lab size.
export function labArt(o, mode='illustration', color=0x87afd9) {
  const id=mode==='planar'&&o.part==='support'?'block':o.part;
  const [w,h,d]=SIZES[o.part];
  const art=createProp(id,{color,size:[w,h,d],r:w/2,h:d,L:h,axis:['disk','ring','cylinder','tube','wheel','pulley','spool'].includes(o.part)?'z':PROP_DEFS.find(p=>p.id===o.part)?.axis||'y',w,depth:d});
  const bounds=new THREE.Box3().setFromObject(art),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const scale=new THREE.Vector3(o.w/Math.max(size.x,.001),o.h/Math.max(size.y,.001),o.d/Math.max(size.z,.001));
  const anchors={};
  for(const [name,value] of Object.entries(art.userData.anchors)) {
    const direction=/_dir$|_normal$/.test(name);
    const v=new THREE.Vector3(...value);
    if(direction){if(/_normal$/.test(name))v.divide(scale);else v.multiply(scale);v.normalize();}else v.sub(center).multiply(scale);
    anchors[name]={kind:direction?'direction':'point',value:v.toArray()};
  }
  art.scale.copy(scale);art.position.copy(center.multiply(scale).negate());
  art.userData.labAnchors=anchors;
  return art;
}
export function anchorWorld(o, normalized) {
  const v=new THREE.Vector3(normalized[0]*o.w,normalized[1]*o.h,normalized[2]*o.d);
  return v.applyEuler(new THREE.Euler(...[o.rx,o.ry,o.rz].map(a=>a*Math.PI/180))).add(new THREE.Vector3(o.x,o.y,o.z));
}
