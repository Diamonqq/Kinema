import {VectorStage,palette} from './stage.js';
export class LinkedGraph {
 constructor(host,descriptor){this.descriptor=descriptor;this.canvas=document.createElement('canvas');this.canvas.setAttribute('aria-label',descriptor.label+' graph');this.canvas.setAttribute('role','img');host.append(this.canvas);this.stage=new VectorStage(this.canvas);}
 draw(samples,time){
  const s=this.stage;s.resize();s.begin();const {w,h,ctx}=s,d=this.descriptor,series=d.series||[],left=42,right=w-14,top=30,bottom=h-29;
  s.text(d.label+(d.unit?' · '+d.unit:''),left,13,'#c5cfdb',12,'left');
  const vals=samples.flatMap(p=>series.map(v=>p[v.key])).filter(Number.isFinite);let lo=Math.min(0,...vals),hi=Math.max(.001,...vals);const pad=(hi-lo)*.12;hi+=pad;lo-=pad;
  const tx=t=>left+(right-left)*t/(samples.at(-1)?.t||1),yy=v=>bottom-(bottom-top)*(v-lo)/(hi-lo);
  s.line(left,top,left,bottom,'#36414f',1);s.line(left,bottom,right,bottom,'#36414f',1);s.line(left,yy(0),right,yy(0),'#26303c',1);
  s.text(hi.toFixed(2),left-5,top,'#8190a4',10,'right');s.text(lo.toFixed(2),left-5,bottom,'#8190a4',10,'right');
  if(d.kind==='spectrum'){
   const sample=samples.reduce((a,p)=>Math.abs(p.t-time)<Math.abs(a.t-time)?p:a,samples[0]);series.forEach((v,i)=>{const x=left+(right-left)*(i+.5)/series.length;ctx.fillStyle=v.color||palette[i%palette.length];ctx.fillRect(x-8,yy(Math.abs(sample?.[v.key]||0)),16,bottom-yy(Math.abs(sample?.[v.key]||0)));s.text(v.label,x,bottom+13,'#adb9ca',10)});return;
  }
  if(d.kind==='phase'){
   const sx=series[0]?.key,sy=series[1]?.key;if(!sx||!sy)return;const maxX=Math.max(.001,...samples.map(p=>Math.abs(p[sx]||0))),maxY=Math.max(.001,...samples.map(p=>Math.abs(p[sy]||0))),xx=v=>left+(right-left)*(.5+.45*v/maxX),py=v=>top+(bottom-top)*(.5-.45*v/maxY);
   ctx.beginPath();samples.forEach((p,i)=>i?ctx.lineTo(xx(p[sx]),py(p[sy])):ctx.moveTo(xx(p[sx]),py(p[sy])));ctx.strokeStyle=palette[0];ctx.lineWidth=1.6;ctx.stroke();const p=samples.reduce((a,p)=>Math.abs(p.t-time)<Math.abs(a.t-time)?p:a,samples[0]);if(p)s.circle(xx(p[sx]),py(p[sy]),4,'#fff');s.text(series.map(x=>x.label).join(' / '),(left+right)/2,bottom+15,'#9aaabe',10);return;
  }
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  series.forEach((v,j)=>{ctx.beginPath();let first=true;for(const p of samples){if(!Number.isFinite(p[v.key]))continue;first?ctx.moveTo(tx(p.t),yy(p[v.key])):ctx.lineTo(tx(p.t),yy(p[v.key]));first=false;}ctx.strokeStyle=v.color||palette[j%palette.length];ctx.lineWidth=1.5;ctx.stroke();});
  s.line(tx(time),top,tx(time),bottom,'#f0f4ff',1);ctx.restore();s.text('0 s',left,bottom+15,'#8190a4',10);s.text((samples.at(-1)?.t||0).toFixed(0)+' s',right,bottom+15,'#8190a4',10,'right');
  let x=left;series.forEach((v,j)=>{s.circle(x+3,h-6,2,v.color||palette[j%palette.length]);s.text(v.label,x+10,h-6,'#acb9cc',10,'left');x+=Math.max(42,v.label.length*7+20)});
 }
}
