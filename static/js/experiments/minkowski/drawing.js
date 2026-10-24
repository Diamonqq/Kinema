export const colors=['#8ab9ff','#e9bb88','#b0c9ad','#bcabef','#79cacc','#e4a9bd'];
export const fmt=(v,d=3)=>!Number.isFinite(v)?'—':Math.abs(v)<1e-8?'0':Math.abs(v)>=10000||Math.abs(v)<.001?v.toExponential(2):Number(v.toFixed(d)).toString();
const cameras=new WeakMap();
export function panels(s,{bottom=92,top=44}={}) {
  const stacked=s.w<470,gap=stacked?24:28,left=34,right=18;
  const width=stacked?s.w-left-right:(s.w-left-right-gap)/2,height=stacked?(s.h-top-bottom-gap)/2:s.h-top-bottom;
  return [0,1].map(i=>({left:left+(stacked?0:i*(width+gap)),top:top+(stacked?i*(height+gap):0),width,height}));
}
export function mapPanel(s,p,bounds,id='main',animate=true) {
  let cache=cameras.get(s);if(!cache){cache=new Map();cameras.set(s,cache);}
  let current=cache.get(id);
  if(!current||s.snap||!animate)current=[...bounds];
  else current=current.map((v,i)=>v+(bounds[i]-v)*.22);
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
export function axes(s,m,p,{x='x / L',y='ct / L',title='',color='#526176',labels=true}={}) {
  line(s,m,p,[-1e8,0],[1e8,0],color);line(s,m,p,[0,-1e8],[0,1e8],color);
  if(!labels)return;
  s.text(title,p.left+p.width/2,p.top-16,'#cad8ea',12);
  s.text(x,p.left+p.width,Math.max(p.top+14,Math.min(p.top+p.height-5,m.y(0)+14)),'#8296b0',10,'right');
  s.text(y,p.left,p.top-3,'#8296b0',10,'left');
}
export function plot(s,{title,xLabel,yLabel,points=[],marker=null,bounds=null,bars=false,dots=false,equalScale=false,xLimits=null,yLimits=null}) {
  const p={left:47,top:40,width:Math.max(10,s.w-64),height:Math.max(20,s.h-76)};
  if(!bounds){const xs=points.map(a=>a[0]),ys=points.map(a=>a[1]);let x0=Math.min(0,...xs),x1=Math.max(.001,...xs),y0=Math.min(0,...ys),y1=Math.max(.001,...ys);if(x0===x1)x1=x0+1;if(y0===y1)y1=y0+1;const dx=(x1-x0)*.07,dy=(y1-y0)*.12;bounds=[x0<0?x0-dx:0,x1>0?x1+dx:0,y0<0?y0-dy:0,y1>0?y1+dy:0];}
  if(equalScale){const [a,b,c,d]=bounds,scale=Math.min(p.width/(b-a),p.height/(d-c)),cx=(a+b)/2,cy=(c+d)/2;bounds=[cx-p.width/(2*scale),cx+p.width/(2*scale),cy-p.height/(2*scale),cy+p.height/(2*scale)];}
  const limit=(a,b,d)=>{if(!d)return [a,b];a=Math.max(a,d[0]);b=Math.min(b,d[1]);return b>a?[a,b]:[d[0],Number.isFinite(d[1])?d[1]:d[0]+1];};
  bounds=[...limit(bounds[0],bounds[1],xLimits),...limit(bounds[2],bounds[3],yLimits)];
  const [x0,x1,y0,y1]=bounds,m={x:v=>p.left+(v-x0)/(x1-x0)*p.width,y:v=>p.top+p.height-(v-y0)/(y1-y0)*p.height};
  s.text(title,s.w/2,14,'#c7d6ea',11);s.text(yLabel,8,31,'#90a6c2',10,'left');
  s.line(p.left,p.top,p.left,p.top+p.height,'#3b4a5e',1);s.line(p.left,p.top+p.height,p.left+p.width,p.top+p.height,'#3b4a5e',1);
  if(bars){const bw=p.width/Math.max(1,points.length)*.8;for(const [x,y] of points){s.ctx.fillStyle=colors[0]+'aa';s.ctx.fillRect(m.x(x)-bw/2,m.y(y),bw,m.y(0)-m.y(y));}}
  else if(dots){for(const [x,y] of points)if(inside(m,p,x,y,2))s.circle(m.x(x),m.y(y),1.8,colors[0]);}
  else for(let i=1;i<points.length;i++)line(s,m,p,points[i-1],points[i],colors[0],1.5);
  if(marker&&inside(m,p,...marker)){
    line(s,m,p,[marker[0],y0],[marker[0],y1],'#e6edf5',1,[2,3]);s.circle(m.x(marker[0]),m.y(marker[1]),3,'#fff');
  }
  s.text(fmt(x0,2),p.left,p.top+p.height+13,'#8195af',9,'left');s.text(fmt(x1,2),p.left+p.width,p.top+p.height+13,'#8195af',9,'right');
  s.text(xLabel,s.w/2,s.h-7,'#90a6c2',10);s.text(fmt(y1,2),p.left-5,p.top+5,'#8195af',9,'right');
}
