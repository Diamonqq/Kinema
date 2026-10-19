// Small, fixed label lanes for analytical relativity experiments. Units belong to
// the model; projected apparatus is never used as a numeric measuring instrument.
export const C={blue:'#8bbcf5',teal:'#8dcbb6',warm:'#dfb58b',ink:'#e3e7ed',muted:'#929da9',line:'#485461',red:'#dc9295'};
export function line(c,x1,y1,x2,y2,color=C.line,width=1.5,dash=[]){c.save();c.strokeStyle=color;c.lineWidth=width;c.setLineDash(dash);c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();c.restore()}
export function text(c,s,x,y,{color=C.ink,size=14,align='left',bold=false}={}){c.save();c.fillStyle=color;c.font=`${bold?'600 ':''}${size}px system-ui, sans-serif`;c.textAlign=align;c.textBaseline='middle';c.fillText(String(s),x,y);c.restore()}
export function dot(c,x,y,r=7,color=C.blue){c.save();c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,2*Math.PI);c.fill();c.restore()}
export function arrow(c,x,y,dx,dy,color=C.blue){const m=Math.hypot(dx,dy);if(m<.5)return;line(c,x,y,x+dx,y+dy,color,2);const a=Math.atan2(dy,dx);line(c,x+dx,y+dy,x+dx-8*Math.cos(a-.43),y+dy-8*Math.sin(a-.43),color,2);line(c,x+dx,y+dy,x+dx-8*Math.cos(a+.43),y+dy-8*Math.sin(a+.43),color,2)}
export function path(c,points,color=C.blue,width=2,dash=[]){if(!points.length)return;c.save();c.strokeStyle=color;c.lineWidth=width;c.setLineDash(dash);c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();c.restore()}
export function rect(c,x,y,w,h,color=C.line,r=5){c.save();c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();c.restore()}
export function ship(c,x,y,color=C.blue,scale=1,angle=0){c.save();c.translate(x,y);c.rotate(angle);c.scale(scale,scale);c.fillStyle=color;c.beginPath();c.moveTo(17,0);c.quadraticCurveTo(6,-10,-14,-8);c.lineTo(-10,0);c.lineTo(-14,8);c.quadraticCurveTo(6,10,17,0);c.fill();dot(c,2,0,3,'#293847');c.restore()}
export function title(c,w,label,note=''){const tight=label.length*8+(note?note.length*7+20:0)>w-36;text(c,label,18,23,{size:tight?13:15,bold:true});if(note&&w>=350)text(c,note,w-18,tight?43:23,{size:12,color:C.muted,align:'right'})}
export function frame(w,h){return {left:42,right:w-22,top:w<350?43:55,bottom:h-62,w:w-64,h:h-(w<350?105:117)}}
export function axes(c,f,xlabel,ylabel){line(c,f.left,f.bottom,f.right,f.bottom);line(c,f.left,f.bottom,f.left,f.top);text(c,xlabel,f.right,f.bottom+24,{size:12,color:C.muted,align:'right'});text(c,ylabel,f.left+4,f.top-15,{size:12,color:C.muted})}
export function chart(c,w,h,{xmax=1,ymax=1,xlabel='x',ylabel='ct',curves=[],point=null}){const f=frame(w,h),X=x=>f.left+x/xmax*f.w,Y=y=>f.bottom-y/ymax*f.h;axes(c,f,xlabel,ylabel);const number=v=>Math.abs(v)>=100?v.toFixed(0):Math.abs(v)>=10?v.toFixed(1):v.toFixed(2);for(const v of [.25,.5,.75,1]){line(c,X(v*xmax),f.top,X(v*xmax),f.bottom,'#2b333b',1);line(c,f.left,Y(v*ymax),f.right,Y(v*ymax),'#2b333b',1);if(v===.5||v===1){text(c,number(v*xmax),X(v*xmax),f.bottom+12,{size:10,color:C.muted,align:'center'});text(c,number(v*ymax),f.left-5,Y(v*ymax),{size:10,color:C.muted,align:'right'})}}for(const curve of curves)path(c,curve.points.map(([x,y])=>[X(x),Y(y)]),curve.color,curve.width||2,curve.dash||[]);if(point)dot(c,X(point[0]),Y(point[1]),6);return {X,Y,f}}
export function footer(c,w,h,first,second=''){text(c,first,18,h-22,{size:13,color:C.muted});if(second&&w>520)text(c,second,w-18,h-22,{size:13,color:C.muted,align:'right'})}
export function gamma(v){return 1/Math.sqrt(1-v*v)}
export function finite(v){return Number.isFinite(v)?v:0}
export function samples(f,n=100){return Array.from({length:n+1},(_,i)=>f(i/n))}
