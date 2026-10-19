// Five exact Chapter 1 experiments. Pure SI/nondimensional models are exported
// separately from drawing so the physics can be checked without canvas or DOM.
const G=6.67430e-11,EARTH_M=5.9722e24,EARTH_R=6.371e6,g=9.8;
const C={ink:'#dce5f2',muted:'#8495ac',blue:'#85baff',teal:'#85d5bd',sand:'#e8bc84',rose:'#f29b9f',grid:'#273244',steel:'#8795a8'};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function rk4(y,h,f){const a=f(y),b=f(y.map((v,i)=>v+h*a[i]/2)),c=f(y.map((v,i)=>v+h*b[i]/2)),d=f(y.map((v,i)=>v+h*c[i]));return y.map((v,i)=>v+h*(a[i]+2*b[i]+2*c[i]+d[i])/6)}
export function damping(t,p){
 const n=p.n,m=p.mass,V=p.initial,b=p.drag,t0=m/(b*V**(n-1)),s=Math.max(0,t)/t0;
 let v,x;
 if(n===0){const u=Math.min(s,1);v=V*(1-u);x=V*t0*(u-u*u/2)}
 else if(n===1){v=V*Math.exp(-s);x=V*t0*(-Math.expm1(-s))}
 else {const z=1+(n-1)*s;v=V*z**(-1/(n-1));x=n===2?V*t0*Math.log1p(s):V*t0*(z**((n-2)/(n-1))-1)/(n-2)}
 return {t,v,x,t0,stopTime:n<1?t0:Infinity,stopDistance:n<2?m*V**(2-n)/(b*(2-n)):Infinity};
}
export function projectile(t,p){const a=p.angle*Math.PI/180,vx=p.speed*Math.cos(a),vy=p.speed*Math.sin(a),flight=(vy+Math.sqrt(vy*vy+2*g*p.height))/g,T=clamp(t,0,flight),range=vx*flight,maxRange=p.speed/g*Math.sqrt(p.speed*p.speed+2*g*p.height);return {t:T,x:vx*T,y:Math.max(0,p.height+vy*T-g*T*T/2),vx,vy:vy-g*T,flight,range,maxRange,angle:Math.atan(p.speed/Math.sqrt(p.speed*p.speed+2*g*p.height))};}
export function wave(t,p){const c=Math.sqrt(p.bulk*1e9/p.density);return {t,c,front:c*t,wavelength:1,amplitude:.006,frequency:c}}
const tubeCache=new Map();
export function tubeSolution(q,step=.001){
 const key=`${q}:${step}`;if(tubeCache.has(key))return tubeCache.get(key);
 const f=([u,a,phi,w])=>[a,u*w*w+Math.sin(phi),w,((.5+q*u)*Math.cos(phi)-2*q*u*a*w)/(1/3+q*u*u)];
 let y=[0,0,0,0],tau=0;const poses=[{tau,y:[...y]}];
 while(y[2]<Math.PI/2&&tau<6){const next=rk4(y,step,f);if(next[2]>=Math.PI/2){let lo=0,hi=step;for(let k=0;k<34;k++){const mid=(lo+hi)/2;if(rk4(y,mid,f)[2]<Math.PI/2)lo=mid;else hi=mid}const dt=(lo+hi)/2;tau+=dt;y=rk4(y,dt,f);y[2]=Math.PI/2}else{tau+=step;y=next}poses.push({tau,y:[...y]})}
 const result={poses,tau,eta:y[0]};tubeCache.set(key,result);if(tubeCache.size>16)tubeCache.delete(tubeCache.keys().next().value);return result;
}
export function tube(t,p){const solution=tubeSolution(p.ratio),tau=clamp(t*Math.sqrt(g/p.length),0,solution.tau),i=Math.min(solution.poses.length-2,Math.floor(tau/.001)),a=solution.poses[i],b=solution.poses[i+1],z=clamp((tau-a.tau)/(b.tau-a.tau),0,1),y=a.y.map((v,k)=>v+z*(b.y[k]-v));return {t:tau*Math.sqrt(p.length/g),tau,r:y[0]*p.length,u:y[0],phi:y[2],omega:y[3]*Math.sqrt(g/p.length),speed:y[1]*Math.sqrt(g*p.length),eta:solution.eta,finish:solution.tau*Math.sqrt(p.length/g),length:p.length,ratio:p.ratio};}
const escapeCache=new Map();
export function escape(t,p){
 const mu=G*EARTH_M*p.mass,R=EARTH_R*p.radius,T=Math.sqrt(R**3/mu),tau=clamp(t/T,0,6),key=String(p.launch);
 if(!escapeCache.has(key)){let y=[1,Math.SQRT2*p.launch];const states=[y];let landed=false;for(let j=1;j<=3001;j++){if(!landed){const next=rk4(y,.002,([r,v])=>[v,-1/(r*r)]);if(next[0]<1&&next[1]<0){y=[1,0];landed=true}else y=next}states.push([...y])}escapeCache.set(key,states);if(escapeCache.size>25)escapeCache.delete(escapeCache.keys().next().value)}
 const i=Math.min(2999,Math.floor(tau/.002)),z=tau/.002-i,states=escapeCache.get(key),r=states[i][0]*(1-z)+states[i+1][0]*z,v=states[i][1]*(1-z)+states[i+1][1]*z;
 return {t,r:r*R,radius:R,rRatio:r,maxRatio:Math.max(...states.map(y=>y[0])),v:v*Math.sqrt(mu/R),escapeSpeed:Math.sqrt(2*mu/R),T,energy:(p.launch*p.launch-1)*mu/R,mu,landed:r<=1.000001&&v===0};
}

function text(c,s,x,y,color=C.ink,size=13,align='left'){c.fillStyle=color;c.font=`${size}px system-ui,sans-serif`;c.textAlign=align;c.fillText(s,x,y);c.textAlign='left'}
function line(c,x1,y1,x2,y2,color=C.grid,width=1){c.beginPath();c.strokeStyle=color;c.lineWidth=width;c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke()}
function dot(c,x,y,r,color){const a=c.createRadialGradient(x-r*.35,y-r*.4,0,x,y,r);a.addColorStop(0,color);a.addColorStop(1,'#34455f');c.fillStyle=a;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();c.strokeStyle=color;c.lineWidth=1;c.stroke()}
function arrow(c,x,y,dx,dy,color){line(c,x,y,x+dx,y+dy,color,2);const a=Math.atan2(dy,dx);line(c,x+dx,y+dy,x+dx-8*Math.cos(a-.4),y+dy-8*Math.sin(a-.4),color,2);line(c,x+dx,y+dy,x+dx-8*Math.cos(a+.4),y+dy-8*Math.sin(a+.4),color,2)}
function path(c,points,color,width=2){if(!points.length)return;c.beginPath();c.strokeStyle=color;c.lineWidth=width;points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke()}
function axes(c,{x,y,w,h,xmax,ymax,xlabel,ylabel,xmin=0,ymin=0,decimals=1}){
 const X=v=>x+(v-xmin)/(xmax-xmin)*w,Y=v=>y+h-(v-ymin)/(ymax-ymin)*h;
 const ticks=h<100?2:4;for(let k=0;k<=ticks;k++){const a=xmin+(xmax-xmin)*k/ticks,b=ymin+(ymax-ymin)*k/ticks;line(c,X(a),y,X(a),y+h);line(c,x,Y(b),x+w,Y(b));text(c,Number(a.toFixed(decimals)),X(a),y+h+18,C.muted,11,'center');text(c,Number(b.toFixed(decimals)),x-7,Y(b)+4,C.muted,11,'right')}
 line(c,x,y+h,x+w,y+h,C.steel);line(c,x,y,x,y+h,C.steel);text(c,xlabel,x+w,y+h+36,C.ink,12,'right');text(c,ylabel,x,y-12,C.ink,12);return {X,Y,x,y,w,h};
}
function banner(c,w,title,sub){text(c,title,17,25,C.ink,w<350?13:16);if(sub)text(c,sub,17,46,C.muted,w<350?11:12)}
function plot(c,a,fn,color=C.blue){const pts=[];for(let i=0;i<=180;i++){const x=a.xmin+(a.xmax-a.xmin)*i/180,y=fn(x);if(Number.isFinite(y))pts.push([a.X(x),a.Y(y)])}path(c,pts,color)}
function graph(c,box,fn,{xmax,ymax,xlabel,ylabel,xmin=0,ymin=0,color=C.blue,decimals=1}){const a=axes(c,{...box,xmin,xmax,ymin,ymax,xlabel,ylabel,decimals});a.xmin=xmin;a.xmax=xmax;c.save();c.beginPath();c.rect(box.x,box.y,box.w,box.h);c.clip();plot(c,a,fn,color);c.restore();return a}

function drawDamping(c,o){const {width:w,height:h,state:s,params:p,view,breakdown}=o;
 const tail=view==='tail',distance=view==='distance',end=10*s.t0,xmax=tail?50*s.t0:end,ymax=distance?damping(end,p).x*1.15:tail?p.initial*.12:p.initial*1.1;
 banner(c,w,distance?'Distance accumulates':tail?'The slow tail':w<350?'A slowing particle':'How does the particle slow?',`n = ${p.n} · m = ${p.mass} kg · V = ${p.initial} m/s`);
 const track=view==='setup'&&h>=240,top=track?112:h<220?68:82,bottom=h<220?40:51;
 if(track){const left=26,right=w-26,scale=(right-left)/Math.max(damping(end,p).x,1);line(c,left,78,right,78,C.steel,2);dot(c,left+s.x*scale,78,7,C.blue);text(c,'0',left,99,C.muted,11);text(c,`x = ${s.x.toFixed(2)} m`,right,99,C.blue,12,'right')}
 const a=graph(c,{x:49,y:top,w:w-70,h:h-top-bottom},t=>distance?damping(t,p).x:damping(t,p).v,{xmax,ymax,xlabel:'Time t (s)',ylabel:distance?'Distance x (m)':'Speed v (m/s)',xmin:tail?5*s.t0:0});
 const xx=clamp(s.t,tail?5*s.t0:0,xmax),yy=distance?s.x:s.v;if(s.t>=a.xmin&&yy<=ymax)dot(c,a.X(xx),a.Y(yy),4,C.sand);
 if(breakdown){const info=distance?(Number.isFinite(s.stopDistance)?`Limit: ${s.stopDistance.toFixed(2)} m`:'Total distance diverges'):(Number.isFinite(s.stopTime)?`Rest at ${s.stopTime.toFixed(2)} s`:'Rest is approached asymptotically');text(c,info,w-16,view==='setup'?43:61,C.teal,12,'right')}
}
function drawTube(c,o){const {width:w,height:h,state:s,params:p,view,breakdown}=o;
 banner(c,w,view==='scaling'?(w<350?'Compare tube lengths':'Does length change the fraction?'):(w<350?'A mass in a falling tube':'A mass slides as its tube falls'),`ℓ = ${p.length.toFixed(2)} m · m/M = ${p.ratio.toFixed(2)}`);
 if(view==='scaling'){const solution=tubeSolution(p.ratio),a=graph(c,{x:47,y:h<220?68:78,w:w-67,h:h-(h<220?108:132)},tau=>{const t=tau*Math.sqrt(p.length/g);return tube(t,p).u},{xmax:solution.tau,ymax:.52,xlabel:'Scaled time τ = t√(g/ℓ)',ylabel:'Fraction r/ℓ'});dot(c,a.X(s.tau),a.Y(s.u),5,C.sand);return}
 const close=view==='closeup',L=Math.min(w*.72,h-(h<220?100:115)),ox=close?w*.45-Math.cos(s.phi)*s.u*L:w*.15,oy=close?h*.47-Math.sin(s.phi)*s.u*L:63,ex=ox+L*Math.cos(s.phi),ey=oy+L*Math.sin(s.phi);
 // Camera close-up transforms geometry uniformly; no body sizes are changed.
 const zoom=close?1.65:1,tx=x=>w/2+(x-w/2)*zoom,ty=y=>h*.54+(y-h*.54)*zoom;
 c.save();c.beginPath();c.rect(8,45,w-16,h-70);c.clip();
 line(c,tx(ox),ty(oy),tx(ex),ty(ey),'#465366',16*zoom);line(c,tx(ox),ty(oy),tx(ex),ty(ey),'#a3b2c4',11*zoom);line(c,tx(ox),ty(oy),tx(ex),ty(ey),'#1a2637',7*zoom);
 const bx=ox+s.u*L*Math.cos(s.phi),by=oy+s.u*L*Math.sin(s.phi);dot(c,tx(bx),ty(by),6*zoom,C.blue);
 c.fillStyle='#69788c';c.fillRect(tx(ox)-16*zoom,ty(oy)-16*zoom,32*zoom,12*zoom);dot(c,tx(ox),ty(oy),4*zoom,C.sand);
 if(breakdown){arrow(c,tx(bx),ty(by)+12,0,42,C.rose);text(c,'mg',tx(bx)+8,ty(by)+49,C.rose,12);c.strokeStyle=C.sand;c.lineWidth=1;c.beginPath();c.arc(tx(ox),ty(oy),30*zoom,0,s.phi);c.stroke()}
 c.restore();const footer=h<220?h-14:h-34;text(c,`Angle: ${(s.phi*180/Math.PI).toFixed(1)}°`,17,footer,C.muted,12);text(c,`r/ℓ = ${s.u.toFixed(3)}`,w-17,footer,C.blue,13,'right');if(h>=220)text(c,w<350?(close?'Following the sliding mass':'Uniform tube · released from rest'):(close?'Close-up follows the mass; tube ends may be off screen.':'Uniform tube · point mass · released from rest'),17,h-14,C.muted,w<350?10:11);
}
function drawWave(c,o){const {width:w,height:h,state:s,params:p,view,breakdown}=o;
 banner(c,w,w<350?'A travelling disturbance':'A disturbance moves; fluid stays local',`c = ${s.c.toFixed(0)} m/s · front = ${Math.min(4,s.front).toFixed(2)} m`);
 if(view==='scaling'){const a=graph(c,{x:49,y:h<220?68:80,w:w-70,h:h-(h<220?108:135)},rho=>Math.sqrt(p.bulk*1e9/rho),{xmin:500,xmax:2000,ymax:3000,xlabel:'Density ρ (kg/m³)',ylabel:'Wave speed c (m/s)',decimals:0});dot(c,a.X(p.density),a.Y(s.c),5,C.sand);return}
 const close=view==='closeup',lo=close?clamp(s.front-.55,0,2.9):0,hi=close?lo+1.1:4,x=35,ww=w-61,Y=h<220?(h+35)/2:h*.39,X=v=>x+(v-lo)/(hi-lo)*ww;
 c.save();c.beginPath();c.rect(x,58,ww,h*.32);c.clip();c.fillStyle='#19283a';c.fillRect(x,Y-25,ww,50);
 for(let i=0;i<=100;i++){const z=i*.04,phase=2*Math.PI*(z-s.front),env=Math.exp(-(((z-s.front)/.6)**2)),u=.006*Math.sin(phase)*env;const px=X(z+u);c.fillStyle=C.blue;c.globalAlpha=.5+.4*Math.cos(phase)*env;c.beginPath();c.arc(px,Y,close?3.5:2.3,0,7);c.fill()}c.globalAlpha=1;
 line(c,x,Y-27,x+ww,Y-27,C.steel,3);line(c,x,Y+27,x+ww,Y+27,C.steel,3);c.restore();
 if(h<220){text(c,`${lo.toFixed(1)} m`,x,h-9,C.muted,11);text(c,`${hi.toFixed(1)} m`,x+ww,h-9,C.muted,11,'right');return}
 text(c,w<350?'Particles move locally':'Particle positions use the lower x scale.',17,Y+45,C.muted,w<350?10:11);
 const plotY=Math.max(125,h*.63),a=graph(c,{x:49,y:plotY,w:w-70,h:Math.max(18,h-plotY-43)},z=>6*Math.sin(2*Math.PI*(z-s.front))*Math.exp(-(((z-s.front)/.6)**2)),{xmin:lo,xmax:hi,ymin:-6,ymax:6,xlabel:'Position x (m)',ylabel:'Particle displacement (mm)'});
 if(breakdown)text(c,'B/ρ has units m²/s²',w-17,65,C.teal,12,'right');
}
function drawEscape(c,o){const {width:w,height:h,state:s,params:p,view,breakdown}=o;
 banner(c,w,'Can the launch escape?',`Launch ${(s.escapeSpeed*p.launch/1000).toFixed(2)} km/s · ${(s.t/60).toFixed(1)} min`);
 if(view==='energy'){const unit=s.mu/s.radius/1e6,a=graph(c,{x:51,y:h<220?68:82,w:w-73,h:h-(h<220?108:140)},r=>-unit/r,{xmin:1,xmax:8,ymin:-unit*1.15,ymax:Math.max(unit*.5,s.energy/1e6*1.2),xlabel:'Radius r/R',ylabel:'Specific energy (MJ/kg)'});line(c,a.X(1),a.Y(s.energy/1e6),a.X(8),a.Y(s.energy/1e6),C.sand);if(h>=220)text(c,'Blue: potential · sand: total',w-16,63,C.muted,11,'right');return}
 const close=view==='closeup',max=s.maxRatio,span=close?2.5:Math.max(max+2,4),scale=close?(w-58)/span:Math.min((w-58)/span,(h-80)/2),cy=h*.58,cx=35,r=scale;
 c.save();c.beginPath();c.rect(10,60,w-20,h-95);c.clip();dot(c,cx,cy,r,C.blue);c.fillStyle='#3f727e';c.beginPath();c.ellipse(cx+r*.1,cy-r*.15,r*.4,r*.23,-.3,0,7);c.fill();
 const surface=cx+r,flight=surface+(s.rRatio-1)*scale;line(c,surface,cy,Math.min(w-20,surface+(Math.max(max,1)-1)*scale),cy,C.steel,1);dot(c,flight,cy,5,C.sand);
 c.restore();text(c,`r/R = ${s.rRatio.toFixed(2)}`,w-18,h-38,C.sand,13,'right');text(c,w<350?(close?'Following the surface':'Radial flight · radius scale R'):(close?'Surface close-up; distant flight may leave this view.':'Planet radius is the length scale. Radial launch; no air.'),17,h-15,C.muted,w<350?10:11);
 if(breakdown)text(c,`Escape threshold ${(s.escapeSpeed/1000).toFixed(2)} km/s`,17,67,C.teal,12);
}
function drawProjectile(c,o){const {width:w,height:h,state:s,params:p,view,breakdown}=o;
 banner(c,w,w<350?'Launch from a cliff':'A cliff, one launch, gravity',`θ = ${p.angle}° · v = ${p.speed} m/s · h = ${p.height} m`);
 if(view==='limits'){const end=20,scale=p.speed/g*Math.sqrt(p.speed*p.speed+2*g*end),a=graph(c,{x:46,y:h<220?68:80,w:w-65,h:h-(h<220?108:135)},height=>p.speed/g*Math.sqrt(p.speed*p.speed+2*g*height),{xmax:end,ymax:scale*1.1,xlabel:'Cliff height h (m)',ylabel:'Maximum range (m)'});dot(c,a.X(p.height),a.Y(s.maxRange),5,C.sand);return}
 const close=view==='closeup',a=p.angle*Math.PI/180,maxH=p.height+p.speed**2*Math.sin(a)**2/(2*g),range=Math.max(s.range,1),x0=36,y0=h-43,scale=Math.min((w-65)/(range+3),(h-108)/(maxH+2)),X=x=>x0+x*scale,Y=y=>y0-y*scale;
 if(close){const ox=43,oy=h*.69,len=Math.min(w*.58,h*.5),dx=len*Math.cos(a),dy=-len*Math.sin(a);line(c,15,oy,w-20,oy,C.steel);line(c,ox,70,ox,h-35,C.steel);dot(c,ox,oy,7,C.sand);arrow(c,ox,oy,dx,dy,C.blue);text(c,'v',ox+dx+8,oy+dy,C.blue,13);if(breakdown){arrow(c,ox,oy,dx,0,C.teal);arrow(c,ox+dx,oy,0,dy,C.rose);text(c,'v cos θ',ox+dx*.5,oy+23,C.teal,12,'center');text(c,'v sin θ',Math.min(w-75,ox+dx+8),oy+dy*.5,C.rose,12)}text(c,`θ = ${p.angle}°`,18,h-15,C.muted,12);return}
 c.fillStyle='#2c3747';c.fillRect(X(-2),Y(p.height),scale*2,p.height*scale);line(c,12,Y(0),w-15,Y(0),C.steel,2);
 const points=[];for(let j=0;j<=120;j++){const z=projectile(j*s.flight/120,p);points.push([X(z.x),Y(z.y)])}path(c,points,C.blue);dot(c,X(s.x),Y(s.y),6,C.sand);
 for(let j=0;j<=4;j++){const xx=range*j/4;line(c,X(xx),Y(0),X(xx),Y(0)+5,C.steel);text(c,xx.toFixed(1),X(xx),Y(0)+20,C.muted,11,'center')}text(c,'Horizontal distance x (m)',w-16,h-5,C.ink,12,'right');text(c,`Height h = ${p.height} m`,18,68,C.muted,12);if(breakdown)text(c,`Best range ${s.maxRange.toFixed(2)} m`,w-17,68,C.teal,12,'right');
}

export function createExperiment(spec){
 const models={escape:{duration:p=>6*escape(0,p).T,evaluate:escape,draw:drawEscape,describe:(s,p)=>`r = ${(s.r/1000).toFixed(0)} km · radial velocity = ${(s.v/1000).toFixed(2)} km/s${s.landed?' · returned to the surface':''}`},tube:{duration:p=>tube(0,p).finish,evaluate:tube,draw:drawTube,describe:s=>`t = ${s.t.toFixed(3)} s · r = ${s.r.toFixed(3)} m · fraction r/ℓ = ${s.u.toFixed(3)}`},fluid:{duration:p=>4/wave(0,p).c,evaluate:wave,draw:drawWave,describe:s=>`Wave speed ${s.c.toFixed(1)} m/s · frequency ${s.frequency.toFixed(1)} Hz · displacement amplitude 6 mm`},damping:{playbackRate:p=>damping(0,p).t0,duration:p=>10*damping(0,p).t0,evaluate:damping,draw:drawDamping,describe:s=>`v = ${s.v.toFixed(4)} m/s · x = ${s.x.toFixed(3)} m · observation time ${s.t.toFixed(2)} s`},projectile:{duration:p=>projectile(0,p).flight,evaluate:projectile,draw:drawProjectile,describe:s=>`x = ${s.x.toFixed(2)} m · y = ${s.y.toFixed(2)} m · landing range ${s.range.toFixed(2)} m`}};
 const model=models[spec.model];if(!model)throw Error('This Chapter 1 experiment is unavailable.');return model;
}
