import {segmentHitsRect} from '../orbits/scene.js';
// Zoom chips for the collision frames: each chip sits in free space right beside its fixed target point, so no leader
// line is needed. Placement depends only on the frame geometry, never on the live time, so chips stay put in every view.
const hits=(a,b,pad=0)=>a.x<b.x+b.width+pad&&a.x+a.width+pad>b.x&&a.y<b.y+b.height+pad&&a.y+a.height+pad>b.y;
const gapTo=(p,r)=>Math.hypot(p.x-Math.max(r.x,Math.min(r.x+r.width,p.x)),p.y-Math.max(r.y,Math.min(r.y+r.height,p.y)));
// rects: solid keep-outs; segments: drawn lines [x0,y0,x1,y1]; avoid: labels. reach: farthest wanted gap to the target.
// Every chip first tries the same fixed anchors beside its target, in a fixed order (prefer[id] overrides it), so the anchor
// is the same in every view whenever it is free; only a blocked anchor falls back to the nearest free spot.
const ANCHORS={e:(p,w,h,g)=>[p.x+g,p.y-h/2],w:(p,w,h,g)=>[p.x-g-w,p.y-h/2],n:(p,w,h,g)=>[p.x-w/2,p.y-g-h],s:(p,w,h,g)=>[p.x-w/2,p.y+g],ne:(p,w,h,g)=>[p.x+g*.6,p.y-g*.6-h],nw:(p,w,h,g)=>[p.x-g*.6-w,p.y-g*.6-h],se:(p,w,h,g)=>[p.x+g*.6,p.y+g*.6],sw:(p,w,h,g)=>[p.x-g*.6-w,p.y+g*.6]};
export function placeChips(targets,sizes,{width,top,bottom,rects=[],segments=[],avoid=[],reach=40,near=9,prefer={},gaps={}}){
 const boxes={},placed=[],anchors={};
 const free=(q)=>!(rects.some(o=>hits(q,o,4))||avoid.some(a=>hits(q,a,4))||placed.some(o=>hits(q,o,6))||segments.some(l=>segmentHitsRect(l[0],l[1],l[2],l[3],q,4)));
 for(const [id,p] of Object.entries(targets)){
  const {w,h}=sizes(id);let pick=null;
  for(const a of prefer[id]||['e','w','n','s','ne','nw','se','sw']){
   const [x,y]=ANCHORS[a](p,w,h,gaps[id]??near+3),q={x:Math.round(x),y:Math.round(y),width:w,height:h};
   if(q.x<8||q.x+w>width-8||q.y<top||q.y+h>bottom)continue;
   if(free(q)){pick={q};anchors[id]=a;break;}
  }
  if(!pick)
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
  boxes[id]=q;placed.push(q);anchors[id]??='nearest';
 }
 return {boxes,anchors};
}
