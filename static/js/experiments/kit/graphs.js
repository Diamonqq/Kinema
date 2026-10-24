import {VectorStage,palette} from './stage.js';
import {num,niceTicks,tickLabel} from './format.js';
// Zero stays on the axis; padding never invents a negative range for nonnegative data (or the reverse).
export function valueRange(vals){let lo=0,hi=0;for(const value of vals){if(value<lo)lo=value;if(value>hi)hi=value;}if(hi===lo)hi=lo+1;const pad=(hi-lo)*.12;if(hi>0)hi+=pad;if(lo<0)lo-=pad;return [lo,hi];}
export const axisLabel=v=>num(v);
export function graphTimeRange(descriptor,end,time){
 const window=descriptor.window;
 if(['phase','spectrum','custom'].includes(descriptor.kind)||!Number.isFinite(window)||window<=0||end<=window)return [0,end];
 const start=Math.max(0,Math.min(end-window,time-window/2));return [start,start+window];
}
export function sampleBound(samples,time,upper=false){
 let lo=0,hi=samples.length;while(lo<hi){const mid=(lo+hi)>>>1;if(samples[mid].t<time||upper&&samples[mid].t===time)lo=mid+1;else hi=mid;}return lo;
}
export function nearestSample(samples,time){const i=sampleBound(samples,time);if(i===0)return samples[0];if(i===samples.length)return samples.at(-1);return time-samples[i-1].t<=samples[i].t-time?samples[i-1]:samples[i];}
// Retain each pixel column's extrema, in their original temporal order. Two
// boundary neighbours keep the clipped line continuous at the window edges.
export function decimate(samples,key,start,end,columns){
 const first=Math.max(0,sampleBound(samples,start)-1),last=Math.min(samples.length,sampleBound(samples,end,true)+1),out=[];
 let bucket=-1,min,max,minIndex,maxIndex,firstPoint,lastPoint,segmentStart=0;
 const flush=()=>{if(minIndex===undefined)return;if(minIndex<=maxIndex){out.push(min);if(maxIndex!==minIndex)out.push(max);}else{out.push(max);out.push(min);}};
 const finishSegment=()=>{flush();if(firstPoint&&out[segmentStart]!==firstPoint)out.splice(segmentStart,0,firstPoint);if(lastPoint&&out.at(-1)!==lastPoint)out.push(lastPoint);bucket=-1;minIndex=maxIndex=undefined;firstPoint=lastPoint=undefined;};
 for(let i=first;i<last;i++){
  const point=samples[i],value=point[key];if(!Number.isFinite(value)){finishSegment();if(!out.length||Number.isFinite(out.at(-1)[key]))out.push(point);segmentStart=out.length;continue;}if(!firstPoint)firstPoint=point;lastPoint=point;
  const column=Math.max(0,Math.min(Math.max(1,columns)-1,Math.floor((point.t-start)/(end-start||1)*columns)));
  if(column!==bucket){flush();bucket=column;min=max=point;minIndex=maxIndex=i;}
  else {if(value<min[key]){min=point;minIndex=i;}if(value>max[key]){max=point;maxIndex=i;}}
 }
 finishSegment();return out;
}
export class CustomGraph {
 constructor(host,descriptor,draw){
  this.descriptor=descriptor;this.render=draw;host.classList.add('exp-custom-graph');
  const title=document.createElement('div');title.className='exp-custom-title';title.textContent=descriptor.label+(descriptor.unit?' · '+descriptor.unit:'');host.append(title);
  this.canvas=document.createElement('canvas');this.canvas.setAttribute('aria-label',descriptor.label+' graph');this.canvas.setAttribute('role','img');host.append(this.canvas);this.stage=new VectorStage(this.canvas);
 }
 draw(samples,time,frame){this.stage.resize();this.stage.begin();if(this.render)this.render(this.stage,this.descriptor,frame);else this.stage.text('Graph unavailable',this.stage.w/2,this.stage.h/2);}
}
export class LinkedGraph {
 constructor(host,descriptor){this.descriptor=descriptor;this.canvas=document.createElement('canvas');this.canvas.setAttribute('aria-label',descriptor.label+' graph');this.canvas.setAttribute('role','img');host.append(this.canvas);this.stage=new VectorStage(this.canvas);}
 draw(samples,time){
  const s=this.stage;s.resize();s.begin();const {w,h,ctx}=s,d=this.descriptor,series=d.series||[],right=w-14,top=30,bottom=h-31;
  const signature=JSON.stringify(d);
  if(this.rangeSource!==samples||this.rangeSignature!==signature||samples.length<(this.rangeCount||0)){
   this.rangeSource=samples;this.rangeSignature=signature;this.rangeCount=0;this.rangeLo=0;this.rangeHi=0;this.maxX=this.maxY=.001;this.cacheKey=null;
  }
  for(let i=this.rangeCount;i<samples.length;i++){
   const point=samples[i];for(const v of series){const value=point[v.key];if(Number.isFinite(value)){this.rangeLo=Math.min(this.rangeLo,value);this.rangeHi=Math.max(this.rangeHi,value);}}
   this.maxX=Math.max(this.maxX,Math.abs(point[series[0]?.key]||0));this.maxY=Math.max(this.maxY,Math.abs(point[series[1]?.key]||0));
  }
  this.rangeCount=samples.length;const [lo,hi]=valueRange([this.rangeLo,this.rangeHi]);
  // Round ticks (zero included) label the value axis; the gutter grows to fit long labels such as 1.12×10⁻⁸.
  const phase=d.kind==='phase',yt=niceTicks(phase?-this.maxY/.9:lo,phase?this.maxY/.9:hi,Math.max(2,Math.floor((bottom-top)/34)));
  ctx.font='9px system-ui,sans-serif';const left=Math.max(42,Math.ceil(Math.max(0,...yt.ticks.map(v=>ctx.measureText(tickLabel(v,yt.step))?.width||0)))+12);
  const [start,end]=graphTimeRange(d,samples.at(-1)?.t||0,time);this.timeRange=[start,end];this.yRange=[lo,hi];
  const tx=t=>left+(right-left)*(t-start)/(end-start||1),yy=v=>bottom-(bottom-top)*(v-lo)/(hi-lo);
  // Use the same mapping for future graph pointer/scrub interactions.
  this.timeAt=x=>start+Math.max(0,Math.min(1,(x-left)/(right-left)))*(end-start);
  const point=(d.kind==='spectrum'||d.kind==='phase')?nearestSample(samples,time):null;
  const cacheKey=JSON.stringify([w,h,s.dpr,signature,samples.length,start,end,lo,hi,d.kind==='spectrum'?point?.t:null]);
  const cacheHit=this.staticLayer&&this.cacheKey===cacheKey;
  const staticDraw=()=>{
  s.text(d.label+(d.unit?' · '+d.unit:''),left,13,'#c5cfdb',12,'left');
  const GRID='rgba(160,180,210,0.10)',ZERO='rgba(160,180,210,0.24)',TICK='#7b8a9e',yAt=phase?v=>top+(bottom-top)*(.5-.45*v/this.maxY):yy;
  const xTicks=(lo2,hi2,at,suffix)=>{const xt=niceTicks(lo2,hi2,Math.max(2,Math.floor((right-left)/64))),shown=xt.ticks.filter(v=>at(v)>=left-.5&&at(v)<=right+.5);for(const v of shown)s.line(at(v),top,at(v),bottom,v===0?ZERO:GRID,1);
   ctx.font='9px system-ui,sans-serif';for(const v of shown){const text=tickLabel(v,xt.step)+(suffix&&v===shown.at(-1)?' '+suffix:''),half=(ctx.measureText(text)?.width||0)/2;s.text(text,Math.min(at(v),w-2-half),bottom+12,TICK,9);}};
  for(const v of yt.ticks){const y=yAt(v);if(y<top-.5||y>bottom+.5)continue;s.line(left,y,right,y,v===0?ZERO:GRID,1);s.text(tickLabel(v,yt.step),left-5,y,TICK,9,'right');}
  s.line(left,top,left,bottom,'#36414f',1);s.line(left,bottom,right,bottom,'#36414f',1);
  if(d.kind==='spectrum'){
   series.forEach((v,i)=>{const x=left+(right-left)*(i+.5)/series.length;ctx.fillStyle=v.color||palette[i%palette.length];ctx.fillRect(x-8,yy(Math.abs(point?.[v.key]||0)),16,bottom-yy(Math.abs(point?.[v.key]||0)));s.text(v.label,x,bottom+13,'#adb9ca',11)});return;
  }
  if(d.kind==='phase'){
   const sx=series[0]?.key,sy=series[1]?.key;if(!sx||!sy)return;const xx=v=>left+(right-left)*(.5+.45*v/this.maxX),py=v=>top+(bottom-top)*(.5-.45*v/this.maxY);
   ctx.beginPath();samples.forEach((p,i)=>i?ctx.lineTo(xx(p[sx]),py(p[sy])):ctx.moveTo(xx(p[sx]),py(p[sy])));ctx.strokeStyle=palette[0];ctx.lineWidth=1.6;ctx.stroke();xTicks(-this.maxX/.9,this.maxX/.9,xx);s.text(series.map(x=>x.label).join(' / '),(left+right)/2,h-6,'#9aaabe',11);return;
  }
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  series.forEach((v,j)=>{ctx.beginPath();let first=true;for(const p of decimate(samples,v.key,start,end,Math.max(1,Math.floor(right-left)))){if(!Number.isFinite(p[v.key])){first=true;continue;}first?ctx.moveTo(tx(p.t),yy(p[v.key])):ctx.lineTo(tx(p.t),yy(p[v.key]));first=false;}ctx.strokeStyle=v.color||palette[j%palette.length];ctx.lineWidth=1.5;ctx.stroke();});
  ctx.restore();xTicks(start,end,tx,'s');
  let x=left;series.forEach((v,j)=>{s.circle(x+3,h-6,2.5,v.color||palette[j%palette.length]);s.text(v.label,x+10,h-6,'#acb9cc',11,'left');x+=Math.max(46,v.label.length*7.5+22)});
  };
  if(cacheHit){ctx.drawImage(this.staticLayer,0,0,w,h);s.labels=this.staticLabels.slice();}
  else {
   staticDraw();
   if(this.canvas&&typeof ctx.drawImage==='function'){
    if(!this.staticLayer)this.staticLayer=typeof OffscreenCanvas==='function'?new OffscreenCanvas(this.canvas.width,this.canvas.height):document.createElement('canvas');
    if(this.staticLayer.width!==this.canvas.width)this.staticLayer.width=this.canvas.width;if(this.staticLayer.height!==this.canvas.height)this.staticLayer.height=this.canvas.height;
    const layer=this.staticLayer.getContext('2d');layer.clearRect(0,0,this.canvas.width,this.canvas.height);layer.drawImage(this.canvas,0,0);this.staticLabels=s.labels.slice();this.cacheKey=cacheKey;
   }
  }
  if(d.kind==='phase'){
   if(point&&series.length>=2)s.circle(left+(right-left)*(.5+.45*point[series[0].key]/this.maxX),top+(bottom-top)*(.5-.45*point[series[1].key]/this.maxY),4,'#fff');
  }else if(d.kind!=='spectrum'){
   ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();s.line(tx(time),top,tx(time),bottom,'#f0f4ff',1);ctx.restore();
  }
 }
}
