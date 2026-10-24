// Independent planar Newtonian N-body engine. SI units, no DOM or storage.
const GRAVITY=6.67430e-11,TAU=2*Math.PI;
const copy=b=>b.map(v=>({...v}));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function orbitalElements(primary,body,gravity=GRAVITY) {
  const x=body.x-primary.x,y=body.y-primary.y,vx=body.vx-primary.vx,vy=body.vy-primary.vy;
  const r=Math.hypot(x,y),mu=gravity*(primary.mass+body.mass),h=x*vy-y*vx;
  if(!r||!mu) return {a:0,e:0,period:0,periapsis:0,apoapsis:0,periapseAngle:0,trueAnomaly:0,available:false};
  const ex=vy*h/mu-x/r,ey=-vx*h/mu-y/r,e=Math.hypot(ex,ey),eps=(vx*vx+vy*vy)/2-mu/r;
  const a=Math.abs(eps)>1e-12*mu/r ? -mu/(2*eps) : 0;
  const periapseAngle=e>1e-10?Math.atan2(ey,ex):0;
  return {a,e,period:a>0?TAU*Math.sqrt(a*a*a/mu):0,
    periapsis:h*h/(mu*(1+e)),apoapsis:a>0?a*(1+e):0,periapseAngle,
    trueAnomaly:Math.atan2(Math.sin(Math.atan2(y,x)-periapseAngle),Math.cos(Math.atan2(y,x)-periapseAngle)),available:true};
}

export function stateFromElements({mass=0,a,e=0,trueAnomaly=0,periapseAngle=0,clockwise=false},primary,gravity=GRAVITY) {
  if(![mass,a,e,trueAnomaly,periapseAngle,gravity].every(finite)||mass<0||e<0||gravity<=0||
    !finite(primary.mass)||primary.mass<=0||![primary.x,primary.y,primary.vx,primary.vy].every(finite)||
    typeof clockwise!=='boolean'||e===1||a*(1-e*e)<=0) throw new RangeError('Invalid elliptic/hyperbolic elements');
  const l=a*(1-e*e),den=1+e*Math.cos(trueAnomaly);
  if(den<=0) throw new RangeError('True anomaly lies outside this conic');
  const r=l/den,theta=trueAnomaly+periapseAngle,sign=clockwise?-1:1;
  const scale=Math.sqrt(gravity*(primary.mass+mass)/l),vr=sign*scale*e*Math.sin(trueAnomaly),vt=sign*scale*den;
  return {mass,x:primary.x+r*Math.cos(theta),y:primary.y+r*Math.sin(theta),
    vx:primary.vx+vr*Math.cos(theta)-vt*Math.sin(theta),vy:primary.vy+vr*Math.sin(theta)+vt*Math.cos(theta)};
}

export function replicateBodies(bodies,index,count,{dx=0,dy=0,dvx=0,dvy=0}={}) {
  if(!Array.isArray(bodies)||!Number.isInteger(index)||index<0||index>=bodies.length||
    !Number.isInteger(count)||count<0||bodies.length+count>32||![dx,dy,dvx,dvy].every(finite))
    throw new RangeError('Invalid bounded replication');
  const result=copy(bodies),source=bodies[index];
  for(let n=1;n<=count;n++) result.push({...source,mass:0,name:`Probe ${n}`,
    x:source.x+n*dx,y:source.y+n*dy,vx:source.vx+n*dvx,vy:source.vy+n*dvy});
  return result;
}

// Built-in systems are explicitly compact teaching analogues, not ephemerides.
// Original CUPS parameter constants are not used here.
export function scenarioBodies(p,binary) {
  const star={name:'Primary',mass:1e12,x:0,y:0,vx:0,vy:0};
  const orb=(name,mass,r,e=0,angle=0,primary=star)=>({name,...stateFromElements(
    {mass,a:r,e,trueAnomaly:Math.PI,periapseAngle:angle},primary)});
  switch(p.system) {
    case 'custom-nbody': return [...binary,...Array.from({length:p.bodyCount-2},(_,i)=>{
      const n=i+3;return {name:`Body ${n}`,mass:p[`m${n}`],x:p[`x${n}`],y:p[`y${n}`],vx:p[`vx${n}`],vy:p[`vy${n}`]};})];
    case 'sun-earth-moon': {
      const earth=orb('Earth analogue',3e6,10,.0167),moon=orb('Moon analogue',3.7e4,.0257,.055,0,earth);
      return [{...star,name:'Sun analogue'},earth,moon];
    }
    case 'solar-system': {
      // Five interacting masses, inner planets and Pluto as non-backreacting probes.
      const giants=[['Jupiter',9.55e8,52.03,.0489],['Saturn',2.86e8,95.37,.0565],
        ['Uranus',4.37e7,191.9,.046],['Neptune',5.15e7,300.7,.009]];
      return [{...star,name:'Sun analogue'},...giants.map(a=>orb(...a)),
        ...[['Mercury',0,3.87,.206],['Venus',0,7.23,.0068],['Earth',0,10,.0167],
          ['Mars',0,15.24,.0934],['Pluto',0,394.8,.249]].map(a=>orb(...a))];
    }
    case 'docking': {
      const station=orb('Station',0,10,0),shuttle=orb('Shuttle',0,10,0,.08);
      return [{...star,name:'Planet analogue'},station,shuttle];
    }
    case 'jupiter-comet': return [star,orb('Jupiter analogue',9.55e8,52.03),orb('Comet',0,32,.7,.25)];
    case 'jupiter-moons': {
      const sun={...star,mass:1e15,name:'Sun analogue'},jupiter=orb('Jupiter analogue',1e12,150,0,0,sun);
      return [sun,jupiter,...[1,1.59,2.54,4.47].map((r,i)=>orb(`Moon ${i+1}`,0,r,0,i*.7,jupiter))];
    }
    case 'lagrange': {
      const m1=1e12,m2=9.55e8,M=m1+m2,r=10,w=Math.sqrt(GRAVITY*M/r**3);
      const a={name:'Primary',mass:m1,x:-m2/M*r,y:0,vx:0,vy:-m2/M*r*w};
      const b={name:'Secondary',mass:m2,x:m1/M*r,y:0,vx:0,vy:m1/M*r*w};
      return [a,b,...[Math.PI/3,Math.PI/2,Math.PI].map((theta,i)=>{
        const x=a.x+r*Math.cos(theta),y=r*Math.sin(theta);
        return {name:['L4 probe','90° probe','180° probe'][i],mass:0,x,y,vx:-w*y,vy:w*x};})];
    }
    case 'binary-comet': {
      const r=10,w=Math.sqrt(GRAVITY*2e12/r**3);
      const a={name:'Star A',mass:1e12,x:-5,y:0,vx:0,vy:-5*w};
      const b={name:'Star B',mass:1e12,x:5,y:0,vx:0,vy:5*w};
      return [a,b,orb('Comet',0,1,.2,0,b)];
    }
    case 'retrograde': return [star,orb('Earth analogue',3e6,10),orb('Jupiter analogue',9.55e8,52.03)];
    default: return binary;
  }
}

export function createNBody({bodies,gravity=GRAVITY,alpha=0,maxStep=.01,direction=1,frame='cm',
  thrust={body:1,along:0,normal:0,frame:'inertial'},guard=1e-5}={}) {
  if(!Array.isArray(bodies)||bodies.length<2||bodies.length>32||bodies.filter(b=>b.mass>0).length>5||
    !(bodies[0].mass>0)||!finite(gravity)||gravity<0||!finite(alpha)||alpha<0||
    !finite(maxStep)||maxStep<=0||maxStep>60||![1,-1].includes(direction)||!finite(guard)||guard<=0||
    !['cm','primary','secondary','third','universe','rotating'].includes(frame)) throw new RangeError('Invalid N-body configuration');
  for(const b of bodies) if(![b.mass,b.x,b.y,b.vx,b.vy].every(finite)||b.mass<0||b.mass>1e35)
    throw new RangeError('Invalid body state');
  if(!Number.isInteger(thrust.body)||thrust.body<0||thrust.body>=bodies.length||
    !finite(thrust.along)||!finite(thrust.normal)||!['inertial','velocity'].includes(thrust.frame))
    throw new RangeError('Invalid thrust');
  const burnStart=thrust.start??0,burnDuration=thrust.duration??0;
  if(!finite(burnStart)||burnStart<0||!finite(burnDuration)||burnDuration<0)
    throw new RangeError('Invalid burn window');
  for(let i=0;i<bodies.length;i++) for(let j=0;j<i;j++)
    if(Math.hypot(bodies[i].x-bodies[j].x,bodies[i].y-bodies[j].y)<guard) throw new RangeError('Initially coincident bodies');
  const initial=copy(bodies),M=bodies.reduce((s,b)=>s+b.mass,0),N=bodies.length;
  let b,t,physicalTime,work,impulse,torque,status,sections,area,burnActive;
  function reset(){b=copy(initial);t=0;physicalTime=0;work=0;impulse={x:0,y:0};torque=0;status='running';sections=[];area=0;}
  reset();
  const driven=thrust.along!==0||thrust.normal!==0;
  let hMax=maxStep;
  for(let i=0;i<N;i++) for(let j=0;j<i;j++) {
    const mass=b[i].mass+b[j].mass,r=Math.hypot(b[i].x-b[j].x,b[i].y-b[j].y);
    if(gravity*mass>0) {
      const peri=orbitalElements(b[i],b[j],gravity).periapsis;
      const scale=peri>guard?Math.min(r,peri):r;
      hMax=Math.min(hMax,.002*Math.sqrt(scale**3/(gravity*mass*(1+alpha/scale))));
    }
  }
  function centre(state=b) {
    return state.reduce((c,v)=>({x:c.x+v.mass*v.x/M,y:c.y+v.mass*v.y/M,
      vx:c.vx+v.mass*v.vx/M,vy:c.vy+v.mass*v.vy/M}),{x:0,y:0,vx:0,vy:0});
  }
  function external(state) {
    if(!burnActive)return {ax:0,ay:0,fx:0,fy:0};
    const body=state[thrust.body];let ax=thrust.along,ay=thrust.normal;
    if(thrust.frame==='velocity') {
      const ref=state[thrust.body===0?1:0],vx=body.vx-ref.vx,vy=body.vy-ref.vy,v=Math.hypot(vx,vy);
      const ux=v?vx/v:1,uy=v?vy/v:0;
      ax=thrust.along*ux-thrust.normal*uy;ay=thrust.along*uy+thrust.normal*ux;
    }
    return {ax,ay,fx:body.mass*ax,fy:body.mass*ay};
  }
  function accelerations(state) {
    const result=state.map(()=>({x:0,y:0}));
    for(let i=0;i<N;i++) for(let j=0;j<i;j++) {
      if(state[i].mass+state[j].mass===0)continue;
      const x=state[j].x-state[i].x,y=state[j].y-state[i].y,r=Math.hypot(x,y);
      const f=gravity*(1+alpha/r)/r**3;
      result[i].x+=f*state[j].mass*x;result[i].y+=f*state[j].mass*y;
      result[j].x-=f*state[i].mass*x;result[j].y-=f*state[i].mass*y;
    }
    if(driven) {const f=external(state);result[thrust.body].x+=f.ax;result[thrust.body].y+=f.ay;}
    return result;
  }
  function rotated(state=b) {
    const c=centre(state),x=state[1].x-state[0].x,y=state[1].y-state[0].y,r=Math.hypot(x,y);
    const cos=x/r,sin=y/r,omega=(x*(state[1].vy-state[0].vy)-y*(state[1].vx-state[0].vx))/(r*r);
    return {omega,bodies:state.map(v=>{
      const x=v.x-c.x,y=v.y-c.y,vx=v.vx-c.vx+omega*y,vy=v.vy-c.vy-omega*x;
      return {...v,x:x*cos+y*sin,y:-x*sin+y*cos,vx:vx*cos+vy*sin,vy:-vx*sin+vy*cos};})};
  }
  function derivative(state) {
    const a=accelerations(state),f=external(state),v=state[thrust.body];
    return {b:state.map((v,i)=>({x:v.vx,y:v.vy,vx:a[i].x,vy:a[i].y})),
      work:f.fx*v.vx+f.fy*v.vy,ix:f.fx,iy:f.fy,torque:v.x*f.fy-v.y*f.fx};
  }
  function rk4(h) {
    const add=(s,k,f)=>s.map((v,i)=>({...v,x:v.x+f*k.b[i].x,y:v.y+f*k.b[i].y,
      vx:v.vx+f*k.b[i].vx,vy:v.vy+f*k.b[i].vy}));
    const k1=derivative(b),k2=derivative(add(b,k1,h/2)),k3=derivative(add(b,k2,h/2)),k4=derivative(add(b,k3,h));
    b=b.map((v,i)=>{const out={...v};for(const key of ['x','y','vx','vy'])
      out[key]+=h*(k1.b[i][key]+2*k2.b[i][key]+2*k3.b[i][key]+k4.b[i][key])/6;return out;});
    const sum=key=>h*(k1[key]+2*k2[key]+2*k3[key]+k4[key])/6;
    work+=sum('work');impulse.x+=sum('ix');impulse.y+=sum('iy');torque+=sum('torque');
  }
  function step(dt) {
    if(!finite(dt)||dt<0||dt>60) throw new RangeError('dt must be 0..60 seconds');
    if(!dt)return;
    if(Math.ceil(dt/hMax)>2e6) throw new RangeError('Integration budget exceeded');
    let elapsed=0,count=0;
    while(elapsed<dt && status==='running') {
      if(++count>2e6) throw new RangeError('Integration budget exceeded');
      let h=Math.min(hMax,dt-elapsed);
      for(const boundary of [burnStart,...(burnDuration>0?[burnStart+burnDuration]:[])]) {
        const distance=direction*(boundary-physicalTime);
        if(distance>1e-12)h=Math.min(h,distance);
      }
      // Refinement is reserved for approaching a guard, not regular bound orbits.
      for(let i=0;i<N;i++) for(let j=0;j<i;j++) if(b[i].mass+b[j].mass>0) {
        const r=Math.hypot(b[i].x-b[j].x,b[i].y-b[j].y),speed=Math.hypot(b[i].vx-b[j].vx,b[i].vy-b[j].vy);
        h=Math.min(h,.02*r/(speed+1e-30));
        if(gravity>0)h=Math.min(h,.002*Math.sqrt(r**3/(gravity*(b[i].mass+b[j].mass)*(1+alpha/r))));
      }
      const prior=copy(b),oldRot=N>2?rotated().bodies[2]:null;
      const oldAccounting={work,torque,impulse:{...impulse}};
      h*=direction;
      const middle=physicalTime+h/2;
      burnActive=middle>=burnStart&&(burnDuration===0||middle<burnStart+burnDuration);
      if(driven) rk4(h);
      else {
        const a=accelerations(b);
        for(let i=0;i<N;i++) {b[i].vx+=h*a[i].x/2;b[i].vy+=h*a[i].y/2;b[i].x+=h*b[i].vx;b[i].y+=h*b[i].vy;}
        const next=accelerations(b);
        for(let i=0;i<N;i++) {b[i].vx+=h*next[i].x/2;b[i].vy+=h*next[i].y/2;}
      }
      let invalid=false;
      for(let i=0;i<N;i++) for(let j=0;j<i;j++) if(b[i].mass+b[j].mass>0) {
        const x=b[i].x-b[j].x,y=b[i].y-b[j].y,ox=prior[i].x-prior[j].x,oy=prior[i].y-prior[j].y;
        if(Math.hypot(x,y)<guard || x*ox+y*oy<0 && Math.hypot(x-ox,y-oy)>Math.hypot(ox,oy)) invalid=true;
      }
      if(b.some(v=>![v.x,v.y,v.vx,v.vy].every(finite))||invalid) {
        b=prior;work=oldAccounting.work;torque=oldAccounting.torque;impulse=oldAccounting.impulse;
        status='close-encounter';break;
      }
      area+=((prior[1].x-prior[0].x)*(b[1].y-b[0].y)-(prior[1].y-prior[0].y)*(b[1].x-b[0].x))/2;
      const oldTime=physicalTime;physicalTime+=h;elapsed+=Math.abs(h);
      if(oldRot) {
        const now=rotated().bodies[2];
        if((direction>0?oldRot.y<0&&now.y>=0:oldRot.y>0&&now.y<=0) && now.vy>0) {
          const f=-oldRot.y/(now.y-oldRot.y);
          sections.push({t:oldTime+f*h,x:oldRot.x+f*(now.x-oldRot.x),y:0,vx:oldRot.vx+f*(now.vx-oldRot.vx)});
          if(sections.length>2048) sections.shift();
        }
      }
    }
    t+=dt;
  }
  function invariants() {
    let kinetic=0,potential=0,angularMomentum=0,px=0,py=0;
    for(let i=0;i<N;i++) {
      const v=b[i];kinetic+=v.mass*(v.vx*v.vx+v.vy*v.vy)/2;
      px+=v.mass*v.vx;py+=v.mass*v.vy;angularMomentum+=v.mass*(v.x*v.vy-v.y*v.vx);
      for(let j=0;j<i;j++) if(v.mass*b[j].mass>0) {
        const r=Math.hypot(v.x-b[j].x,v.y-b[j].y);potential-=gravity*v.mass*b[j].mass*(1/r+alpha/(2*r*r));
      }
    }
    return {energy:kinetic+potential,kinetic,potential,momentum:{x:px,y:py},angularMomentum,
      work,accountedEnergy:kinetic+potential-work,externalImpulse:{...impulse},externalAngularImpulse:torque};
  }
  function diagnostics() {
    const elements=b.slice(1).map(v=>orbitalElements(b[0],v,gravity)),q=b[2]||b[1],
      rel={x:q.x-b[1].x,y:q.y-b[1].y,vx:q.vx-b[1].vx,vy:q.vy-b[1].vy};
    const d2=rel.x*rel.x+rel.y*rel.y;
    const rot=rotated(),mu=gravity*(b[0].mass+b[1].mass);
    const initialPair=orbitalElements(initial[0],initial[1],gravity);
    const jacobiApplicable=N>2&&gravity>0&&b.slice(2).every(v=>v.mass===0)&&initialPair.available&&initialPair.e<1e-9&&!driven&&alpha===0;
    let jacobi=0;
    if(jacobiApplicable) {
      const probe=rot.bodies[2],r1=Math.hypot(b[2].x-b[0].x,b[2].y-b[0].y),r2=Math.hypot(b[2].x-b[1].x,b[2].y-b[1].y);
      // Use the initial circular angular frequency, not an instantaneous fitted one.
      const omega=Math.sqrt(mu/initialPair.a**3);
      jacobi=2*gravity*(b[0].mass/r1+b[1].mass/r2)+omega*omega*(probe.x*probe.x+probe.y*probe.y)-probe.vx*probe.vx-probe.vy*probe.vy;
    }
    return {elements,lineOfSight:{angle:Math.atan2(rel.y,rel.x),rate:d2?(rel.x*rel.vy-rel.y*rel.vx)/d2:0},jacobi,jacobiApplicable};
  }
  function sample() {
    const a=b[0],q=b[1],x=q.x-a.x,y=q.y-a.y,vx=q.vx-a.vx,vy=q.vy-a.vy,r=Math.hypot(x,y);
    const inv=invariants(),d=diagnostics(),e=d.elements[0],mu=gravity*(a.mass+q.mass),h=x*vy-y*vx;
    return {t,physicalTime,...inv,r,speed:Math.hypot(vx,vy),eccentricity:e.e,semiMajorAxis:e.a,period:e.period,
      periapsis:e.periapsis,apoapsis:e.apoapsis,escapeSpeed:Math.sqrt(mu*(2/r+alpha/(r*r))),
      sweptArea:area,areaRate:h/2,bound:e.a>0,keplerExact:N===2&&!driven&&alpha===0,
      areaLawApplicable:N===2&&!driven,bodyCount:N,jacobi:d.jacobi,jacobiApplicable:d.jacobiApplicable,
      lineOfSightAngle:d.lineOfSight.angle,lineOfSightRate:d.lineOfSight.rate,status};
  }
  function geometry() {
    const c=centre(),centred=origin=>b.map(v=>({...v,x:v.x-origin.x,y:v.y-origin.y,vx:v.vx-origin.vx,vy:v.vy-origin.vy}));
    const frames={universe:copy(b),cm:centred(c),primary:centred(b[0]),secondary:centred(b[1]),third:centred(b[2]||b[1]),rotating:rotated().bodies};
    const a=b[0],q=b[1],x=q.x-a.x,y=q.y-a.y,r=Math.hypot(x,y),f=-gravity*a.mass*q.mass*(1+alpha/r)/r**3;
    const d=diagnostics(),e=d.elements[0];
    const energyByBody=b.map((v,i)=>{
      const specificKinetic=(v.vx*v.vx+v.vy*v.vy)/2;
      let specificPotential=0;
      for(let j=0;j<N;j++)if(i!==j&&b[j].mass>0) {
        const r=Math.hypot(v.x-b[j].x,v.y-b[j].y);specificPotential-=gravity*b[j].mass*(1/r+alpha/(2*r*r));
      }
      return {mass:v.mass,kinetic:v.mass*specificKinetic,potential:v.mass*specificPotential,
        energy:v.mass*(specificKinetic+specificPotential),specificEnergy:specificKinetic+specificPotential};
    });
    const origin=frame==='primary'?a:frame==='secondary'?q:frame==='third'?(b[2]||q):c;
    const centreOfMass=frame==='universe'?{x:c.x,y:c.y}:['cm','rotating'].includes(frame)?{x:0,y:0}:
      {x:c.x-origin.x,y:c.y-origin.y};
    const active=frames[frame],relative={x:active[1].x-active[0].x,y:active[1].y-active[0].y,
      vx:active[1].vx-active[0].vx,vy:active[1].vy-active[0].vy};
    const force=frame==='rotating'?{x:f*r,y:0}:{x:f*x,y:f*y};
    return {bodies:active,frames,frame,relative,relativeInertial:{x,y,vx:q.vx-a.vx,vy:q.vy-a.vy},
      centreOfMass,inertialCentreOfMass:c,energyByBody,
      force,forceInertial:{x:f*x,y:f*y},elements:{...e,perBody:d.elements},lineOfSight:d.lineOfSight,
      poincare:sections.map(v=>({...v})),effectivePotential:{available:false,reason:'Pairwise reduction is not an exact N-body radial potential'},status};
  }
  return {get t(){return t;},step,reset,sample,invariants,geometry};
}
