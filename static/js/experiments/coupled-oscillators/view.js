import {palette} from '../kit/stage.js';
import {create} from './model.js';
import {label,tex,texU} from '../motion-generator/view-tools.js';
import {num} from '../kit/format.js';
const envelopes=new WeakMap(),drag=new WeakMap(),sub=n=>String(n).replace(/\d/g,d=>'₀₁₂₃₄₅₆₇₈₉'[d]);
const fmt=x=>(Math.abs(x)<.0005?0:x).toFixed(3);
const signed=x=>fmt(x).replace('-','−'),windows=new WeakMap();
const forceValue=value=>(Math.abs(value)<.005?0:value).toFixed(2).replace('-','−');
// First index: receiving mass. Second index: spring; unlike k these are forces.
export function springForces(geometry,index){
 const mass=geometry.masses[index],previous=geometry.masses[index-1]?.displacement||0,next=geometry.masses[index+1]?.displacement||0;
 return [
  {spring:index,value:-geometry.springs[index]*(mass.displacement-previous)},
  {spring:index+1,value:geometry.springs[index+1]*(next-mass.displacement)},
 ].filter(force=>geometry.springs[force.spring]).map(force=>({...force,name:'F'+sub(index+1)+','+sub(force.spring+1),tex:`F_{${index+1},${force.spring+1}}`}));
}
function forceTip(stage,force,x,y){
 const size=stage.w<400?11:12,color='#a8d4b8';stage.ctx.font=`${size}px system-ui,sans-serif`;
 const full=force.name+' '+forceValue(force.value)+' N';
 const choices=stage.w<400?[force.name]:[full,force.name];
 for(const text of choices){
  const width=stage.ctx.measureText(text).width;
  for(const offset of [-11,-28,13]){
   const cx=Math.max(7+width/2,Math.min(stage.w-7-width/2,x)),cy=y+offset;
   const rect={x:cx-width/2-3,y:cy-size*.7,width:width+6,height:size*1.4};
   if(rect.x<3||rect.x+rect.width>stage.w-3||rect.y<3||rect.y+rect.height>stage.h-50)continue;
   if(stage.labels.some(label=>rect.x<label.x+label.width+3&&rect.x+rect.width>label.x-3&&rect.y<label.y+label.height+3&&rect.y+rect.height>label.y-3))continue;
   stage.text(text,cx,cy,color,size);return;
  }
 }
}
export function displacementWindow(params){
 const instance=create(params),sample=instance.sample(),positive=instance.modes.filter(mode=>mode.omega>1e-7);
 const active=instance.modes.map((mode,j)=>{const velocity=mode.shape.reduce((sum,value,i)=>sum+instance.params['m'+(i+1)]*value*sample['v'+(i+1)],0);return {omega:mode.omega,weight:Math.hypot(sample['q'+(j+1)],mode.omega>1e-7?velocity/mode.omega:0)+(instance.params.force?Math.abs(mode.shape[0])*instance.params.force:0)}}).filter(mode=>mode.omega>1e-7&&mode.weight>1e-8).sort((a,b)=>b.weight-a.weight);
 const difference=active.length>=2?Math.abs(active[0].omega-active[1].omega):0;
 return difference>1e-7?2*Math.PI/difference:5*2*Math.PI/(positive[0]?.omega||1);
}
const graphs=[
 {id:'motion',label:'Displacements',unit:'m',series:[{key:'x1',label:'x₁',color:palette[0]},{key:'x2',label:'x₂',color:palette[1]}]},
 {id:'modes',label:'Mode coordinates',unit:'√kg · m',series:[{key:'q1',label:'q₁',color:palette[0]},{key:'q2',label:'q₂',color:palette[1]}]},
 {id:'energy',label:'Energy',unit:'J',series:[{key:'energy',label:'E',color:palette[2]},{key:'kinetic',label:'K',color:palette[0]},{key:'potential',label:'U',color:palette[1]}]},
 {id:'phase',label:'Phase space',unit:'m, m/s',kind:'phase',series:[{key:'x1',label:'x₁'},{key:'v1',label:'v₁'}]},
];
function setup(stage,f){
 const n=f.params.n,length=f.geometry.length;
 // Fixed camera envelope includes every computed displacement over the playback.
 let extent=envelopes.get(f.instance);if(extent===undefined){extent=f.instance.motionExtent(60);envelopes.set(f.instance,extent);}
 const zoom=f.closeup==='spring',a=f.geometry.masses[0],b=f.geometry.masses[1];
 const bounds=zoom?[.85,3.05,-.67,.67]:[-extent,length+extent,-1.15,1.15];
 const map=stage.world(bounds,zoom?24:Math.min(36,stage.w*.08));
 return {map,n,length,zoom,a,b};
}
function block(s,x,y,width,height,color){const c=s.ctx;c.fillStyle=color+'19';c.strokeStyle=color;c.lineWidth=1.8;c.beginPath();c.roundRect(x-width/2,y-height/2,width,height,Math.min(9,width*.16));c.fill();c.stroke();s.line(x-width*.32,y-height*.33,x+width*.32,y-height*.33,color+'70',1);}
function wall(s,x,y,h){s.line(x,y-h,x,y+h,'#738294',3);for(let dy=-h;dy<h;dy+=10)s.line(x-8,y+dy+7,x,y+dy,'#44505f',1);}
export const view={
 graphs,graphDescriptors(p){let window=windows.get(p);if(window===undefined){window=displacementWindow(p);windows.set(p,window);}return graphs.map(g=>['motion','modes'].includes(g.id)?{...g,window,series:Array.from({length:p.n},(_,i)=>({key:(g.id==='motion'?'x':'q')+(i+1),label:(g.id==='motion'?'x':'q')+sub(i+1),color:palette[i%palette.length]}))}:g);},
 closeupAnchors(s,f){const {map}=setup(s,f),massH=Math.max(13,Math.min(76,.48*map.scale))*.8;return {spring:{x:map.x(1.95),y:map.y(0)+massH*.9+54}};},
 closeups:[{id:'spring',label:'Zoom · middle spring'}],
 key:f=>f.closeup?'F₂,₂ is the force of spring 2 on m₂':f.breakdown?'':`${f.params.n} masses · drag a mass to change its release point`,
 draw(s,f){
  const {ctx,w,h}=s,{map,n,length,zoom,a,b}=setup(s,f),{x,y,scale}=map,cy=y(0),massW=Math.max(13,Math.min(76,.48*scale)),massH=massW*.8;
  s.line(x(-.05),cy+massH*.58,x(length+.05),cy+massH*.58,'#2c3744',1);
  if(zoom){
   // Actual geometry enlarged, centered in the pane. Each caption sits beside its own block; the force label sits at its arrow tip.
   const mw=Math.min(150,.5*scale),mh=mw*.9,fs=w<400?12:14,cz=cy-9,barY=cz+mh/2+44;
   s.line(x(a.equilibrium),barY,x(b.equilibrium),barY,'#516071',1);
   s.text('equilibrium spacing',w/2,barY+18,'#8292a7',fs-1);
   s.spring(x(a.x)+mw/2,cz,x(b.x)-mw/2,cz,'#a1c4f4',Math.min(22,scale*.1));
   block(s,x(a.x),cz,mw,mh,palette[0]);block(s,x(b.x),cz,mw,mh,palette[1]);
   s.zoomParts={blocks:[{x:x(a.x)-mw/2,y:cz-mh/2,width:mw,height:mh},{x:x(b.x)-mw/2,y:cz-mh/2,width:mw,height:mh}]};
   label(s,'m₁',x(a.x),cz+mh/2+17,palette[0],fs);label(s,'m₂',x(b.x),cz+mh/2+17,palette[1],fs);
   const force=-f.params.k2*(b.displacement-a.displacement),anchor=x(b.x),fy=cz-mh/2-26,dir=Math.sign(force),end=Math.max(14,Math.min(w-14,anchor+dir*Math.min(w*.18,25+Math.abs(force)*18)));
   if(Math.abs(force)>.002){s.arrow(anchor,fy,end,fy,'#b8d6a5',2.5);s.zoomParts.tip={x:end,y:fy};const text='F₂,₂ = '+num(force,3)+' N';ctx.font=fs+'px system-ui,sans-serif';const half=ctx.measureText(text).width/2;label(s,text,Math.max(half+8,Math.min(w-half-8,end)),fy-16,'#b8d6a5',fs);}
   return;
  }
  if(f.geometry.springs[0])wall(s,x(0),cy,massH*.9);
  if(f.geometry.springs[n])wall(s,x(length),cy,massH*.9);
  for(let j=0;j<=n;j++){
   if(!f.geometry.springs[j])continue;
   const start=j?x(f.geometry.masses[j-1].x)+massW/2:x(0),end=j<n?x(f.geometry.masses[j].x)-massW/2:x(length);
   s.spring(start,cy,end,cy,j===1?'#a0b3cc':'#718297',Math.max(4,Math.min(9,scale*.07)));
   const eq=1.3*(j+.5),labelY=Math.max(44,cy-(f.breakdown?115:massH*.5+41)),k=f.params['k'+(j+1)];
   if(scale*1.3>115)s.text('k'+sub(j+1)+' = '+k+' N/m',x(eq),labelY,'#93a5bd',12);
   else {s.text('k'+sub(j+1),x(eq),labelY,'#93a5bd',n>4?10:11);if(n<=4)s.text(k+' N/m',x(eq),labelY+15,'#93a5bd',10);}
  }
  const forceLabels=[];f.geometry.masses.forEach((m,i)=>{
   const px=x(m.x),ex=x(m.equilibrium),color=palette[i%palette.length];
   ctx.setLineDash([3,5]);s.line(ex,cy-massH*.8,ex,cy+massH*1.1,'#37485d',1);ctx.setLineDash([]);
   block(s,px,cy,massW,massH,color);
   // Stationary captions stay in the equilibrium column, never chase a body.
   s.text('m'+sub(i+1)+(scale*1.3>85?' · '+m.mass+' kg':''),ex,cy+massH*.9+17,color,n>4?10:12);
   if(scale*1.3>85)s.text('x'+sub(i+1)+' '+signed(m.displacement)+' m',ex,cy+massH*.9+36,'#97a6bb',n>4?10:11);
   if(f.breakdown){
    for(const force of springForces(f.geometry,i)){const fy=cy-massH*.8-(force.spring-i)*22,F=force.value;if(Math.abs(F)>.002){const tip=Math.max(9,Math.min(w-9,px+Math.sign(F)*Math.min(scale*.58,Math.abs(F)*14+12)));s.arrow(px,fy,tip,fy,'#a8d4b8',2);forceLabels.push({force,x:tip,y:fy});}}
   }
  });
  // Place after every apparatus label so later masses cannot collide with a tip.
  for(const item of forceLabels)forceTip(s,item.force,item.x,item.y);
  if(f.breakdown)label(s,'F_{i,j} = force of spring j on mass i',w/2,h-50,'#93a5bd',13);

 },
 equations(f){const p=f.params,g=f.geometry;return g.masses.map((m,i)=>{
  const j=i+1,left=i?`x_{${j-1}}`:'0',right=i+1<p.n?`x_{${j+1}}`:'0';
  const forces=springForces(g,i),sum=forces.map(force=>force.tex).join('+')||'0',extra=(p.gamma?`-\\gamma m_{${j}}\\dot x_{${j}}`:'')+(i===0&&p.force?'+F_0\\cos(\\Omega t)':'');
  const definitions=forces.map(force=>force.tex+'='+(force.spring===i?(i?`-k_{${i+1}}(x_{${j}}-${left})`:'-k_1x_1'):(i+1<p.n?`k_{${i+2}}(${right}-x_{${j}})`:`-k_{${i+2}}x_{${j}}`))+`=${forceValue(force.value).replace('−','-')}\\,\\mathrm{N}`);
  return `\\begin{gathered}m_{${j}}\\ddot x_{${j}}=${sum}${extra}\\\\${definitions.join('\\\\')}\\\\(${m.mass}\\,\\mathrm{kg})\\ddot x_{${j}}=${g.forces[i].toFixed(2)}\\,\\mathrm{N}\\end{gathered}`;
 });},
 closeupEquation(f){const a=f.geometry.masses[0],b=f.geometry.masses[1],delta=b.displacement-a.displacement,F=-f.params.k2*delta;return ['F_{2,2}=-k_2(x_2-x_1)',`=-(${texU(f.params.k2,'N/m')})(${texU(delta,'m')})`,`=${tex(F)}\\,\\mathrm{N}`];},
 pointer(s,f,p){
  if(f.closeup)return false;const {map}=setup(s,f),cy=map.y(0),mw=Math.min(76,.48*map.scale);
  if(p.type==='down'){const i=f.geometry.masses.findIndex(m=>Math.abs(p.x-map.x(m.x))<mw*.7&&Math.abs(p.y-cy)<mw*.7);if(i<0)return false;drag.set(s,{i,start:p.x,x:f.geometry.masses[i].displacement});const initial={modeA:0,modeB:0};f.geometry.masses.forEach((m,j)=>{initial['x'+(j+1)]=Math.round(Math.max(-.3,Math.min(.3,m.displacement))*100)/100;initial['v'+(j+1)]=0});f.setParams(initial);return true;}
  const state=drag.get(s);if(!state)return false;
  if(p.type==='move'){const x=state.x+(p.x-state.start)/map.scale;f.setParams({['x'+(state.i+1)]:Math.round(Math.max(-.3,Math.min(.3,x))*100)/100});return true;}
  if(p.type==='up'||p.type==='cancel'){drag.delete(s);return true;}return false;
 },
};
