// View utilities owned by the oscillator lane. SI geometry stays in each core.
import {num,texNum,withUnit} from '../kit/format.js';
import {easeCamera} from '../kit/stage.js';
export {withUnit};
import {spectrum} from '../anharmonic/analysis.js';
export const C={blue:'#8ab9ff',gold:'#e9bb88',green:'#b0c9ad',violet:'#bcabef',dim:'#71839b',ink:'#cbd8e9',grid:'#344355'};
export const fmt=(x,n=3)=>num(x,n);
export const tex=(x,n=3)=>texNum(x,n);
export function label(s,text,x,y,color=C.ink,size=12,align='center'){
 const c=s.ctx,parts=String(text).split(/(_\{[^}]+\})/).filter(Boolean).map(t=>({text:t.startsWith('_{')?t.slice(2,-1):t,sub:t.startsWith('_{')}));
 const widths=parts.map(p=>{c.font=`${size*(p.sub?.72:1)}px system-ui,sans-serif`;return c.measureText(p.text).width;}),width=widths.reduce((a,b)=>a+b,0),left=align==='left'?x:align==='right'?x-width:x-width/2;
 if(left<5||left+width>s.w-5||y<size||y>s.h-44)return false;
 const rect={x:left-3,y:y-size*.65,width:width+6,height:size*1.4};
 if([...(s.labels||[]),...(s.avoid||[])].some(b=>rect.x<b.x+b.width+2&&rect.x+rect.width>b.x-2&&rect.y<b.y+b.height+2&&rect.y+rect.height>b.y-2))return false;
 if(!parts.some(p=>p.sub)){s.text(text,x,y,color,size,align);return true;}
 c.fillStyle=color;c.textAlign='left';c.textBaseline='middle';let cursor=left;
 parts.forEach((p,i)=>{c.font=`${size*(p.sub?.72:1)}px system-ui,sans-serif`;c.fillText(p.text,cursor,y+(p.sub?size*.24:0));cursor+=widths[i];});
 s.labels.push({...rect,text:String(text)});return true;
}
export function tip(s,text,x,y,color){
 for(const [dx,dy] of [[0,-14],[0,15],[30,-14],[-30,15],[0,-29],[-55,-30],[55,-30],[-65,14],[65,14],[0,-50]])if(label(s,text,x+dx,y+dy,color,s.w<360?10:12)){if(Math.abs(dx)>35||Math.abs(dy)>35)s.line(x,y,x+dx,y+dy-5,color+'80',1);return;}
}
export function bead(s,x,y,r,color=C.blue){
 const c=s.ctx,g=c.createRadialGradient(x-r*.3,y-r*.35,1,x,y,r);g.addColorStop(0,'#deebff');g.addColorStop(.25,color);g.addColorStop(1,'#3c628e');s.circle(x,y,r,g);s.circle(x-r*.25,y-r*.3,r*.13,'#ffffff90');
}
export function angle(s,x,y,r,theta,color=C.gold){
 const t=Math.atan2(Math.sin(theta),Math.cos(theta));if(Math.abs(t)<.015)return;
 const a=Math.PI/2,b=a-t;s.ctx.beginPath();s.ctx.strokeStyle=color;s.ctx.lineWidth=1.5;s.ctx.arc(x,y,r,Math.min(a,b),Math.max(a,b));s.ctx.stroke();
 label(s,'\u03b8',x+(r+12)*Math.cos((a+b)/2),y+(r+12)*Math.sin((a+b)/2),color,12);
}
export function fixedMap(s,bounds,{bottom=100,top=35,padding=30}={}){
 // Reserve fixed rows for caption and close-up chip. world() provides eased zoom.
 const available=Math.max(80,s.h-top-bottom),cx=(bounds[0]+bounds[1])/2,cy=(bounds[2]+bounds[3])/2;
 const sc=Math.min((s.w-2*padding)/(bounds[1]-bounds[0]),available/(bounds[3]-bounds[2]));
 const target={cx,cy:cy-(bottom-top)/(2*sc),scale:sc};
 if(!s.camera||s.snap)s.camera=target;else if(easeCamera(s.camera,target))s.animating=true;
 s.snap=false;const c=s.camera;return {x:x=>s.w/2+(x-c.cx)*c.scale,y:y=>s.h/2-(y-c.cy)*c.scale,scale:c.scale};
}
export function linePlot(s,{title,points=[],xkey='x',ykey='y',cursor,color=C.blue,xlabel='',ylabel='',scatter=false,yFloor}){
 s.resize();s.begin();const w=s.w,h=s.h,l=42,r=w-17,t=48,b=h-34;
 if(ylabel)label(s,ylabel,l,33,C.dim,10,'left');
 const data=points.filter(p=>Number.isFinite(p[xkey])&&Number.isFinite(p[ykey]));
 s.line(l,t,l,b,C.grid,1);s.line(l,b,r,b,C.grid,1);
 if(!data.length){s.text('Play to collect samples',(l+r)/2,(t+b)/2,C.dim,11);return;}
 let xmin=Math.min(...data.map(p=>p[xkey])),xmax=Math.max(...data.map(p=>p[xkey])),ymin=Math.min(...data.map(p=>p[ykey])),ymax=Math.max(...data.map(p=>p[ykey]));
 if(xmax-xmin<1e-9){xmin-=.5;xmax+=.5;}if(yFloor!==undefined){ymin=yFloor;ymax=Math.max(ymax,yFloor+1e-9);}else if(ymax-ymin<1e-9){ymin-=.5;ymax+=.5;}
 const dy=(ymax-ymin)*.12;ymin=yFloor??ymin-dy;ymax+=dy;s.plotBounds={xmin,xmax,ymin,ymax,left:l,right:r,top:t,bottom:b};const xx=x=>l+(r-l)*(x-xmin)/(xmax-xmin),yy=y=>b-(b-t)*(y-ymin)/(ymax-ymin);
 const c=s.ctx;c.save();c.beginPath();c.rect(l,t,r-l,b-t);c.clip();
 if(scatter){for(const p of data)s.circle(xx(p[xkey]),yy(p[ykey]),2.6,color);}else{c.beginPath();let pen=false;for(const p of points){if(!Number.isFinite(p[xkey])||!Number.isFinite(p[ykey])){pen=false;continue;}if(pen)c.lineTo(xx(p[xkey]),yy(p[ykey]));else c.moveTo(xx(p[xkey]),yy(p[ykey]));pen=true;}c.strokeStyle=color;c.lineWidth=1.7;c.stroke();}
 if(cursor&&Number.isFinite(cursor[xkey])&&Number.isFinite(cursor[ykey]))s.circle(xx(cursor[xkey]),yy(cursor[ykey]),4,'#ffffff');c.restore();
 s.text(fmt(ymax),l-5,t,C.dim,9,'right');s.text(fmt(ymin),l-5,b,C.dim,9,'right');s.text(fmt(xmin),l,b+12,C.dim,9,'left');s.text(fmt(xmax),r,b+12,C.dim,9,'right');s.text(xlabel,(l+r)/2,h-7,C.dim,10);
}
const spectra=new WeakMap(),periods=new WeakMap();
export function drawAnalysis(stage,descriptor,frame,{position='x',velocity='v',periodPoint}={}){
 const time=frame.t;
 if(descriptor.id==='period'){
  let state=periods.get(stage);if(!state||state.params!==frame.params){state={params:frame.params,index:0,points:[]};periods.set(stage,state);}
  // A few milliseconds of quadrature per drawn frame; pending asks the shell for another frame while paused.
  const until=performance.now()+4;
  while(state.index<32&&periodPoint){try{const p=periodPoint(frame,state.index++);if(Number.isFinite(p.y))state.points.push(p);}catch{state.index++;}if(performance.now()>until)break;}
  stage.periodComplete=state.index>=32||!periodPoint;stage.pending=!stage.periodComplete;
  linePlot(stage,{title:'Conservative period',points:state.points,xlabel:velocity==='omega'?'maximum angle / rad':'energy / J',ylabel:'period / s',color:C.gold});return;
 }
 if(descriptor.id==='strobe'||descriptor.id==='return'){
  const points=descriptor.id==='strobe'?frame.instance.section():frame.instance.returnMap();
  linePlot(stage,{title:descriptor.id==='strobe'?'Once per drive cycle':'One-cycle velocity return',points,xkey:descriptor.id==='strobe'?position:'previous',ykey:descriptor.id==='strobe'?velocity:'current',xlabel:descriptor.id==='strobe'?(position==='theta'?'\u03b8 / rad':position+' / m'):'previous '+(velocity==='omega'?'\u03c9':velocity),ylabel:descriptor.id==='strobe'?(velocity==='omega'?'\u03c9 / (rad/s)':'v / (m/s)'):'next '+(velocity==='omega'?'\u03c9':velocity),scatter:true,color:C.violet,cursor:points.at(-1)});return;
 }
 const samples=frame.samples,data=samples.filter(p=>p.t<=time+1e-8).slice(-1024),cache=spectra.get(stage),signature=data.length+':'+Math.floor(time*2);
 let points=cache?.signature===signature&&cache.first===samples[0]?cache.points:[];
 if((!cache||cache.signature!==signature||cache.first!==samples[0])&&data.length>=16){const dt=data[1].t-data[0].t;points=spectrum(data.map(p=>p[velocity==='omega'?'omega':position]),dt,{window:'sine-squared',removeMean:true});spectra.set(stage,{signature,points,first:samples[0]});}
 linePlot(stage,{title:(velocity==='omega'?'Angular velocity':'Displacement')+' spectrum',points:points.filter(p=>p.frequency<=8),xkey:'frequency',ykey:'amplitude',xlabel:'frequency / Hz',ylabel:'amplitude',yFloor:0,color:C.gold});
}
