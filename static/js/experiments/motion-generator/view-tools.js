// View utilities owned by the oscillator lane. SI geometry stays in each core.
import {num,texNum,withUnit,niceTicks,tickLabel} from '../kit/format.js';
import {easeCamera} from '../kit/stage.js';
export {withUnit};
import {spectrum} from '../anharmonic/analysis.js';
export const C={blue:'#8ab9ff',gold:'#e9bb88',green:'#b0c9ad',violet:'#bcabef',dim:'#71839b',ink:'#cbd8e9',grid:'#344355'};
export const fmt=(x,n=3)=>num(x,n);
export const tex=(x,n=3)=>texNum(x,n);
// A number with its unit for a substituted equation: texU(9.81,'m/s^2') -> 9.81\,\mathrm{m/s^2}.
export const texU=(x,unit,n=3)=>texNum(x,n)+(unit?String.raw`\,\mathrm{${unit}}`:'');
// Box of a zoom chip as the shell places it: centered on x (kept inside the canvas), top edge at y; padded by 3 px.
export function chipBox(s,text,anchor){
 const narrow=s.w<=440;s.ctx.font=(narrow?10:11)+'px system-ui,sans-serif';
 const width=s.ctx.measureText(text).width+(narrow?18:24)+10,height=(narrow?24:32),x=Math.max(width/2+4,Math.min(s.w-width/2-4,anchor.x));
 return {x:x-width/2,y:anchor.y-3,width,height:height+6,chipHeight:height};
}
// Width of the pane the equations are shown in; each lab's draw() records it so equations() can keep a line whole when it fits.
export const pane={width:0};
const texChars=t=>{const s=t.replace(/\\,/g,' ').replace(/\\(mathrm|left|right|operatorname)/g,'').replace(/\\(sin|cos|tan)/g,'sin').replace(/\\times/g,'×').replace(/\\[a-zA-Z]+/g,'x').replace(/[{}^_]/g,'');return s.length-.6*(s.match(/ /g)||[]).length;};
// A substituted line given as pieces (later pieces start with their operator, e.g. '\\times ...'): one line when it fits the pane, otherwise one piece per line.
export function wrapTex(pieces,width=pane.width){
 const whole=pieces.join('').replace(/\\times\s*/g,'');
 return !width||texChars(whole)*8.2<=width-32?[whole]:pieces;
}
export function label(s,text,x,y,color=C.ink,size=12,align='center'){
 const c=s.ctx,parts=String(text).split(/(_\{[^}]+\})/).filter(Boolean).map(t=>({text:t.startsWith('_{')?t.slice(2,-1):t,sub:t.startsWith('_{')}));
 const widths=parts.map(p=>{c.font=`${size*(p.sub?.8:1)}px system-ui,sans-serif`;return c.measureText(p.text).width;}),width=widths.reduce((a,b)=>a+b,0),left=align==='left'?x:align==='right'?x-width:x-width/2;
 if(left<5||left+width>s.w-5||y<size||y>s.h-44)return false;
 const rect={x:left-3,y:y-size*.65,width:width+6,height:size*1.4};
 if([...(s.labels||[]),...(s.avoid||[])].some(b=>rect.x<b.x+b.width+2&&rect.x+rect.width>b.x-2&&rect.y<b.y+b.height+2&&rect.y+rect.height>b.y-2))return false;
 if(!parts.some(p=>p.sub)){s.text(text,x,y,color,size,align);return true;}
 c.fillStyle=color;c.textAlign='left';c.textBaseline='middle';let cursor=left;
 parts.forEach((p,i)=>{c.font=`${size*(p.sub?.8:1)}px system-ui,sans-serif`;c.fillText(p.text,cursor,y+(p.sub?size*.24:0));cursor+=widths[i];});
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
// At most three round ticks at least minGap px apart; when the range only yields 0, the largest round value (1, 2, 4 or 5 x 10^n) inside the range on each side.
export function sparseTicks(lo,hi,px,count=3,minGap=18){
 for(let c=count;c>=1;c--){const t=niceTicks(lo,hi,c);if(t.ticks.length>=2&&t.ticks.length<=3&&t.step*px/(hi-lo)>=minGap)return t;}
 const round=v=>{if(!(v>0))return 0;const p=10**Math.floor(Math.log10(v)),u=v/p;return (u>=5?5:u>=4?4:u>=2?2:1)*p;},up=round(hi),down=round(-lo),ticks=[...(down?[-down]:[]),0,...(up?[up]:[])];
 return {step:Math.min(...ticks.filter(v=>v!==0).map(Math.abs),1),ticks};
}
export function linePlot(s,{title,points=[],xkey='x',ykey='y',cursor,color=C.blue,xlabel='',ylabel='',scatter=false,yFloor,yTicks,pad=.12}){
 s.resize();s.begin();const w=s.w,h=s.h,r=w-17,t=48,b=h-34;let l=42;
 const data=points.filter(p=>Number.isFinite(p[xkey])&&Number.isFinite(p[ykey]));
 if(!data.length){s.line(l,t,l,b,C.grid,1);s.line(l,b,r,b,C.grid,1);if(ylabel)label(s,ylabel,l,33,C.dim,10,'left');s.text('Play to collect samples',(l+r)/2,(t+b)/2,C.dim,11);return;}
 let xmin=Math.min(...data.map(p=>p[xkey])),xmax=Math.max(...data.map(p=>p[xkey])),ymin=Math.min(...data.map(p=>p[ykey])),ymax=Math.max(...data.map(p=>p[ykey]));
 if(xmax-xmin<1e-9){xmin-=.5;xmax+=.5;}if(yFloor!==undefined){ymin=yFloor;ymax=Math.max(ymax,yFloor+1e-9);}else if(ymax-ymin<1e-9){ymin-=.5;ymax+=.5;}
 const dy=(ymax-ymin)*pad;ymin=yFloor??ymin-dy;ymax+=dy;
 // Round ticks (zero included when in range); the left gutter widens to fit the widest tick text.
 s.ctx.font='9px system-ui,sans-serif';
 const yt=yTicks===undefined?niceTicks(ymin,ymax,Math.max(2,Math.floor((b-t)/38))):sparseTicks(ymin,ymax,b-t,yTicks),ylabels=yt.ticks.map(v=>tickLabel(v,yt.step));
 l=Math.max(42,Math.ceil(Math.max(0,...ylabels.map(x=>s.ctx.measureText(x).width)))+11);
 const xt=niceTicks(xmin,xmax,Math.max(2,Math.floor((r-l)/64))),xlabels=xt.ticks.map(v=>tickLabel(v,xt.step));
 s.plotBounds={xmin,xmax,ymin,ymax,left:l,right:r,top:t,bottom:b};const xx=x=>l+(r-l)*(x-xmin)/(xmax-xmin),yy=y=>b-(b-t)*(y-ymin)/(ymax-ymin);
 if(ylabel)label(s,ylabel,l,33,C.dim,10,'left');
 const grid='rgba(160,180,210,0.10)',zero='rgba(160,180,210,0.28)';
 yt.ticks.forEach((v,i)=>{const y=yy(v);s.line(l,y,r,y,v===0?zero:grid,1);s.text(ylabels[i],l-5,y,C.dim,9,'right');});
 xt.ticks.forEach((v,i)=>{const x=xx(v);s.line(x,t,x,b,v===0?zero:grid,1);s.text(xlabels[i],Math.max(l,Math.min(r,x)),b+12,C.dim,9,'center');});
 s.line(l,t,l,b,C.grid,1);s.line(l,b,r,b,C.grid,1);
 const c=s.ctx;c.save();c.beginPath();c.rect(l,t,r-l,b-t);c.clip();
 if(scatter){for(const p of data)s.circle(xx(p[xkey]),yy(p[ykey]),2.6,color);}else{c.beginPath();let pen=false;for(const p of points){if(!Number.isFinite(p[xkey])||!Number.isFinite(p[ykey])){pen=false;continue;}if(pen)c.lineTo(xx(p[xkey]),yy(p[ykey]));else c.moveTo(xx(p[xkey]),yy(p[ykey]));pen=true;}c.strokeStyle=color;c.lineWidth=1.7;c.stroke();}
 if(cursor&&Number.isFinite(cursor[xkey])&&Number.isFinite(cursor[ykey]))s.circle(xx(cursor[xkey]),yy(cursor[ykey]),4,'#ffffff');c.restore();
 s.text(xlabel,(l+r)/2,h-7,C.dim,10);
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
