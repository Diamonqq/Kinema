import {segmentHitsRect} from '../orbits/scene.js';
// Zoom chips for the collision frames: each chip sits in free space right beside its fixed target point, so no leader
// line is needed. Placement depends only on the frame geometry, never on the live time, so chips stay put in every view.
const hits=(a,b,pad=0)=>a.x<b.x+b.width+pad&&a.x+a.width+pad>b.x&&a.y<b.y+b.height+pad&&a.y+a.height+pad>b.y;
const gapTo=(p,r)=>Math.hypot(p.x-Math.max(r.x,Math.min(r.x+r.width,p.x)),p.y-Math.max(r.y,Math.min(r.y+r.height,p.y)));
// rects: solid keep-outs; segments: drawn lines [x0,y0,x1,y1]; avoid: labels. reach: farthest wanted gap to the target.
export function placeChips(targets,sizes,{width,top,bottom,rects=[],segments=[],avoid=[],reach=40,near=9}){
 const boxes={},placed=[];
 for(const [id,p] of Object.entries(targets)){
  const {w,h}=sizes(id);let pick=null;
  for(const limit of [reach,reach*2,reach*5,1e4]){
   const found=[];
   const x0=Math.max(8,Math.floor(p.x-limit-w)),x1=Math.min(width-8-w,Math.ceil(p.x+limit)),y0=Math.max(top,Math.floor(p.y-limit-h)),y1=Math.min(bottom-h,Math.ceil(p.y+limit));
   for(let y=y0;y<=y1;y+=2)for(let x=x0;x<=x1;x+=2){
    const q={x,y,width:w,height:h},d=gapTo(p,q);if(d<near||d>limit)continue;
    found.push({q,d});
   }
   found.sort((a,b)=>a.d-b.d);
   for(const c of found){
    if(rects.some(o=>hits(c.q,o,4))||avoid.some(a=>hits(c.q,a,4))||placed.some(o=>hits(c.q,o,6)))continue;
    if(segments.some(l=>segmentHitsRect(l[0],l[1],l[2],l[3],c.q,4)))continue;
    pick=c;break;
   }
   if(pick)break;
  }
  const q=pick?.q||{x:Math.min(width-8-w,Math.max(8,p.x+near)),y:Math.min(bottom-h,Math.max(top,p.y-h/2)),width:w,height:h};
  boxes[id]=q;placed.push(q);
 }
 return {boxes};
}
