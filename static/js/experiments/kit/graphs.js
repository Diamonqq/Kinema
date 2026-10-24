import {VectorStage,palette} from './stage.js';
// Zero stays on the axis; padding never invents a negative range for nonnegative data (or the reverse).
export function valueRange(vals){let lo=Math.min(0,...vals),hi=Math.max(0,...vals);if(hi===lo)hi=lo+1;const pad=(hi-lo)*.12;if(hi>0)hi+=pad;if(lo<0)lo-=pad;return [lo,hi];}
export function axisLabel(v){const a=Math.abs(v);return a&&(a>=1e4||a<.01)?v.toExponential(1).replace('+',''):v.toFixed(a>=100?0:a>=10?1:2);}
export function graphTimeRange(descriptor,end,time){
 const window=descriptor.window;
 if(['phase','spectrum','custom'].includes(descriptor.kind)||!Number.isFinite(window)||window<=0||end<=window)return [0,end];
 const start=Math.max(0,Math.min(end-window,time-window/2));return [start,start+window];
}
export class CustomGraph {
 constructor(host,descriptor,draw){
  this.descriptor=descriptor;this.render=draw;host.classList.add('exp-custom-graph');
  const title=document.createElement('header');title.className='exp-custom-title';title.textContent=descriptor.label+(descriptor.unit?' · '+descriptor.unit:'');host.append(title);
  this.canvas=document.createElement('canvas');this.canvas.setAttribute('aria-label',descriptor.label+' graph');this.canvas.setAttribute('role','img');host.append(this.canvas);this.stage=new VectorStage(this.canvas);
 }
 draw(samples,time,frame){this.stage.resize();this.stage.begin();if(this.render)this.render(this.stage,this.descriptor,frame);else this.stage.text('Graph unavailable',this.stage.w/2,this.stage.h/2);}
}
export class LinkedGraph {
 constructor(host,descriptor){this.descriptor=descriptor;this.canvas=document.createElement('canvas');this.canvas.setAttribute('aria-label',descriptor.label+' graph');this.canvas.setAttribute('role','img');host.append(this.canvas);this.stage=new VectorStage(this.canvas);}
 draw(samples,time){
  const s=this.stage;s.resize();s.begin();const {w,h,ctx}=s,d=this.descriptor,series=d.series||[],left=42,right=w-14,top=30,bottom=h-29;
  s.text(d.label+(d.unit?' · '+d.unit:''),left,13,'#c5cfdb',12,'left');
  const vals=samples.flatMap(p=>series.map(v=>p[v.key])).filter(Number.isFinite);const [lo,hi]=valueRange(vals);
  const [start,end]=graphTimeRange(d,samples.at(-1)?.t||0,time);this.timeRange=[start,end];this.yRange=[lo,hi];
  const tx=t=>left+(right-left)*(t-start)/(end-start||1),yy=v=>bottom-(bottom-top)*(v-lo)/(hi-lo);
  // Use the same mapping for future graph pointer/scrub interactions.
  this.timeAt=x=>start+Math.max(0,Math.min(1,(x-left)/(right-left)))*(end-start);
  s.line(left,top,left,bottom,'#36414f',1);s.line(left,bottom,right,bottom,'#36414f',1);s.line(left,yy(0),right,yy(0),'#26303c',1);
  s.text(axisLabel(hi),left-5,top,'#8190a4',10,'right');s.text(axisLabel(lo),left-5,bottom,'#8190a4',10,'right');
  if(d.kind==='spectrum'){
   const sample=samples.reduce((a,p)=>Math.abs(p.t-time)<Math.abs(a.t-time)?p:a,samples[0]);series.forEach((v,i)=>{const x=left+(right-left)*(i+.5)/series.length;ctx.fillStyle=v.color||palette[i%palette.length];ctx.fillRect(x-8,yy(Math.abs(sample?.[v.key]||0)),16,bottom-yy(Math.abs(sample?.[v.key]||0)));s.text(v.label,x,bottom+13,'#adb9ca',10)});return;
  }
  if(d.kind==='phase'){
   const sx=series[0]?.key,sy=series[1]?.key;if(!sx||!sy)return;const maxX=Math.max(.001,...samples.map(p=>Math.abs(p[sx]||0))),maxY=Math.max(.001,...samples.map(p=>Math.abs(p[sy]||0))),xx=v=>left+(right-left)*(.5+.45*v/maxX),py=v=>top+(bottom-top)*(.5-.45*v/maxY);
   ctx.beginPath();samples.forEach((p,i)=>i?ctx.lineTo(xx(p[sx]),py(p[sy])):ctx.moveTo(xx(p[sx]),py(p[sy])));ctx.strokeStyle=palette[0];ctx.lineWidth=1.6;ctx.stroke();const p=samples.reduce((a,p)=>Math.abs(p.t-time)<Math.abs(a.t-time)?p:a,samples[0]);if(p)s.circle(xx(p[sx]),py(p[sy]),4,'#fff');s.text(series.map(x=>x.label).join(' / '),(left+right)/2,bottom+15,'#9aaabe',10);return;
  }
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  series.forEach((v,j)=>{ctx.beginPath();let first=true;for(const p of samples){if(!Number.isFinite(p[v.key]))continue;first?ctx.moveTo(tx(p.t),yy(p[v.key])):ctx.lineTo(tx(p.t),yy(p[v.key]));first=false;}ctx.strokeStyle=v.color||palette[j%palette.length];ctx.lineWidth=1.5;ctx.stroke();});
  s.line(tx(time),top,tx(time),bottom,'#f0f4ff',1);ctx.restore();const seconds=t=>Number(t.toFixed(2))+' s';s.text(seconds(start),left,bottom+15,'#8190a4',10);s.text(seconds(end),right,bottom+15,'#8190a4',10,'right');
  let x=left;series.forEach((v,j)=>{s.circle(x+3,h-6,2,v.color||palette[j%palette.length]);s.text(v.label,x+10,h-6,'#acb9cc',10,'left');x+=Math.max(42,v.label.length*7+20)});
 }
}
