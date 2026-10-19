// Exact frame transformations and explicitly bounded leading-order approximations.
// No native force callbacks or replacement mechanics engine are implied.
const TAU=2*Math.PI,C={ink:'#dce5f2',muted:'#8e9caf',grid:'#273244',blue:'#85baff',teal:'#85d5bd',sand:'#e8bc84',red:'#f09e9e'};
export const rotate=(v,a)=>[v[0]*Math.cos(a)-v[1]*Math.sin(a),v[0]*Math.sin(a)+v[1]*Math.cos(a)];
export function turntable(t,p){const r=p.r,w=p.omega,m=p.m,a=-w*t,q=rotate([r,0],a),v=[w*q[1],-w*q[0]],cent=q.map(x=>m*w*w*x),cor=q.map(x=>-2*m*w*w*x);return{t,q,v,cent,cor,net:q.map(x=>-m*w*w*x),lab:[r,0],speed:w*r}}
export function release(t,p){const a=p.a,w=p.omega,lab=[a,a*w*t],q=rotate(lab,-w*t),r=Math.hypot(...q),theta=Math.atan(w*t)-w*t,v=rotate([0,a*w],-w*t).map((x,i)=>x+(i===0?w*q[1]:-w*q[0]));return{t,lab,q,r,theta,v,cent:q.map(x=>w*w*x),cor:[2*w*v[1],-2*w*v[0]]}}
export function unwinding(t,p){const R=p.R,w=p.omega,ccw=p.direction>0,d=R*w*t,angle=ccw?2*w*t:0,contact=rotate([0,R],angle),lab=rotate([d,R],angle),tension=ccw?4*p.m*w*w*d:0;return{t,d,rate:R*w,contact,lab,angle,tension,tensionVector:rotate([-tension,0],angle),frame:[d,R],wheelAngle:(ccw?1:-1)*w*t,cent:[4*p.m*w*w*d,4*p.m*w*w*R],cor:[0,-4*p.m*w*w*R]}}
export function hoop(t,p){const r=p.r,R=r*p.ratio,mu=.65**2*R**3/3,held=Math.sqrt(mu/(r*R*R)),free=Math.sqrt(3*mu/R**3),amp=p.angle*Math.PI/180;return{t,r,R,mu,held,free,thetaHeld:amp*Math.cos(held*t),thetaFree:amp*Math.cos(free*t),omegaHeld:held,omegaFree:free,frequencyHeld:held/TAU,frequencyFree:free/TAU}}
export function below(t,p){const g=9.81,w=7.292115e-5,Re=6.371e6,lat=p.latitude*Math.PI/180,T=Math.sqrt(2*p.height/g),tt=Math.min(t,T),east=w*g*Math.cos(lat)*tt**3/3,down=.5*g*tt*tt,tilt=Math.atan2(w*w*Re*Math.sin(lat)*Math.cos(lat),g-w*w*Re*Math.cos(lat)**2);return{t:tt,T,east,down,height:p.height,tilt,latitude:lat,plumbOffset:p.height*Math.tan(tilt)}}
function text(c,s,x,y,color=C.ink,align='left'){c.fillStyle=color;c.textAlign=align;const w=c.__chapterWidth||1000,room=align==='right'?x-6:align==='center'?2*Math.min(x-6,w-x-6):w-x-6;c.font='11px system-ui';const measured=c.measureText(s).width;if(measured>room)c.font=`${Math.max(8.5,11*room/measured)}px system-ui`;c.fillText(s,x,y)}
function line(c,a,b,col=C.muted,width=1,dash=[]){c.strokeStyle=col;c.lineWidth=width;c.setLineDash(dash);c.beginPath();c.moveTo(...a);c.lineTo(...b);c.stroke();c.setLineDash([])}
function dot(c,p,r,col=C.blue){c.fillStyle=col;c.beginPath();c.arc(...p,r,0,TAU);c.fill()}
function arrow(c,a,b,col){line(c,a,b,col,2);const th=Math.atan2(b[1]-a[1],b[0]-a[0]),l=6;c.fillStyle=col;c.beginPath();c.moveTo(...b);c.lineTo(b[0]-l*Math.cos(th-.5),b[1]-l*Math.sin(th-.5));c.lineTo(b[0]-l*Math.cos(th+.5),b[1]-l*Math.sin(th+.5));c.closePath();c.fill()}
function path(c,points,col,width=1.5,dash=[]){if(!points.length)return;c.strokeStyle=col;c.lineWidth=width;c.setLineDash(dash);c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke();c.setLineDash([])}
function disk(c,O,R,angle){c.fillStyle='#111c2b';c.beginPath();c.arc(...O,R,0,TAU);c.fill();c.strokeStyle='#4c627d';c.lineWidth=2;c.stroke();for(let i=0;i<4;i++){const a=angle+i*Math.PI/2;line(c,O,[O[0]+R*Math.cos(a),O[1]-R*Math.sin(a)],C.grid,1)}dot(c,O,4,'#7593ad');for(let i=0;i<4;i++){const a=angle+i*Math.PI/2+.4;dot(c,[O[0]+.18*R*Math.cos(a),O[1]-.18*R*Math.sin(a)],1.7,C.muted)}}
function mapScene(w,h,bound,{zoom=1}={}){const scale=Math.min((w-34)/(2*bound),(h-42)/(2*bound))*zoom,O=[w/2,(h+17)/2];return{scale,O,P:q=>[O[0]+q[0]*scale,O[1]-q[1]*scale]}}
function puck(c,P){c.fillStyle='#122438';c.beginPath();c.ellipse(P[0],P[1]+3,8,4,0,0,TAU);c.fill();dot(c,P,6,C.blue);dot(c,[P[0]-1.5,P[1]-1.5],2,'#d6e9ff')}
function tableDraw(c,z,id){const{width:w,height:h,t,params:p,view,state:s,breakdown}=z,lab=view==='lab',force=view==='forces',isRelease=id==='10.6';const bound=isRelease?Math.max(p.a*1.65,s.r*1.16):p.r*1.65,M=mapScene(w,h,bound),P=M.P;
 text(c,lab?'Lab frame':force?'Rotating-frame forces':'Turntable frame',12,15);
 const radius=isRelease?p.a*1.35:p.r*1.4;disk(c,M.O,radius*M.scale,lab?p.omega*t:0);
 const q=lab?s.lab:s.q;line(c,M.O,P(q),C.grid,1,[3,3]);
 if(isRelease){const pts=Array.from({length:101},(_,i)=>{const tt=t*i/100;return P(lab?release(tt,p).lab:release(tt,p).q)});path(c,pts,C.blue,1.6);dot(c,P([p.a,0]),3,C.teal)}
 else if(!lab){path(c,Array.from({length:81},(_,i)=>P(turntable(TAU/p.omega*i/80,p).q)),C.blue,1,[3,3])}
 puck(c,P(q));
 if((breakdown||force)&&!lab){const norm=isRelease?Math.max(.01,p.omega*p.omega*bound*2):2*p.m*p.omega*p.omega*p.r,sc=.29*Math.min(w,h)/norm;const A=P(q);arrow(c,A,[A[0]+s.cent[0]*sc,A[1]-s.cent[1]*sc],C.sand);arrow(c,A,[A[0]+s.cor[0]*sc,A[1]-s.cor[1]*sc],C.teal);text(c,isRelease?'centrifugal / m':'centrifugal',12,h-25,C.sand);text(c,isRelease?'Coriolis / m':'Coriolis',12,h-10,C.teal)}
 if(lab)text(c,isRelease?'Straight tangent; no horizontal force':'Puck still; surface slips beneath',12,h-10,C.muted);
 }
function stringDraw(c,z){const{width:w,height:h,t,params:p,view,state:s,breakdown}=z,frame=view==='frame',close=view==='tangent';const bound=p.R*2.25,M=mapScene(w,h,bound),P=M.P,angle=frame?0:s.angle,ball=frame?s.frame:s.lab,contact=rotate([0,p.R],angle);
 text(c,frame?'Frame rotating at 2ω':close?'Straight free string':'Lab frame',12,15);
 disk(c,M.O,p.R*M.scale,frame&&p.direction>0?s.wheelAngle-2*p.omega*t:s.wheelAngle);
 // Remaining wraps are attached to wheel; the free segment is exactly tangent.
 for(let k=0;k<2;k++){const rr=p.R*M.scale-k*2.3;c.strokeStyle=k?'#77879a':C.sand;c.lineWidth=1;c.beginPath();c.arc(...M.O,rr,0,TAU);c.stroke()}
 const trace=Array.from({length:101},(_,i)=>{const q=unwinding(t*i/100,p);return P(frame?q.frame:q.lab)});path(c,trace,C.blue,1,[3,3]);line(c,P(contact),P(ball),C.sand,2.4);dot(c,P(contact),3,C.teal);puck(c,P(ball));
 if(breakdown||close){const A=P(ball),T=frame?[-s.tension,0]:s.tensionVector,scale=.5*p.R*M.scale/Math.max(1,4*p.m*p.omega*p.omega*p.R*1.6);arrow(c,A,[A[0]+T[0]*scale,A[1]-T[1]*scale],C.red);text(c,'Tension (real)',12,h-25,C.red);text(c,'d = Rωt',12,h-10,C.sand)}
 else text(c,p.direction>0?'CCW: taut string bends the path':'CW: zero tension, straight flight',12,h-10,C.muted);
 }
function hoopDraw(c,z){const{width:w,height:h,view,state:s,breakdown}=z,one=view!=='compare',held=view==='held',n=one?1:2,rr=Math.min((w-32)/(n*2.7),(h-56)/2.4),y=(h+5)/2;
 text(c,one?(held?'Held hoop':'Freely falling hoop frame'):'Held vs freely falling',12,15);
 for(let i=0;i<n;i++){const x=one?w*.43:w*(i?.74:.26),th=one?(held?s.thetaHeld:s.thetaFree):(i?s.thetaFree:s.thetaHeld),O=[x,y],P=[x+rr*Math.cos(th),y-rr*Math.sin(th)];c.strokeStyle='#697f98';c.lineWidth=3;c.beginPath();c.arc(...O,rr,0,TAU);c.stroke();line(c,O,[x+rr,y],C.grid,1,[3,3]);puck(c,P);dot(c,O,2,C.muted);if(breakdown){const tangent=[-Math.sin(th),Math.cos(th)],F=-(one?(held?1:.45):(i?.45:1))*Math.sin(th),l=rr*2;arrow(c,P,[P[0]+tangent[0]*F*l,P[1]-tangent[1]*F*l],C.teal)}text(c,one?'':i?'Falling':'Held',x,h-12,C.muted,'center')}
 if(one){const x=w-20;dot(c,[x,y],5,C.sand);text(c,'M',x,y-13,C.sand,'center');line(c,[w*.43+rr+8,y],[x-8,y],C.grid,1,[3,3]);text(c,'R ≫ r',w*.67,y+20,C.muted,'center')}
 }
function belowDraw(c,z){const{width:w,height:h,params:p,view,state:s,breakdown}=z;
 if(view==='earth'){const R=Math.min((h-48)*.45,(w-35)*.45),O=[w/2,(h+20)/2];dot(c,O,R,'#15283a');c.strokeStyle='#45667d';c.lineWidth=1;c.beginPath();c.arc(...O,R,0,TAU);c.stroke();line(c,[O[0],O[1]-R-6],[O[0],O[1]+R+6],C.muted,1,[3,3]);const P=[O[0]+R*Math.cos(s.latitude),O[1]-R*Math.sin(s.latitude)];line(c,O,P,C.blue,2);dot(c,P,5,C.blue);text(c,'Radial direction',12,15);text(c,'Real Earth gravity need not be radial',12,h-10,C.muted);return}
 const top=32,bottom=h-35,X=w*.38,drop=view==='drop',scale=(bottom-top)/p.height;line(c,[18,bottom],[w-15,bottom],C.muted,2);dot(c,[X,top],6,C.blue);line(c,[X,top],[X,bottom],C.blue,1,[3,3]);
 const extent=drop?Math.max(.001,below(s.T,p).east):Math.max(.001,s.plumbOffset),exaggerate=(w*.35)/extent;
 const offset=drop?s.east:s.plumbOffset;line(c,[X,top],[X+(drop?0:s.plumbOffset*exaggerate),bottom],C.teal,2,[4,3]);
 if(drop){const points=Array.from({length:61},(_,i)=>{const q=below(s.T*i/60,p);return[X+q.east*exaggerate,top+q.down*scale]});path(c,points,C.sand,1,[3,3]);puck(c,[X+offset*exaggerate,top+s.down*scale]);text(c,'East →',w-14,bottom+19,C.sand,'right')}
 else{dot(c,[X+s.plumbOffset*exaggerate,bottom],4,C.teal);text(c,'Radial',Math.max(10,X-44),bottom+18,C.blue);text(c,'Plumb',w-12,bottom+18,C.teal,'right')}
 text(c,drop?'Dropped object: local approximation':'Different meanings of below',12,15);text(c,'Horizontal separation enlarged',12,h-5,C.muted);
 }
export function createExperiment(spec){const id=spec.id,fn={'10.1':below,'10.5':turntable,'10.6':release,'10.11':unwinding,'10.14':hoop}[id];if(!fn)throw Error('Unknown Chapter 10 source-bound experiment');return{duration:p=>id==='10.1'?below(0,p).T:id==='10.5'?TAU/p.omega:id==='10.6'?4/p.omega:id==='10.11'?1.6/p.omega:TAU/.65,evaluate:fn,describe(s,p){if(id==='10.1')return `Drop time ${s.t.toFixed(2)} s; east shift ${s.east.toFixed(3)} m. Spherical-Earth local approximation; horizontal separation enlarged.`;if(id==='10.5')return `Rotating-frame speed ${s.speed.toFixed(2)} m/s. Outward ${Math.hypot(...s.cent).toFixed(2)} N; inward Coriolis ${Math.hypot(...s.cor).toFixed(2)} N.`;if(id==='10.6')return `r=${s.r.toFixed(2)} m; θ=${s.theta.toFixed(3)} rad. Exact rotating coordinates of inertial straight flight.`;if(id==='10.11')return `Free string ${s.d.toFixed(2)} m; growth ${s.rate.toFixed(2)} m/s; tension ${s.tension.toFixed(2)} N.`;return `Held f=${s.frequencyHeld.toFixed(3)} Hz; falling f=${s.frequencyFree.toFixed(3)} Hz. Leading small-angle, r/R approximation.`},draw(c,z){c.__chapterWidth=z.width;if(id==='10.1')belowDraw(c,z);else if(id==='10.11')stringDraw(c,z);else if(id==='10.14')hoopDraw(c,z);else tableDraw(c,z,id)}}}
