// Constrained rolling on an oval, valid only while tire grip can supply the turn.
// Loss of grip ends the valid lap; no invented post-slip vehicle dynamics.
const rad=Math.PI/180;
const n=(key,label,symbol,unit,min,max,step,value,group)=>({key,label,symbol,unit,min,max,step,value,group});
const params=[
  n('mass','Car mass','m','kg',100,3000,10,1000,'Car'),
  n('speed','Initial speed','v_0','m/s',0,80,.1,15,'Car'),
  n('drive','Drive / braking force','F_t','N',-15000,15000,10,0,'Car'),
  n('drag','Air resistance coefficient','c','kg/m',0,5,.01,0,'Car'),
  n('rolling','Rolling coefficient','c_r','1',0,.05,.001,0,'Car'),
  n('radius','Corner radius','r','m',5,300,1,50,'Track'),
  n('halfStraight','Half straight length','L','m',0,300,1,50,'Track'),
  n('bank','Corner bank angle','θ','°',0,35,1,20,'Track'),
  n('mu','Tire friction coefficient','μ','1',0,1,.01,.8,'Track'),
  n('gravity','Gravity','g','m/s²',1,25,.01,9.81,'World'),
];
export function resolve(values={}){const p={};for(const d of params){const v=values[d.key]??d.value;if(typeof v!=='number'||!Number.isFinite(v)||v<d.min||v>d.max)throw new RangeError(`Invalid ${d.key}`);p[d.key]=v;}return p;}
export function speedLimits({radius=50,bank=0,mu=.8,gravity=9.81}={}){
  const c=Math.cos(bank*rad),s=Math.sin(bank*rad);
  return {minSpeed:Math.sqrt(Math.max(0,radius*gravity*(s-mu*c)/(c+mu*s))),maxSpeed:Math.sqrt(radius*gravity*(s+mu*c)/(c-mu*s)),idealSpeed:Math.sqrt(radius*gravity*Math.tan(bank*rad))};
}
// Signed f is down the slope / inward. It reverses below the ideal bank speed.
export function curveForces({mass=1000,speed=15,radius=50,bank=0,mu=.8,gravity=9.81,drive=0}={}){
  const theta=bank*rad,c=Math.cos(theta),s=Math.sin(theta),a=Number.isFinite(radius)?speed**2/radius:0;
  const normal=mass*(gravity*c+a*s),lateral=mass*(a*c-gravity*s),capacity=mu*normal;
  const remaining=Math.sqrt(Math.max(0,capacity**2-lateral**2));
  const longitudinal=Math.max(-remaining,Math.min(remaining,drive));
  return {normal,lateral,longitudinal,requestedLongitudinal:drive,friction:Math.hypot(lateral,longitudinal),capacity,remaining,margin:capacity-Math.abs(lateral),grip:Math.abs(lateral)<=capacity+1e-8,inward:normal*s+lateral*c,vertical:normal*c-lateral*s,...speedLimits({radius:Number.isFinite(radius)?radius:0,bank,mu,gravity})};
}
export function trackPoint(distance,{radius:R=50,halfStraight:L=50}={}){
  const length=4*L+2*Math.PI*R;let q=((distance%length)+length)%length,x,y,heading,curvature;
  if(q<L){x=q;y=-R;heading=0;curvature=0;}
  else if(q<L+Math.PI*R){const a=-Math.PI/2+(q-L)/R;x=L+R*Math.cos(a);y=R*Math.sin(a);heading=a+Math.PI/2;curvature=1/R;}
  else if(q<3*L+Math.PI*R){x=L-(q-L-Math.PI*R);y=R;heading=Math.PI;curvature=0;}
  else if(q<3*L+2*Math.PI*R){const a=Math.PI/2+(q-3*L-Math.PI*R)/R;x=-L+R*Math.cos(a);y=R*Math.sin(a);heading=a+Math.PI/2;curvature=1/R;}
  else{x=-L+(q-3*L-2*Math.PI*R);y=-R;heading=2*Math.PI;curvature=0;}
  return {x,y,heading,curvature,length,inward:{x:-Math.sin(heading),y:Math.cos(heading)},tangent:{x:Math.cos(heading),y:Math.sin(heading)}};
}
function create(values={}){
  const p=resolve(values);let t,s,lostGrip,activeTime,firstLapTime,initialEnergy;
  function reset(){t=0;s=[0,p.speed,0,0];lostGrip=false;activeTime=0;firstLapTime=0;initialEnergy=.5*p.mass*p.speed**2;}
  reset();
  function forces(state){const point=trackPoint(state[0],p),bank=point.curvature?p.bank:0;
    const f=curveForces({...p,speed:state[1],radius:point.curvature?p.radius:Infinity,bank});
    const resistance=state[1]>0?p.drag*state[1]**2+p.rolling*f.normal:0;
    const net=f.longitudinal-resistance;
    return {...f,point,bank,resistance,net:state[1]<=0&&net<0?0:net};
  }
  function deriv(state){const f=forces(state),v=Math.max(0,state[1]);return [v,f.net/p.mass,f.resistance*v,f.longitudinal*v];}
  function rk4(state,h){const a=deriv(state),b=deriv(state.map((v,i)=>v+h*a[i]/2)),c=deriv(state.map((v,i)=>v+h*b[i]/2)),d=deriv(state.map((v,i)=>v+h*c[i]));return state.map((v,i)=>v+h*(a[i]+2*b[i]+2*c[i]+d[i])/6);}
  function step(dt){
    if(!Number.isFinite(dt)||dt<0||dt>600)throw new RangeError('dt must be 0..600 s');
    let remaining=dt;const target=t+dt;
    while(remaining>0&&!lostGrip){
      if(!forces(s).grip){lostGrip=true;break;}
      let h=Math.min(.005,remaining),next=rk4(s,h);
      // Locate stopping and loss-of-grip events rather than stepping past them.
      if(next[1]<0){let lo=0,hi=h;for(let i=0;i<35;i++){const mid=(lo+hi)/2;if(rk4(s,mid)[1]>0)lo=mid;else hi=mid;}h=(lo+hi)/2;next=rk4(s,h);next[1]=0;}
      if(!forces(next).grip){let lo=0,hi=h;for(let i=0;i<38;i++){const mid=(lo+hi)/2;if(forces(rk4(s,mid)).grip)lo=mid;else hi=mid;}h=(lo+hi)/2;next=rk4(s,h);lostGrip=true;}
      const length=trackPoint(0,p).length;
      if(!firstLapTime&&s[0]<length&&next[0]>=length){let lo=0,hi=h;for(let i=0;i<35;i++){const mid=(lo+hi)/2;if(rk4(s,mid)[0]<length)lo=mid;else hi=mid;}firstLapTime=activeTime+(lo+hi)/2;}
      s=next;activeTime+=h;remaining-=h;
    }t=target;
  }
  function invariants(){const energy=.5*p.mass*s[1]**2;return {energy,kinetic:energy,dissipatedWork:s[2],driveWork:s[3],accountedEnergy:energy+s[2]-s[3],initialEnergy,energyError:energy+s[2]-s[3]-initialEnergy};}
  function sample(){const f=forces(s),length=f.point.length;return {t,distance:s[0],speed:s[1],x:f.point.x,y:f.point.y,normal:f.normal,lateralFriction:f.lateral,longitudinalFriction:f.longitudinal,friction:f.friction,frictionCapacity:f.capacity,gripMargin:f.margin,driveForce:f.longitudinal,requestedDrive:p.drive,resistance:f.resistance,centripetalAcceleration:s[1]**2*f.point.curvature,bank:f.bank,cornerMaxSpeed:speedLimits(p).maxSpeed,cornerMinSpeed:speedLimits(p).minSpeed,lapFraction:s[0]/length,laps:Math.floor(s[0]/length),lapTime:firstLapTime,activeTime,lostGrip,...invariants()};}
  function geometry(){const f=forces(s),q=f.point,theta=f.bank*rad;return {position:{x:q.x,y:q.y},heading:q.heading,tangent:q.tangent,inward:q.inward,track:{radius:p.radius,halfStraight:p.halfStraight,length:q.length},car:{length:4.5,width:1.8},bank:f.bank,forces:{normal:{inward:f.normal*Math.sin(theta),up:f.normal*Math.cos(theta)},friction:{inward:f.lateral*Math.cos(theta),up:-f.lateral*Math.sin(theta),forward:f.longitudinal},gravity:{up:-p.mass*p.gravity},resistance:{forward:-f.resistance}},lostGrip,validLap:!lostGrip};}
  return {get t(){return t;},step,reset,sample,invariants,geometry};
}
const base={mass:1000,speed:15,drive:0,drag:0,rolling:0,radius:50,halfStraight:50,bank:0,mu:.8,gravity:9.81};
const preset=(id,label,values,note)=>({id,label,values:{...base,...values},note});
export const model={id:'race-track',title:'Race track',params,presets:[
  preset('flat','Flat corner',{},'Static tire friction supplies the inward acceleration.'),
  preset('banked','Banked corner',{halfStraight:0,bank:20,speed:13.4},'Near the design speed, banking supplies almost all the inward force.'),
  preset('ice','Ice loses grip',{halfStraight:0,mu:.1,speed:15},'The demanded turn exceeds the tire limit; the valid lap ends.'),
  preset('brake','Brake while turning',{halfStraight:0,drive:-5000},'Braking and turning share the same friction circle.'),
  preset('tight','Tighter curve',{radius:20,speed:10},'The same speed needs more inward acceleration at smaller radius.'),
  preset('coast','Coast to a stop',{drag:.5,rolling:.01},'Lost mechanical energy appears in dissipated work.'),
],observables:[['speed','Speed','v','m/s'],['distance','Distance','s','m'],['normal','Normal force','N','N'],['lateralFriction','Lateral tire force','f_⊥','N'],['longitudinalFriction','Drive / braking tire force','f_∥','N'],['frictionCapacity','Tire capacity','μN','N'],['cornerMaxSpeed','Corner maximum speed','v_max','m/s'],['cornerMinSpeed','Corner minimum speed','v_min','m/s'],['lapTime','First completed lap','T','s'],['energy','Kinetic energy','K','J'],['dissipatedWork','Dissipated work','D','J'],['driveWork','Drive work','W','J']].map(([key,label,symbol,unit])=>({key,label,symbol,unit})),create};
