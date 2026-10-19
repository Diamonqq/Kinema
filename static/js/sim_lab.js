import { controlIcon } from './icons.js';
import * as THREE from 'three';
import { makeStudio, framingDistance } from './studio.js';
import { labArt } from './sim_lab_geometry.js';
// Viewer only. Teacher owns every message, attachment, provider job and save.
export class SimulationLab {
  constructor(host,{api,url}){
    Object.assign(this,{host,api,url});this.meshes=new Map();this.runToken=0;this.version=0;this.time=0;this.speed=1;
  }
  request(path,body){return this.api(this.url('/api/sim-lab'+path),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
  async mount(art){
    this.active=true;const version=++this.version;this.doc=art.lab_document;this.running=false;this.sim=null;this.time=0;this.runToken++;this.motionBounds=null;this.manualCamera=false;this.compilePromise=null;this.compiling=false;
    if(this.studio){this.rebuild();this.sync();this.animate();this.prepare().catch(e=>{if(this.active&&version===this.version)this.message(e.message);});this.resizeObserver ||= new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.host);return this;}
    this.host.classList.add('sim-lab-viewer');
    this.host.innerHTML=`<div class="sl-canvas" aria-label="Simulation canvas. Drag to orbit; scroll to zoom."></div><div class="sl-transport"><button data-sl="run" aria-label="Play simulation" title="Play simulation">${controlIcon('play')}</button><button data-sl="reset" aria-label="Reset simulation" title="Reset simulation">${controlIcon('reset')}</button><button data-sl="fit" aria-label="Fit full motion" title="Fit full motion">${controlIcon('fit')}</button><div class="sl-playback" hidden><input class="sl-seek" type="range" min="0" max="5" step="0.01" value="0" aria-label="Playback time" disabled><span class="sl-time">0.00 s</span><select class="sl-speed" aria-label="Playback speed"><option value="0.25">0.25&#215;</option><option value="0.5">0.5&#215;</option><option value="1" selected>1&#215;</option><option value="2">2&#215;</option></select></div><span class="sl-mode" hidden>3D illustration</span></div><div class="sl-error" role="alert" hidden></div>`;
    this.host.addEventListener('click',e=>{const b=e.target.closest('[data-sl]');if(b)this.action(b.dataset.sl).catch(err=>this.message(err.message));});
    this.host.querySelector('.sl-seek').oninput=e=>this.seek(Number(e.target.value));
    this.host.querySelector('.sl-speed').onchange=e=>this.setSpeed(Number(e.target.value));
    const studio=await makeStudio(this.host.querySelector('.sl-canvas'),{fov:32,resizeFrame:()=>({points:this.framePoints()})});
    this.studio=studio;
    if(!this.active||version!==this.version){this.destroy();return this;}
    this.configureStudio();this.rebuild();this.sync();
    this.studio.controls.addEventListener('start',()=>{this.manualCamera=true;});
    this.prepare().catch(e=>{if(this.active&&version===this.version)this.message(e.message);});
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.host);
    this.animate();return this;
  }
  message(text){const node=this.host.querySelector('.sl-error');node.textContent=text;node.hidden=!text;}
  sync(){const b=this.host.querySelector('[data-sl=run]'),label=this.running?'Pause simulation':this.sim&&this.time>=this.sim.duration?'Replay simulation':'Play simulation';if(b.title!==label)b.innerHTML=controlIcon(this.running?'pause':'play');b.setAttribute('aria-label',label);b.title=label;b.disabled=!!this.compiling;this.syncPlayback();}
  async prepare(){
    if(this.doc.mode!=='planar'||this.sim)return;
    if(this.compilePromise)return this.compilePromise;
    const version=this.version;this.compiling=true;this.sync();
    const pending=(async()=>{
      const {scene}=await this.request('/compile',this.doc);
      if(!this.active||version!==this.version)return;
      this.sim=window.Kinema2D.simulate(scene);this.computeMotionBounds();
      if(!this.manualCamera)this.fit();
    })();
    this.compilePromise=pending;
    try{await pending;}finally{if(version===this.version){this.compiling=false;this.compilePromise=null;this.sync();}}
  }
  clearMotion(){this.runToken++;this.running=false;this.sim=null;this.time=0;this.syncPlayback();}
  async action(a){
    if(a==='fit')return this.fit();
    if(a==='reset'){this.runToken++;this.running=false;this.time=0;if(this.sim)this.renderFrame();else this.rebuild();this.fit();this.sync();this.message('');return;}
    if(a==='run'&&this.doc.mode==='planar'){
      const token=++this.runToken;if(this.running){this.running=false;this.sync();this.message('');return;}
      if(this.sim){if(this.time>=this.sim.duration){this.time=0;this.renderFrame();}this.running=true;this.sync();this.message('');return;}
      const version=this.version;await this.prepare();
      if(!this.active||token!==this.runToken||version!==this.version||!this.sim)return;
      this.time=0;this.running=true;this.renderFrame();this.sync();this.message('');
    }
  }
  resize(){if(this.active){this.studio?.resize();if(!this.manualCamera)this.fit();else this.studio?.render();}}
  destroy(){
    this.active=false;this.running=false;this.runToken++;cancelAnimationFrame(this.raf);this.resizeObserver?.disconnect();
    // Keep the single studio parked between artifact mounts; its resize listener
    // belongs to the page. Reusing it avoids accumulating WebGL contexts.

  }
  configureStudio(){
    // Assemblies have no implicit ground plane: only authored parts provide support.
    if(this.studio.floor){this.studio.floor.visible=false;this.studio.scene.remove(this.studio.floor);}
    this.studio.renderer.shadowMap.enabled=false;
    if(this.studio.lights?.key)this.studio.lights.key.castShadow=false;
  }
  syncPlayback(){
    const planar=this.doc.mode==='planar',seek=this.host.querySelector('.sl-seek');
    this.host.querySelector('.sl-playback').hidden=!planar;
    this.host.querySelector('.sl-mode').hidden=planar;
    this.host.querySelector('[data-sl=run]').hidden=!planar;
    this.host.querySelector('[data-sl=reset]').hidden=!planar;
    seek.disabled=!planar||!this.sim;seek.max=String(this.sim?.duration||this.doc.duration||5);seek.value=String(this.time);
    seek.setAttribute?.('aria-valuetext',`${this.time.toFixed(2)} of ${seek.max} seconds`);
    this.host.querySelector('.sl-time').textContent=this.time.toFixed(2)+' s';
    this.host.querySelector('.sl-speed').value=String(this.speed);
  }
  setSpeed(speed){if(this.doc.mode!=='planar'||![.25,.5,1,2].includes(speed))return;this.speed=speed;this.syncPlayback();}
  renderFrame(){
    if(!this.sim)return;
    const f=window.Kinema2D.frameAt(this.sim,this.time);
    for(const [id,m] of this.meshes){const b=f.bodies[id];if(b){m.position.set(b.x,b.y,0);m.rotation.z=b.a;}}
    this.outline?.update();this.drawLinks();this.syncPlayback();
  }
  seek(time){
    if(this.doc.mode!=='planar'||!Number.isFinite(time))return;
    this.runToken++;this.running=false;
    if(!this.sim){this.sync();return;}
    this.time=Math.max(0,Math.min(this.sim.duration,time));this.renderFrame();this.sync();
    this.message('');
  }
  advancePlayback(seconds){
    if(!this.running||!this.sim||this.doc.mode!=='planar'||!Number.isFinite(seconds))return;
    this.time=Math.min(this.sim.duration,this.time+Math.max(0,Math.min(.1,seconds))*this.speed);
    if(this.time>=this.sim.duration){this.running=false;this.message('');}
    this.renderFrame();this.sync();
  }
  rebuild(){
    if(!this.studio)return;for(const m of this.meshes.values()){this.studio.scene.remove(m);m.traverse(n=>{n.geometry?.dispose();if(n.material)(Array.isArray(n.material)?n.material:[n.material]).forEach(x=>x.dispose());});}this.meshes.clear();this.localCorners=new Map();if(this.links){this.studio.scene.remove(this.links);this.links.geometry.dispose();this.links.material.dispose();this.links=null;}
    for(const [index,o] of this.doc.objects.entries()){const art=labArt(o,this.doc.mode,o.fixed?0x777777:[0x87afd9,0xc5ad87,0x7fb8ab,0xc58f9c][index%4]);const m=new THREE.Group();this.localCorners.set(o.id,this.corners(new THREE.Box3().setFromObject(art)));m.add(art);m.position.set(o.x,o.y,o.z);m.rotation.set(...[o.rx,o.ry,o.rz].map(v=>v*Math.PI/180));m.userData.labId=o.id;this.studio.scene.add(m);this.meshes.set(o.id,m);}this.message('');this.fit();this.drawLinks();this.studio.render();
  }
  drawLinks(){if(!this.studio)return;const points=[];const at=(id,key)=>{const o=this.doc.objects.find(o=>o.id===id),m=this.meshes.get(id);if(!o||!m)return new THREE.Vector3();const p={center:[0,0],top:[0,o.h/2],bottom:[0,-o.h/2],left:[-o.w/2,0],right:[o.w/2,0]}[key];return m.localToWorld(new THREE.Vector3(...p,0));};for(const j of this.doc.joints){const b=at(j.b,j.anchorB),a=j.a==='world'?b.clone().add(new THREE.Vector3(0,.12,0)):at(j.a,j.anchorA);points.push(a,b);}if(this.links){this.studio.scene.remove(this.links);this.links.geometry.dispose();this.links.material.dispose();}this.links=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xd1b485}));this.studio.scene.add(this.links);}
  bounds(){const b=new THREE.Box3();for(const m of this.meshes.values())b.expandByObject(m);if(b.isEmpty())b.setFromCenterAndSize(new THREE.Vector3(0,1,0),new THREE.Vector3(4,3,2));return b;}
  corners(b){const points=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])points.push(new THREE.Vector3(x,y,z));return points;}
  computeMotionBounds(){
    const bounds=this.bounds();
    // Every solver pose, with the actual scaled art bounds transformed about the
    // same origin as renderFrame. No guessed pendulum arc or visual-only motion.
    for(const frame of this.sim.frames||[])for(const [id,points] of this.localCorners||[]){
      const pose=frame.bodies[id];if(!pose)continue;
      const c=Math.cos(pose.a),s=Math.sin(pose.a);
      for(const p of points)bounds.expandByPoint(new THREE.Vector3(pose.x+c*p.x-s*p.y,pose.y+s*p.x+c*p.y,p.z));
    }
    this.motionBounds=bounds;
  }
  framePoints(){return this.corners(this.motionBounds||this.bounds());}
  fit(){
    if(!this.studio)return;const canvas=this.host.querySelector('.sl-canvas');
    if(!(canvas.clientWidth>0&&canvas.clientHeight>0))return;
    this.studio.resize();const b=this.motionBounds||this.bounds(),c=b.getCenter(new THREE.Vector3()),size=Math.max(...b.getSize(new THREE.Vector3()).toArray(),2);
    const width=canvas.clientWidth,height=canvas.clientHeight,back=new THREE.Vector3(...(this.doc?.mode==='planar'?[0,0,1]:[.4,.25,2])).normalize();
    this.studio.frame(c,size,false);this.studio.moveCamera(c.clone().addScaledVector(back,size*2),c,0);
    const distance=framingDistance(this.studio.camera,c,this.framePoints(),width,height)*1.12;
    this.studio.moveCamera(c.clone().addScaledVector(back,distance),c,0);
    // moveCamera(0) copies eye/target but OrbitControls synchronizes orientation
    // on update. Do that now, before any projected bounds or the next gesture.
    this.studio.controls?.update();this.studio.camera.updateMatrixWorld();
    this.manualCamera=false;this.studio.render();
  }
  animate(){cancelAnimationFrame(this.raf);let last=performance.now();const tick=now=>{if(!this.active)return;this.advancePlayback((now-last)/1000);last=now;this.studio?.render(now);this.raf=requestAnimationFrame(tick);};this.raf=requestAnimationFrame(tick);}

}
