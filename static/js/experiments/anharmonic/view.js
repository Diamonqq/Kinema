import {model} from './model.js';
import {niceTicks,tickLabel} from '../kit/format.js';
import {easeCamera} from '../kit/stage.js';
import {C,fmt,tex,texU,pane,wrapTex,withUnit,label,tip,bead,chipBox,drawAnalysis,linePlot} from '../motion-generator/view-tools.js';
const graphs=[
 {id:'motion',label:'Displacement',unit:'m',series:[{key:'x',label:'x',color:C.blue}]},
 {id:'phase',label:'Phase space',kind:'custom',series:[{key:'x',label:'x'},{key:'v',label:'v'}]},
 {id:'energy',label:'Energy',unit:'J',series:[{key:'energy',label:'E',color:C.green},{key:'kinetic',label:'K',color:C.blue},{key:'potential',label:'U',color:C.gold}]},
 {id:'balance',label:'Work & reservoir',unit:'J',series:[{key:'work',label:'W',color:C.violet},{key:'heat',label:'Q',color:C.gold}]},
 {id:'period',label:'Period vs energy',kind:'custom'},{id:'strobe',label:'Poincar\u00e9 section',kind:'custom'},{id:'return',label:'Velocity return',kind:'custom'},{id:'spectrum',label:'Spectrum',kind:'custom'},
];
graphs.forEach(g=>{if(!g.kind)g.window=5*model.create({}).periodForEnergy(model.create({}).sample().energy);});
const descriptorCache=new WeakMap();
const closeups=[{id:'force',label:'Zoom \u00b7 restoring force'}];
export function wellBounds(f){
 const p=f.params,E=f.instance.potential(p.x0)+p.mass*p.v0*p.v0/2;
 let roots=[];try{roots=f.instance.turningPoints(E,p.x0).filter(Number.isFinite);}catch{}
 let radius=Math.max(.8,Math.abs(p.x0),...roots.map(Math.abs));
 if(p.drive||p.potential==='van-der-pol')radius=Math.max(radius,3*p.limitScale,3);
 if(p.potential==='morse')return [Math.min(p.equilibrium-.7/p.width,...roots),Math.max(p.equilibrium+1/p.width,...roots,p.x0)+.3];
 if(p.potential==='lennard-jones')return [Math.max(.1*p.sigma,Math.min(.9*p.sigma,...roots)*.95),Math.max(1.8*p.sigma,...roots,p.x0)*1.05];
 return [-radius*1.2,radius*1.2];
}
function apparatus(s,f,{top,bottom,zoom=false}){
 const p=f.params,q=f.sample,range=wellBounds(f),left=p.potential==='lennard-jones'?0:range[0],right=range[1],walls=p.potential.startsWith('walls'),molecular=['morse','lennard-jones'].includes(p.potential),d=walls?p.halfSeparation:.45;
 const targetScale=Math.min((s.w-65)/(right-left),(bottom-top)/(walls?2*d+.4:.22)),target={cx:(left+right)/2,cy:((top+bottom)/2-s.h/2)/targetScale,scale:targetScale};
 if(!s.camera||s.snap)s.camera=target;else if(easeCamera(s.camera,target))s.animating=true;
 s.snap=false;const scale=s.camera.scale,cx=s.w/2-s.camera.cx*scale,cy=s.h/2+s.camera.cy*scale,xx=x=>cx+x*scale,yy=y=>cy-y*scale,px=xx(q.x);
 // Chip just under the apparatus (under the lower wall plate for the two-wall setups): fixed beside its target.
 const chipH=s.w<=440?24:32;s.zoomAnchor={x:xx(molecular?p.equilibrium:walls?0:left/2),y:Math.min(s.h-100,(walls?yy(-d)+16:cy+22))};s.chipTarget={x:s.zoomAnchor.x,y:walls?yy(-d):cy+13};s.avoid=[...(!f.closeup?[chipBox(s,closeups[0].label,s.zoomAnchor)]:[]),{x:0,y:s.h-72,width:s.w,height:36}];
 s.line(26,cy+13,s.w-26,cy+13,C.grid,1);
 if(walls){
  s.line(xx(0)-13,yy(d),xx(0)+13,yy(d),C.dim,3);s.line(xx(0)-13,yy(-d),xx(0)+13,yy(-d),C.dim,3);
  s.spring(xx(0),yy(d),px,cy,C.dim,5);s.spring(xx(0),yy(-d),px,cy,C.dim,5);
  if(zoom||f.breakdown){label(s,'d = '+fmt(d)+' m',20,top+7,C.gold,11,'left');label(s,'length '+fmt(Math.hypot(q.x,d))+' m',s.w/2,bottom-3,C.dim,11);}
 }else if(molecular){const anchor=p.potential==='morse'?left:0;bead(s,xx(anchor),cy,zoom?18:10,C.dim);s.ctx.setLineDash([3,5]);s.line(xx(anchor),cy,px,cy,C.dim,1);s.ctx.setLineDash([]);}
 else {s.line(xx(left),cy-17,xx(left),cy+17,C.dim,3);s.spring(xx(left),cy,px-(zoom?20:10),cy,C.dim,zoom?12:6);}
 bead(s,px,cy,zoom?22:11);
 if(zoom||f.breakdown){const F=q.force,tipx=px+Math.sign(F)*Math.min(zoom?90:55,s.w*.23),fy=cy-(zoom?32:17);if(Math.abs(F)>1e-9){s.arrow(px,fy,tipx,fy,C.gold,2.3);tip(s,'\u2212dU/dx',tipx,fy,C.gold);} }
 return {scale,cx,cy,chipBottom:s.zoomAnchor.y+chipH};
}
function potentialPlot(s,f,off=0,plotH=0){
 const [xmin,xmax]=wellBounds(f),a=50,b=s.w-26,top=40+off,bottom=plotH?top+plotH:Math.min(145,s.h*.37),U=f.instance.potential,E=f.sample.energy;
 const data=Array.from({length:161},(_,i)=>{const x=xmin+(xmax-xmin)*i/160;return {x,U:U(x)};}),min=Math.min(...data.map(p=>p.U),E),max=Math.min(Math.max(...data.map(p=>p.U),E),E+Math.max(1,Math.abs(E-min))*.8),range=Math.max(.1,max-min),xx=x=>a+(b-a)*(x-xmin)/(xmax-xmin),yy=u=>bottom-(bottom-top)*(u-min)/range;
 label(s,'U(x) / J',a,20+off,C.dim,11,'left');label(s,'E = '+fmt(E)+' J',b,20+off,C.ink,11,'right');
 // Two or three round energy ticks with the unit, faint gridlines across the plot.
 const ut=niceTicks(min,max,Math.max(2,Math.min(3,Math.floor((bottom-top)/45))));for(const v of ut.ticks){const y=yy(v);if(y<top+6||y>bottom-4)continue;s.line(a,y,b,y,'rgba(160,180,210,0.10)',1);label(s,tickLabel(v,ut.step)+' J',a-5,y,C.dim,9,'right');}
 s.line(a,top,a,bottom,C.grid,1);s.line(a,bottom,b,bottom,C.grid,1);
 const c=s.ctx;c.save();c.beginPath();c.rect(a,top,b-a,bottom-top);c.clip();c.beginPath();data.forEach((p,i)=>i?c.lineTo(xx(p.x),yy(p.U)):c.moveTo(xx(p.x),yy(p.U)));c.strokeStyle=C.gold;c.lineWidth=2;c.stroke();
 c.setLineDash([5,4]);s.line(a,yy(E),b,yy(E),C.ink,1.4);c.setLineDash([]);s.circle(xx(f.sample.x),yy(f.sample.potential),4,C.blue);c.restore();
 let turns=[];try{turns=f.instance.turningPoints();}catch{}
 turns.forEach((x,i)=>{if(!Number.isFinite(x))return;const lower=turns.length>1?i===0:x<(xmin+xmax)/2;const px=xx(x);s.line(px,Math.min(bottom,Math.max(top,yy(E)))-4,px,Math.min(bottom,Math.max(top,yy(E)))+4,C.green,2);label(s,(lower?'x₋ = ':'x₊ = ')+withUnit(x,'m'),px,bottom+13,C.green,10);});
 label(s,'x / m',b,bottom+13,C.dim,10,'right');return bottom;
}
export const view={graphs,closeups,
 key:f=>f.closeup?'Restoring force = negative potential slope':'Gold: U(x) \u00b7 dashed: E \u00b7 blue: position',
 closeupAnchors:s=>({force:s.zoomAnchor||{x:s.w/2,y:40}}),
 graphDescriptors(p){if(descriptorCache.has(p))return descriptorCache.get(p);let T=2*Math.PI/Math.sqrt(Math.max(.1,Math.abs(p.k))/p.mass);try{const i=model.create({...p,drive:0,damping:0}),period=i.periodForEnergy(i.sample().energy);if(Number.isFinite(period))T=period;}catch{}if(p.drive)T=2*Math.PI/p.driveOmega;const window=Math.min(60,Math.max(.2,5*T)),descriptors=graphs.map(g=>({...g,...(!g.kind?{window}:{})}));descriptorCache.set(p,descriptors);return descriptors;},
 draw(s,f){let readoutY=s.h-55;if(!f.thumbnail)pane.width=s.w;if(!f.thumbnail&&s.canvas?.parentElement){const style=s.canvas.parentElement.style,narrow=s.w<400;style.flex=narrow?'0 0 360px':'';style.minHeight=narrow?'360px':'';style.maxHeight=narrow?'360px':'';}if(f.thumbnail){const [lo,hi]=wellBounds(f),U=f.instance.potential,points=Array.from({length:61},(_,i)=>({x:lo+(hi-lo)*i/60,u:U(lo+(hi-lo)*i/60)})),floor=Math.min(...points.map(p=>p.u)),ceiling=Math.max(floor+.1,Math.min(...points.filter(p=>p.x===lo||p.x===hi).map(p=>p.u))),xx=x=>22+(s.w-44)*(x-lo)/(hi-lo),yy=u=>s.h-22-(s.h-42)*Math.min(1,(u-floor)/(ceiling-floor));s.ctx.beginPath();points.forEach((p,i)=>i?s.ctx.lineTo(xx(p.x),yy(p.u)):s.ctx.moveTo(xx(p.x),yy(p.u)));s.ctx.strokeStyle=C.gold;s.ctx.lineWidth=2.5;s.ctx.stroke();bead(s,xx(f.sample.x),yy(f.sample.potential),9);return;}if(f.closeup){apparatus(s,f,{top:s.w<=440?72:65,bottom:s.h-120,zoom:true});label(s,f.params.potential.startsWith('walls')?'Two springs \u00b7 actual length and separation':f.params.potential==='morse'||f.params.potential==='lennard-jones'?'Attraction / repulsion along the bond':'One coordinate \u00b7 signed restoring force',s.w/2,s.w<=440?60:44,C.ink,s.w<360?11:13);}
  else {
   // Tall scenes grow the U(x) plot and keep plot, spring, chip and readout together, centered as one group.
   const H=s.h,walls=f.params.potential.startsWith('walls'),plotH=Math.max(Math.min(145,H*.37)-40,Math.min(250,(H-340)*.55+85)),room=H-124-(40+plotH+28),band=Math.max(40,Math.min(room,walls?230:90)),group=40+plotH+28+(walls?band+54:band/2+78),off=H>420?Math.max(0,(H-50-group)/2):0;
   const end=potentialPlot(s,f,off,H>420?plotH:0),top=end+28,bottom=H>420?top+band:H-124;const a=apparatus(s,f,{top,bottom});readoutY=H>420?Math.min(H-55,a.chipBottom+18):H-55;
  }
  s.avoid=[];label(s,'x = '+withUnit(f.sample.x,'m')+'   v = '+withUnit(f.sample.v,'m/s'),s.w/2,readoutY,C.blue,11);
 },
 drawGraph(s,d,f){if(d.id==='phase'){linePlot(s,{title:'Phase space',points:f.samples,xkey:'x',ykey:'v',cursor:f.sample,xlabel:'x / m',ylabel:'v / (m/s)',color:C.blue});return;}drawAnalysis(s,d,f,{periodPoint(frame,i){const instance=model.create({...frame.params,drive:0,damping:0}),stable=instance.equilibria().filter(p=>p.stable).sort((a,b)=>Math.abs(a.x-frame.params.x0)-Math.abs(b.x-frame.params.x0)),floor=stable[0]?.energy??0,E=instance.sample().energy,high=Math.max(floor+.5,E*1.5),x=floor+.005+(high-floor)*i/31;return {x,y:instance.periodForEnergy(x)};}});},
 equations(f){const p=f.params,q=f.sample;let laws;
  if(p.potential==='walls-series')laws=[String.raw`F_x=-k_2x-k_4x^3`,String.raw`k_2=2k(1-\ell_0/d)`,String.raw`k_4=k\ell_0/d^3`];
  else if(p.potential==='walls')laws=[String.raw`\ell=\sqrt{x^2+d^2}`,String.raw`F_x=-2kx(1-\ell_0/\ell)`,...wrapTex([String.raw`=-2(${texU(p.k,'N/m')})(${texU(q.x,'m')})`,String.raw`\times\left(1-\frac{${texU(p.restLength,'m')}}{${texU(Math.hypot(q.x,p.halfSeparation),'m')}}\right)`])];
  else if(p.potential==='morse')laws=[String.raw`U=D(1-e^{-a_M(x-r_e)})^2`];
  else if(p.potential==='lennard-jones')laws=[String.raw`U=4\epsilon(s^{12}-s^6)`,String.raw`s=\sigma/x`];
  else {const terms=[...(p.k?[String.raw`-kx`]:[]),...(p.cubic?[String.raw`-\alpha x^2`]:[]),...(p.quartic?[String.raw`-\beta x^3`]:[])],values=[...(p.k?[String.raw`-(${texU(p.k,'N/m')})(${texU(q.x,'m')})`]:[]),...(p.cubic?[String.raw`-(${texU(p.cubic,'N/m^2')})(${texU(q.x,'m')})^2`]:[]),...(p.quartic?[String.raw`-(${texU(p.quartic,'N/m^3')})(${texU(q.x,'m')})^3`]:[])];laws=['F_x='+terms.join(''),...wrapTex(['='+values[0],...values.slice(1)]),String.raw`=${tex(q.force)}\,\mathrm N`];}
  const active=p.potential==='van-der-pol'&&p.active,drive=p.drive*Math.cos(p.driveOmega*f.t+p.drivePhase),reservoir=active?p.active*(p.limitScale**2-q.x*q.x)*q.v:0;
  const lines=[...laws,String.raw`F_x=-\frac{dU}{dx}=${tex(q.force)}\,\mathrm N`];
  if(p.damping)lines.push(String.raw`F_b=-b\dot x`,String.raw`=-(${texU(p.damping,'kg/s')})(${texU(q.v,'m/s')})`,String.raw`=${tex(-p.damping*q.v)}\,\mathrm N`);
  if(p.drive)lines.push(String.raw`F_d=F_0\cos(\Omega t+\phi)`,String.raw`=${texU(p.drive,'N')}\cos(${texU(p.driveOmega*f.t+p.drivePhase,'rad')})`,String.raw`=${tex(drive)}\,\mathrm N`);
  if(active)lines.push(String.raw`F_{\rm reservoir}=\mu(A^2-x^2)\dot x`,...wrapTex([String.raw`=(${texU(p.active,'kg/(m^2\,s)')})`,String.raw`\times\left((${texU(p.limitScale,'m')})^2-(${texU(q.x,'m')})^2\right)`,String.raw`\times(${texU(q.v,'m/s')})`]),String.raw`=${tex(reservoir)}\,\mathrm N`);
  lines.push(String.raw`m\ddot x=F_x`+(p.damping?String.raw`-b\dot x`:'')+(p.drive?String.raw`+F_d`:'')+(active?String.raw`+F_{\rm reservoir}`:''),String.raw`=(${texU(p.mass,'kg')})(${texU(q.acceleration,'m/s^2')})`,String.raw`=${tex(p.mass*q.acceleration)}\,\mathrm N`,String.raw`E=\frac12 m v^2+U=${tex(q.energy)}\,\mathrm J`);return lines;
 },
 closeupEquation(f){const p=f.params,q=f.sample;if(p.potential==='walls-series'){const c=f.instance.wallApproximation(q.x).coefficients;return [String.raw`F_x=-k_2x-k_4x^3`,String.raw`k_2=${tex(c.quadratic)},\quad k_4=${tex(c.quartic)}`,String.raw`F_x=${tex(q.force)}\,\mathrm N`];}if(p.potential==='walls')return [String.raw`\ell=\sqrt{x^2+d^2}=${tex(Math.hypot(q.x,p.halfSeparation))}\,\mathrm m`,String.raw`T=k(\ell-\ell_0)`,String.raw`=(${texU(p.k,'N/m')})(${texU(Math.hypot(q.x,p.halfSeparation)-p.restLength,'m')})`,String.raw`=${tex(p.k*(Math.hypot(q.x,p.halfSeparation)-p.restLength))}\,\mathrm N`,String.raw`F_x=-2T\frac{x}{\ell}=${tex(q.force)}\,\mathrm N`];return [String.raw`F_x=-\frac{dU}{dx}`,String.raw`x=${tex(q.x)}\,\mathrm m`,String.raw`F_x=${tex(q.force)}\,\mathrm N`];},
};
