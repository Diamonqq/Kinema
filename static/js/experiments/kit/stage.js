export const palette=['#8ab9ff','#e9bb88','#b0c9ad','#bcabef','#79cacc','#e4a9bd','#c5cb7d','#a6b6cc'];
export class VectorStage {
 constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.resize();}
 resize(){const r=this.canvas.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height);if(w!==this.w||h!==this.h)this.snap=true;this.w=w;this.h=h;const d=Math.min(3,devicePixelRatio||1);if(this.canvas.width!==Math.round(this.w*d)||this.canvas.height!==Math.round(this.h*d)){this.canvas.width=Math.round(this.w*d);this.canvas.height=Math.round(this.h*d);}this.dpr=d;}
 begin(){this.labels=[];this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);this.ctx.clearRect(0,0,this.w,this.h);this.ctx.lineCap='round';this.ctx.lineJoin='round';}
 world(bounds,padding=36){
  const [xmin,xmax,ymin,ymax]=bounds,scale=Math.min((this.w-2*padding)/Math.max(.01,xmax-xmin),(this.h-2*padding)/Math.max(.01,ymax-ymin));
  const target={cx:(xmin+xmax)/2,cy:(ymin+ymax)/2,scale:Math.max(1,scale)};
  if(!this.camera||this.snap)this.camera=target;
  else for(const key of ['cx','cy','scale'])this.camera[key]+=(target[key]-this.camera[key])*.22;
  this.snap=false;const c=this.camera;
  return {x:x=>this.w/2+(x-c.cx)*c.scale,y:y=>this.h/2-(y-c.cy)*c.scale,scale:c.scale};
 }
 line(x1,y1,x2,y2,color='#586775',width=1.5){const c=this.ctx;c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();}
 text(text,x,y,color='#b6c0cd',size=13,align='center'){const c=this.ctx;c.fillStyle=color;c.font=`${size}px system-ui,sans-serif`;c.textAlign=align;c.textBaseline='middle';c.fillText(String(text),x,y);const m=c.measureText(String(text));this.labels.push({text:String(text),x:x-m.actualBoundingBoxLeft,y:y-m.actualBoundingBoxAscent,width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});}
 circle(x,y,r,color='#8ab9ff'){const c=this.ctx;c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();}
 spring(x1,y1,x2,y2,color='#8a9eae',amplitude=9){const dx=x2-x1,dy=y2-y1,length=Math.hypot(dx,dy),ux=dx/(length||1),uy=dy/(length||1),c=this.ctx;c.strokeStyle=color;c.lineWidth=2;c.beginPath();c.moveTo(x1,y1);for(let i=0;i<=24;i++){const a=i===0||i===24?0:(i%2?amplitude:-amplitude),s=.1+.8*i/24;c.lineTo(x1+dx*s-uy*a,y1+dy*s+ux*a);}c.lineTo(x2,y2);c.stroke();}
 arrow(x1,y1,x2,y2,color='#e7b985',width=2){this.line(x1,y1,x2,y2,color,width);const a=Math.atan2(y2-y1,x2-x1);this.line(x2,y2,x2-8*Math.cos(a-.5),y2-8*Math.sin(a-.5),color,width);this.line(x2,y2,x2-8*Math.cos(a+.5),y2-8*Math.sin(a+.5),color,width);}
}
