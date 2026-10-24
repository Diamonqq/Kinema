import {palette} from '../kit/stage.js';
const envelopes=new WeakMap(),drag=new WeakMap(),sub=n=>String(n).replace(/\d/g,d=>'₀₁₂₃₄₅₆₇₈₉'[d]);
const fmt=x=>(Math.abs(x)<.0005?0:x).toFixed(3);
const graphs=[
 {id:'motion',label:'Displacements',unit:'m',series:[{key:'x1',label:'x₁',color:palette[0]},{key:'x2',label:'x₂',color:palette[1]}]},
 {id:'modes',label:'Mode amplitudes',unit:'√kg m',series:[{key:'q1',label:'q₁',color:palette[0]},{key:'q2',label:'q₂',color:palette[1]}]},
 {id:'energy',label:'Energy',unit:'J',series:[{key:'energy',label:'Total',color:palette[2]},{key:'kinetic',label:'Kinetic',color:palette[0]},{key:'potential',label:'Spring',color:palette[1]}]},
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
 graphs,graphDescriptors:p=>graphs.map(g=>['motion','modes'].includes(g.id)?{...g,series:Array.from({length:p.n},(_,i)=>({key:(g.id==='motion'?'x':'q')+(i+1),label:(g.id==='motion'?'x':'q')+sub(i+1),color:palette[i]}))}:g),
 closeupAnchors(s,f){const {map}=setup(s,f),massH=Math.max(13,Math.min(76,.48*map.scale))*.8;return {spring:{x:map.x(1.95),y:map.y(0)+massH*.9+54}};},
 closeups:[{id:'spring',label:'Zoom · middle spring'}],
 key:f=>f.closeup?'Middle spring · force on mass 2':`${f.params.n} masses · drag a mass to change its release point`,
 draw(s,f){
  const {ctx,w,h}=s,{map,n,length,zoom,a,b}=setup(s,f),{x,y,scale}=map,cy=y(0),massW=Math.max(13,Math.min(76,.48*scale)),massH=massW*.8;
  s.line(x(-.05),cy+massH*.58,x(length+.05),cy+massH*.58,'#2c3744',1);
  if(zoom){
   // Actual geometry enlarged; fixed captions, magnified spring and moving ends.
   const mw=Math.min(120,.48*scale),mh=mw*.8;
   s.line(x(a.equilibrium),cy+mh*.7,x(b.equilibrium),cy+mh*.7,'#516071',1);
   s.text('equilibrium spacing',w/2,cy+mh*.7+18,'#8292a7',12);
   s.spring(x(a.x)+mw/2,cy,x(b.x)-mw/2,cy,'#a1c4f4',Math.min(18,scale*.08));
   block(s,x(a.x),cy,mw,mh,palette[0]);block(s,x(b.x),cy,mw,mh,palette[1]);
   s.text('mass 1',Math.max(36,x(1.3)),h-35,palette[0],13);s.text('mass 2',Math.min(w-36,x(2.6)),h-35,palette[1],13);
   const force=-f.params.k2*(b.displacement-a.displacement),anchor=x(b.x),fy=cy,dir=Math.sign(force),end=Math.max(14,Math.min(w-14,anchor+dir*Math.min(w*.18,25+Math.abs(force)*18)));
   if(Math.abs(force)>.002)s.arrow(anchor,fy,end,fy,'#b8d6a5',2.5);
   s.text('force on mass 2',w/2,Math.max(46,cy-mh/2-35),'#b8d6a5',12);
   return;
  }
  if(f.geometry.springs[0])wall(s,x(0),cy,massH*.9);
  if(f.geometry.springs[n])wall(s,x(length),cy,massH*.9);
  for(let j=0;j<=n;j++){
   if(!f.geometry.springs[j])continue;
   const start=j?x(f.geometry.masses[j-1].x)+massW/2:x(0),end=j<n?x(f.geometry.masses[j].x)-massW/2:x(length);
   s.spring(start,cy,end,cy,j===1?'#a0b3cc':'#718297',Math.max(4,Math.min(9,scale*.07)));
   const eq=1.3*(j+.5);s.text('k'+sub(j+1)+(scale*1.3>85?' = '+f.params['k'+(j+1)]:'' ),x(eq),Math.max(44,cy-(f.breakdown?115:massH*.5+29)),'#93a5bd',n>4?10:12);
  }
  f.geometry.masses.forEach((m,i)=>{
   const px=x(m.x),ex=x(m.equilibrium),color=palette[i%palette.length];
   ctx.setLineDash([3,5]);s.line(ex,cy-massH*.8,ex,cy+massH*1.1,'#37485d',1);ctx.setLineDash([]);
   block(s,px,cy,massW,massH,color);
   // Stationary captions stay in the equilibrium column, never chase a body.
   s.text('m'+sub(i+1)+(scale*1.3>85?' · '+m.mass+' kg':''),ex,cy+massH*.9+17,color,n>4?10:12);
   if(scale*1.3>85)s.text('x'+sub(i+1)+' '+fmt(m.displacement)+' m',ex,cy+massH*.9+36,'#97a6bb',n>4?9:11);
   if(f.breakdown){const left=-f.geometry.springs[i]*(m.displacement-(f.geometry.masses[i-1]?.displacement||0)),right=f.geometry.springs[i+1]*((f.geometry.masses[i+1]?.displacement||0)-m.displacement);
    for(const [j,F] of [left,right].entries()){const fy=cy-massH*.8-j*22;if(Math.abs(F)>.002){const color='#a8d4b8',tip=px+Math.sign(F)*Math.min(scale*.58,Math.abs(F)*14+12);s.arrow(px,fy,tip,fy,color,2);s.text('k'+sub(i+j+1),tip,fy-11,color,11);}}
   }
  });

 },
 equations(f){const p=f.params,g=f.geometry;return g.masses.map((m,i)=>{
  const j=i+1,left=i?`x_{${j-1}}`:'0',right=i+1<p.n?`x_{${j+1}}`:'0',terms=[];
  if(g.springs[i])terms.push(`-${g.springs[i]}(x_{${j}}-${left})`);
  if(g.springs[i+1])terms.push(`+${g.springs[i+1]}(${right}-x_{${j}})`);
  if(p.gamma)terms.push(`-${p.gamma}(${m.mass})\\dot x_{${j}}`);
  if(i===0&&p.force)terms.push(`+${p.force}\\cos(${p.frequency}t)`);
  const symbolic=[];if(g.springs[i])symbolic.push(i?`-k_{${i+1}}(x_{${j}}-${left})`:`-k_1x_1`);if(g.springs[i+1])symbolic.push(i+1<p.n?`+k_{${i+2}}(${right}-x_{${j}})`:`-k_{${i+2}}x_{${j}}`);if(p.gamma)symbolic.push(`-\\gamma m_{${j}}\\dot x_{${j}}`);if(i===0&&p.force)symbolic.push('+F_0\\cos(\\Omega t)');return `\\begin{gathered}m_{${j}}\\ddot x_{${j}}=${symbolic.join('')||'0'}\\\\(${m.mass}\\,\\mathrm{kg})\\ddot x_{${j}}=${terms.join('')||'0'}\\end{gathered}`;
 });},
 closeupEquation(f){const a=f.geometry.masses[0],b=f.geometry.masses[1],delta=b.displacement-a.displacement,F=-f.params.k2*delta;return ['F_{2}=-k_2(x_2-x_1)',`=-${f.params.k2}(${fmt(delta)})=${fmt(F)}\\,\\mathrm{N}`];},
 pointer(s,f,p){
  if(f.closeup)return false;const {map}=setup(s,f),cy=map.y(0),mw=Math.min(76,.48*map.scale);
  if(p.type==='down'){const i=f.geometry.masses.findIndex(m=>Math.abs(p.x-map.x(m.x))<mw*.7&&Math.abs(p.y-cy)<mw*.7);if(i<0)return false;drag.set(s,{i,start:p.x,x:f.geometry.masses[i].displacement});const initial={modeA:0,modeB:0};f.geometry.masses.forEach((m,j)=>{initial['x'+(j+1)]=Math.round(Math.max(-.3,Math.min(.3,m.displacement))*100)/100;initial['v'+(j+1)]=0});f.setParams(initial);return true;}
  const state=drag.get(s);if(!state)return false;
  if(p.type==='move'){const x=state.x+(p.x-state.start)/map.scale;f.setParams({['x'+(state.i+1)]:Math.round(Math.max(-.3,Math.min(.3,x))*100)/100});return true;}
  if(p.type==='up'||p.type==='cancel'){drag.delete(s);return true;}return false;
 },
};
