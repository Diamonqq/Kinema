export const colors=['#8ab9ff','#e9bb88','#b0c9ad','#bcabef','#79cacc','#e4a9bd'];
export const fmt=(v,d=4)=>!Number.isFinite(v)?'\u2014':Math.abs(v)<1e-8?'0':Number(v.toPrecision(Math.max(2,Math.min(4,d)))).toString().replaceAll('-', '\u2212');
import {easeCamera} from '../kit/stage.js';
import {niceTicks,tickLabel} from '../kit/format.js';
const cameras=new WeakMap();
// Side-by-side panes cap at maxHeight so they do not resize when the stage height changes with the breakdown.
export function panels(s,{bottom=92,top=44,maxHeight=Infinity,maxStacked=Infinity}={}) {
  const stacked=s.w<470,gap=stacked?40:28,left=34,right=18;
  const width=stacked?s.w-left-right:(s.w-left-right-gap)/2,height=stacked?Math.min((s.h-top-bottom-gap)/2,maxStacked):Math.min(s.h-top-bottom,maxHeight);
  return [0,1].map(i=>({left:left+(stacked?0:i*(width+gap)),top:top+(stacked?i*(height+gap):0),width,height}));
}
export function mapPanel(s,p,bounds,id='main',animate=true) {
  let cache=cameras.get(s);if(!cache){cache=new Map();cameras.set(s,cache);}
  let current=cache.get(id);
  if(!current||s.snap||!animate)current=[...bounds];
  else if(easeCamera(current,bounds))s.animating=true;
  cache.set(id,current);
  const [xmin,xmax,ymin,ymax]=current,scale=Math.min(p.width/(xmax-xmin||1),p.height/(ymax-ymin||1));
  const cx=(xmin+xmax)/2,cy=(ymin+ymax)/2;
  return {x:v=>p.left+p.width/2+(v-cx)*scale,y:v=>p.top+p.height/2-(v-cy)*scale,scale,bounds:current};
}
// Liang-Barsky clipping keeps arrows, axes and trajectories inside their own pane.
export function clipLine(x1,y1,x2,y2,p) {
  const dx=x2-x1,dy=y2-y1;let a=0,b=1;
  for(const [q,r] of [[-dx,x1-p.left],[dx,p.left+p.width-x1],[-dy,y1-p.top],[dy,p.top+p.height-y1]]){
    if(q===0){if(r<0)return null;continue;}const t=r/q;if(q<0)a=Math.max(a,t);else b=Math.min(b,t);if(a>b)return null;
  }
  return [x1+a*dx,y1+a*dy,x1+b*dx,y1+b*dy];
}
export function line(s,m,p,a,b,color,width=1,dash=[]) {
  const v=clipLine(m.x(a[0]),m.y(a[1]),m.x(b[0]),m.y(b[1]),p);if(!v)return;
  s.ctx.setLineDash(dash);s.line(...v,color,width);s.ctx.setLineDash([]);
}
export function inside(m,p,x,y,pad=0){return m.x(x)>=p.left+pad&&m.x(x)<=p.left+p.width-pad&&m.y(y)>=p.top+pad&&m.y(y)<=p.top+p.height-pad;}
// Text with typeset subscripts: "p_x · MeV/c" or "p_{1x}" lowers a smaller x after the p. Returns the drawn width.
const SUB=/(_\{[^}]*\}|_[A-Za-z0-9])/;
function richParts(s,text,size){
  const c=s.ctx,sub=Math.max(10,Math.round(size*.82)),parts=[];
  for(const t of String(text).split(SUB)){if(!t)continue;const isSub=t[0]==='_'&&t.length>1,value=isSub?t.replace(/^_\{?|\}$/g,''):t,px=isSub?sub:size;
    c.font=`${px}px system-ui,sans-serif`;parts.push({value,sub:isSub,size:px,width:c.measureText(value).width+(isSub?1:0)});}
  return parts;
}
export function richWidth(s,text,size=11){return richParts(s,text,size).reduce((a,b)=>a+b.width,0);}
export function richText(s,text,x,y,color,size=11,align='left'){
  const parts=richParts(s,text,size),total=parts.reduce((a,b)=>a+b.width,0);
  let cursor=x-(align==='right'?total:align==='center'?total/2:0);
  for(const a of parts){s.text(a.value,cursor+(a.sub?1:0),y+(a.sub?3:0),color,a.size,'left');cursor+=a.width;}
  return total;
}
export function axes(s,m,p,{x='x / L',y='ct / L',title='',color='#526176',labels=true}={}) {
  line(s,m,p,[-1e8,0],[1e8,0],color);line(s,m,p,[0,-1e8],[0,1e8],color);
  if(!labels)return;
  if(title)s.text(title,p.left+p.width/2,p.top-16,'#cad8ea',12);
  richText(s,x,p.left+p.width,Math.max(p.top+14,Math.min(p.top+p.height-6,m.y(0)+14)),'#8aa0bb',11,'right');
  richText(s,y,p.left,p.top-4,'#8aa0bb',11,'left');
}
export function plot(s,{title,xLabel,yLabel,points=[],marker=null,bounds=null,bars=false,dots=false,equalScale=false,xLimits=null,yLimits=null}) {
  const layout=left=>{
    const p={left,top:40,width:Math.max(10,s.w-left-17),height:Math.max(20,s.h-76)};let b=bounds&&[...bounds];
    if(!b){const xs=points.map(a=>a[0]),ys=points.map(a=>a[1]);let x0=Math.min(0,...xs),x1=Math.max(.001,...xs),y0=Math.min(0,...ys),y1=Math.max(.001,...ys);if(x0===x1)x1=x0+1;if(y0===y1)y1=y0+1;const dx=(x1-x0)*.07,dy=(y1-y0)*.12;b=[x0<0?x0-dx:0,x1>0?x1+dx:0,y0<0?y0-dy:0,y1>0?y1+dy:0];}
    if(equalScale){const [a,c,d,e]=b,scale=Math.min(p.width/(c-a),p.height/(e-d)),cx=(a+c)/2,cy=(d+e)/2;b=[cx-p.width/(2*scale),cx+p.width/(2*scale),cy-p.height/(2*scale),cy+p.height/(2*scale)];}
    const limit=(a,c,d)=>{if(!d)return [a,c];a=Math.max(a,d[0]);c=Math.min(c,d[1]);return c>a?[a,c]:[d[0],Number.isFinite(d[1])?d[1]:d[0]+1];};
    b=[...limit(b[0],b[1],xLimits),...limit(b[2],b[3],yLimits)];
    // A constant series has no span to tick; open a small window so ticks stay finite.
    const open=(lo,hi)=>hi-lo<1e-9*Math.max(Math.abs(lo),Math.abs(hi),1e-12)?[lo-Math.max(Math.abs(lo)*.05,1e-3),hi+Math.max(Math.abs(hi)*.05,1e-3)]:[lo,hi];
    b=[...open(b[0],b[1]),...open(b[2],b[3])];
    return {p,b};
  };
  let {p,b}=layout(47);
  const ticksFor=(p,b)=>({x:niceTicks(b[0],b[1],Math.max(2,Math.round(p.width/64))),y:niceTicks(b[2],b[3],Math.max(2,Math.round(p.height/34)))});
  let ticks=ticksFor(p,b);s.ctx.font='9px system-ui,sans-serif';
  // The gutter grows to fit the widest y tick text so it never clips.
  const gutter=Math.ceil(Math.max(...ticks.y.ticks.map(v=>s.ctx.measureText(tickLabel(v,ticks.y.step)).width),0))+9;
  if(gutter>47){({p,b}=layout(gutter));ticks=ticksFor(p,b);}
  const [x0,x1,y0,y1]=b,m={x:v=>p.left+(v-x0)/(x1-x0)*p.width,y:v=>p.top+p.height-(v-y0)/(y1-y0)*p.height};
  richText(s,yLabel,8,24,'#90a6c2',11,'left');
  for(const v of ticks.x.ticks)s.line(m.x(v),p.top,m.x(v),p.top+p.height,v===0?'rgba(160,180,210,0.28)':'rgba(160,180,210,0.10)',1);
  for(const v of ticks.y.ticks)s.line(p.left,m.y(v),p.left+p.width,m.y(v),v===0?'rgba(160,180,210,0.28)':'rgba(160,180,210,0.10)',1);
  s.line(p.left,p.top,p.left,p.top+p.height,'#3b4a5e',1);s.line(p.left,p.top+p.height,p.left+p.width,p.top+p.height,'#3b4a5e',1);
  if(bars){const bw=p.width/Math.max(1,points.length)*.8;for(const [x,y] of points){s.ctx.fillStyle=colors[0]+'aa';s.ctx.fillRect(m.x(x)-bw/2,m.y(y),bw,m.y(0)-m.y(y));}}
  else if(dots){for(const [x,y] of points)if(inside(m,p,x,y,2))s.circle(m.x(x),m.y(y),1.8,colors[0]);}
  else for(let i=1;i<points.length;i++)line(s,m,p,points[i-1],points[i],colors[0],1.5);
  if(marker&&inside(m,p,...marker)){
    line(s,m,p,[marker[0],y0],[marker[0],y1],'#e6edf5',1,[2,3]);s.circle(m.x(marker[0]),m.y(marker[1]),3,'#fff');
  }
  for(const v of ticks.x.ticks)s.text(tickLabel(v,ticks.x.step),m.x(v),p.top+p.height+13,'#8195af',9,'center');
  for(const v of ticks.y.ticks)s.text(tickLabel(v,ticks.y.step),p.left-5,m.y(v),'#8195af',9,'right');
  richText(s,xLabel,s.w/2,s.h-7,'#90a6c2',11,'center');
}

// Clip every stroke, marker and arrow to its own panel; titles live outside it.
export function clipPanel(s,p,draw){const c=s.ctx;c.save();c.beginPath();c.rect(p.left,p.top,p.width,p.height);c.clip();try{return draw();}finally{c.restore();}}
