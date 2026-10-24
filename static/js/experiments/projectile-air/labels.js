// Canvas labels use lowered small subscripts while retaining one collision box.
function runs(text,size){
 const out=[];let start=0;for(const m of String(text).matchAll(/([vF])_(0?[xy]|D|L)/g)){
  if(m.index>start)out.push({text:text.slice(start,m.index),size,lower:0});
  out.push({text:m[1],size,lower:0},{text:m[2],size:size*.7,lower:size*.3});start=m.index+m[0].length;
 }
 if(start<text.length)out.push({text:text.slice(start),size,lower:0});return out;
}
export function labelWidth(ctx,text,size=12){
 return runs(String(text),size).reduce((width,r)=>{ctx.font=`${r.size}px system-ui,sans-serif`;return width+(ctx.measureText(r.text).width||r.text.length*r.size*.55);},0);
}
export function label(stage,text,x,y,color,size=12,align='center'){
 text=String(text);if(!/[vF]_(0?[xy]|D|L)/.test(text)){stage.text(text,x,y,color,size,align);return;}
 const ctx=stage.ctx,width=labelWidth(ctx,text,size),left=x-(align==='left'?0:align==='right'?width:width/2);
 ctx.save();ctx.fillStyle=color;ctx.textAlign='left';ctx.textBaseline='middle';let cursor=left;
 for(const r of runs(text,size)){ctx.font=`${r.size}px system-ui,sans-serif`;ctx.fillText(r.text,cursor,y+r.lower);cursor+=ctx.measureText(r.text).width||r.text.length*r.size*.55;}
 ctx.restore();stage.labels?.push({text,x:left,y:y-size*.75,width,height:size*1.4});
}
