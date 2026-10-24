import {segmentHitsRect} from '../orbits/scene.js';
// Zoom chips for the collision frames: each chip sits in free space as close as possible to its fixed target
// point, joined by a short straight leader. Placement depends only on the frame geometry, never on the live time.
const hits=(a,b,pad=0)=>a.x<b.x+b.width+pad&&a.x+a.width+pad>b.x&&a.y<b.y+b.height+pad&&a.y+a.height+pad>b.y;
const holds=(r,p)=>p.x>=r.x&&p.x<=r.x+r.width&&p.y>=r.y&&p.y<=r.y+r.height;
const nearestPoint=(p,r)=>({x:Math.max(r.x,Math.min(r.x+r.width,p.x)),y:Math.max(r.y,Math.min(r.y+r.height,p.y))});
export function placeChips(targets,sizes,{width,top,bottom,obstacles,avoid=[],gap=8}){
 const boxes={},leaders={},placed=[];
 for(const [id,p] of Object.entries(targets)){
  const {w,h}=sizes(id),candidates=[];
  for(let y=top;y<=bottom-h;y+=4)for(let x=8;x<=width-8-w;x+=4){
   const q={x,y,width:w,height:h},n=nearestPoint(p,q),d=Math.hypot(n.x-p.x,n.y-p.y);
   if(d>=16)candidates.push({q,n,d});
  }
  candidates.sort((a,b)=>a.d-b.d);
  const others=obstacles.filter(o=>!holds(o,p));
  const free=c=>!obstacles.some(o=>hits(c.q,o,gap))&&!placed.some(o=>hits(c.q,o.box,6))&&!avoid.some(a=>hits(c.q,a,4));
  const straight=(c,strictPaths)=>!avoid.some(a=>segmentHitsRect(p.x,p.y,c.n.x,c.n.y,a,2))&&!placed.some(o=>segmentHitsRect(p.x,p.y,c.n.x,c.n.y,o.box,2)||segmentHitsRect(o.leader[0],o.leader[1],o.leader[2],o.leader[3],c.q,2))
   &&(!strictPaths||!others.some(o=>segmentHitsRect(p.x,p.y,c.n.x,c.n.y,o,0)));
  let pick=null;
  for(const mode of [2,1,0]){
   for(const c of candidates){if(free(c)&&(mode===0?true:straight(c,mode===2))){pick=c;break;}}
   if(pick)break;
  }
  if(!pick)pick=candidates[0]||{q:{x:8,y:top,width:w,height:h},n:{x:8,y:top}};
  boxes[id]=pick.q;leaders[id]=[p.x,p.y,pick.n.x,pick.n.y];placed.push({box:pick.q,leader:leaders[id]});
 }
 return {boxes,leaders};
}
