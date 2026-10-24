import {model} from './model.js';
import {C,fmt,tex,label,tip,bead,drawAnalysis,linePlot} from '../motion-generator/view-tools.js';
const graphs=[
 {id:'motion',label:'Displacement',unit:'m',series:[{key:'x',label:'x',color:C.blue}]},
 {id:'phase',label:'Phase space',unit:'m, m/s',kind:'custom',series:[{key:'x',label:'x'},{key:'v',label:'v'}]},
 {id:'energy',label:'Energy',unit:'J',series:[{key:'energy',label:'E',color:C.green},{key:'kinetic',label:'K',color:C.blue},{key:'potential',label:'U',color:C.gold}]},
 {id:'balance',label:'Work & reservoir',unit:'J',series:[{key:'work',label:'W',color:C.violet},{key:'heat',label:'Q',color:C.gold}]},
 {id:'period',label:'Period vs energy',kind:'custom'},{id:'strobe',label:'Poincare section',kind:'custom'},{id:'return',label:'Velocity return',kind:'custom'},{id:'spectrum',label:'Spectrum',kind:'custom'},
];
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
 if(!s.camera||s.snap)s.camera=target;else for(const k of ['cx','cy','scale'])s.camera[k]+=(target[k]-s.camera[k])*.22;
 s.snap=false;const scale=s.camera.scale,cx=s.w/2-s.camera.cx*scale,cy=s.h/2+s.camera.cy*scale,xx=x=>cx+x*scale,yy=y=>cy-y*scale,px=xx(q.x);
 s.line(26,cy+13,s.w-26,cy+13,C.grid,1);
 if(walls){
  s.line(xx(0)-13,yy(d),xx(0)+13,yy(d),C.dim,3);s.line(xx(0)-13,yy(-d),xx(0)+13,yy(-d),C.dim,3);
  s.spring(xx(0),yy(d),px,cy,C.dim,5);s.spring(xx(0),yy(-d),px,cy,C.dim,5);
  if(zoom||f.breakdown){label(s,'d = '+fmt(d)+' m',20,top+7,C.gold,11,'left');label(s,'length '+fmt(Math.hypot(q.x,d))+' m',s.w/2,bottom-3,C.dim,11);}
 }else if(molecular){const anchor=p.potential==='morse'?left:0;bead(s,xx(anchor),cy,zoom?18:10,C.dim);s.ctx.setLineDash([3,5]);s.line(xx(anchor),cy,px,cy,C.dim,1);s.ctx.setLineDash([]);}
 else {s.line(xx(left),cy-17,xx(left),cy+17,C.dim,3);s.spring(xx(left),cy,px-(zoom?20:10),cy,C.dim,zoom?12:6);}
 bead(s,px,cy,zoom?22:11);
 if(zoom||f.breakdown){const F=q.force,tipx=px+Math.sign(F)*Math.min(zoom?90:55,s.w*.23),fy=cy-(zoom?32:17);if(Math.abs(F)>1e-9){s.arrow(px,fy,tipx,fy,C.gold,2.3);tip(s,'-dU/dx',tipx,fy,C.gold);} }
 return {scale,cx,cy};
}
function potentialPlot(s,f){
 const [xmin,xmax]=wellBounds(f),a=35,b=s.w-26,top=40,bottom=Math.min(145,s.h*.37),U=f.instance.potential,E=f.sample.energy;
 const data=Array.from({length:161},(_,i)=>{const x=xmin+(xmax-xmin)*i/160;return {x,U:U(x)};}),min=Math.min(...data.map(p=>p.U),E),max=Math.min(Math.max(...data.map(p=>p.U),E),E+Math.max(1,Math.abs(E-min))*.8),range=Math.max(.1,max-min),xx=x=>a+(b-a)*(x-xmin)/(xmax-xmin),yy=u=>bottom-(bottom-top)*(u-min)/range;
 label(s,'U(x) / J',a,20,C.dim,11,'left');label(s,'E = '+fmt(E)+' J',b,20,C.green,11,'right');
 s.line(a,top,a,bottom,C.grid,1);s.line(a,bottom,b,bottom,C.grid,1);
 const c=s.ctx;c.save();c.beginPath();c.rect(a,top,b-a,bottom-top);c.clip();c.beginPath();data.forEach((p,i)=>i?c.lineTo(xx(p.x),yy(p.U)):c.moveTo(xx(p.x),yy(p.U)));c.strokeStyle=C.gold;c.lineWidth=2;c.stroke();
 c.setLineDash([5,4]);s.line(a,yy(E),b,yy(E),C.green,1.4);c.setLineDash([]);s.circle(xx(f.sample.x),yy(f.sample.potential),4,C.blue);c.restore();
 let turns=[];try{turns=f.instance.turningPoints();}catch{}
 turns.forEach((x,i)=>{if(!Number.isFinite(x))return;const px=xx(x);s.line(px,Math.min(bottom,Math.max(top,yy(E)))-4,px,Math.min(bottom,Math.max(top,yy(E)))+4,C.green,2);label(s,(i?'x+ ':'x- ')+fmt(x),px,bottom+13,C.green,10);});
 label(s,'x / m',b,bottom+13,C.dim,10,'right');return bottom;
}
export const view={graphs,closeups,
 key:f=>f.closeup?'Restoring force = negative potential slope':'Blue: position \u00b7 gold: potential \u00b7 green: energy',
 closeupAnchors:s=>({force:{x:s.w/2,y:s.h-74}}),
 draw(s,f){if(f.thumbnail){apparatus(s,{...f,breakdown:false},{top:22,bottom:s.h-22});return;}if(f.closeup){apparatus(s,f,{top:65,bottom:s.h-120,zoom:true});label(s,f.params.potential.startsWith('walls')?'Two springs \u00b7 actual length and separation':f.params.potential==='morse'||f.params.potential==='lennard-jones'?'Attraction / repulsion along the bond':'One coordinate \u00b7 signed restoring force',s.w/2,44,C.ink,s.w<360?11:13);}
  else {const end=potentialPlot(s,f);apparatus(s,f,{top:end+28,bottom:s.h-124});}
  label(s,'x '+fmt(f.sample.x)+' m   v '+fmt(f.sample.v)+' m/s',s.w/2,s.h-105,C.blue,11);
 },
 drawGraph(s,d,f){if(d.id==='phase'){linePlot(s,{title:'Phase space',points:f.samples,xkey:'x',ykey:'v',cursor:f.sample,xlabel:'x / m',ylabel:'v / (m/s)',color:C.blue});return;}drawAnalysis(s,d,f,{periodPoint(frame,i){const instance=model.create({...frame.params,drive:0,damping:0}),stable=instance.equilibria().filter(p=>p.stable).sort((a,b)=>Math.abs(a.x-frame.params.x0)-Math.abs(b.x-frame.params.x0)),floor=stable[0]?.energy??0,E=instance.sample().energy,high=Math.max(floor+.5,E*1.5),x=floor+.005+(high-floor)*i/31;return {x,y:instance.periodForEnergy(x)};}});},
 equations(f){const p=f.params,q=f.sample;let laws;
  if(p.potential==='walls-series')laws=[String.raw`F_x=-k_2x-k_4x^3`,String.raw`k_2=2k(1-\ell_0/d)`,String.raw`k_4=k\ell_0/d^3`];
  else if(p.potential==='walls')laws=[String.raw`\ell=\sqrt{x^2+d^2}`,String.raw`F_x=-2kx(1-\ell_0/\ell)`];
  else if(p.potential==='morse')laws=[String.raw`U=D(1-e^{-a(x-r_e)})^2`];
  else if(p.potential==='lennard-jones')laws=[String.raw`U=4\epsilon(s^{12}-s^6)`,String.raw`s=\sigma/x`];
  else laws=[String.raw`F_x=-kx-a x^2-\beta x^3`];
  const active=p.potential==='van-der-pol'?String.raw`F_{\rm reservoir}=\mu(A^2-x^2)\dot x`:String.raw`F_{\rm reservoir}=0`;
  return [...laws,String.raw`F_x=-\frac{dU}{dx}=${tex(q.force)}\,\mathrm N`,String.raw`m\ddot x=F_x-b\dot x+F_{\rm drive}+F_{\rm reservoir}`,String.raw`F_{\rm drive}=F_d\cos(\Omega t+\phi)`,active,String.raw`(${p.mass})(${tex(q.acceleration)})=${tex(p.mass*q.acceleration)}\,\mathrm N`,String.raw`E=\frac12 m v^2+U=${tex(q.energy)}\,\mathrm J`];
 },
 closeupEquation(f){const p=f.params,q=f.sample;if(p.potential==='walls-series'){const c=f.instance.wallApproximation(q.x).coefficients;return [String.raw`F_x=-k_2x-k_4x^3`,String.raw`k_2=${tex(c.quadratic)},\quad k_4=${tex(c.quartic)}`,String.raw`F_x=${tex(q.force)}\,\mathrm N`];}if(p.potential==='walls')return [String.raw`\ell=\sqrt{x^2+d^2}=${tex(Math.hypot(q.x,p.halfSeparation))}\,\mathrm m`,String.raw`T=k(\ell-\ell_0)`,String.raw`F_x=-2T\frac{x}{\ell}=${tex(q.force)}\,\mathrm N`];return [String.raw`F_x=-\frac{dU}{dx}`,String.raw`x=${tex(q.x)}\,\mathrm m`,String.raw`F_x=${tex(q.force)}\,\mathrm N`];},
};
