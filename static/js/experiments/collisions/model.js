// Two finite masses; central forces derive from the displayed SI potential.
const num=(key,label,symbol,unit,min,max,step,value,group='Launch')=>
  ({key,label,symbol,unit,min,max,step,value,group});
const interactions=[['hard','Hard spheres'],['soft','Spring contact'],['coulomb','Inverse square'],
  ['shielded','Screened inverse square'],['truncated','Finite charge sphere'],
  ['power','Power law'],['yukawa','Yukawa'],['woods-saxon','Woods–Saxon']];
const params=[
  num('m1','Projectile mass','m_1','kg',.1,20,.1,1,'Masses'),
  num('m2','Target mass','m_2','kg',.1,20,.1,1,'Masses'),
  num('speed','Projectile speed','v_0','m/s',.1,20,.1,2),
  num('targetSpeed','Target speed','u_2','m/s',-10,10,.1,0),
  num('b','Impact parameter','b','m',-10,10,.01,.5),
  num('distance','Initial horizontal separation','d','m',2,5000,1,8),
  num('radius','Contact separation','R','m',.1,1.5,.01,1,'Force'),
  num('restitution','Restitution','e','',0,1,.01,1,'Force'),
  num('strength','Potential strength (signed)','K','J',-100,100,.1,1,'Force'),
  num('range','Interaction length','R_0','m',.1,10,.1,1,'Force'),
  num('stiffness','Contact stiffness','k','N/m',1,1000,1,100,'Force'),
  num('power','Radial force exponent','n','',-4,2,.1,-2,'Force'),
  num('diffuseness','Surface diffuseness','a','m',.05,2,.05,.2,'Force'),
  {key:'interaction',label:'Interaction',symbol:'',unit:'',value:'hard',group:'Force',
    options:interactions.map(([value,label])=>({value,label}))},
  {key:'secondInteraction',label:'Add to Coulomb',symbol:'',unit:'',value:'none',group:'Combined force',
    options:[['none','None'],['woods-saxon','Woods–Saxon'],['yukawa','Yukawa'],['hard','Hard core'],['soft','Spring core']]
      .map(([value,label])=>({value,label}))},
  num('secondStrength','Second potential strength','K_2','J',-100,100,.1,-2,'Combined force'),
  num('secondRange','Second range / contact separation','R_2','m',.1,10,.1,.5,'Combined force'),
  num('secondDiffuseness','Second surface diffuseness','a_2','m',.05,2,.05,.1,'Combined force'),
  num('secondStiffness','Second contact stiffness','k_2','N/m',1,1000,1,100,'Combined force'),
  {key:'frame',label:'Frame',symbol:'',unit:'',value:'lab',group:'View',
    options:[{value:'lab',label:'Laboratory'},{value:'cm',label:'Centre of mass'}]},
];
const defaults=Object.fromEntries(params.map(p=>[p.key,p.value]));
const preset=(id,label,values,note)=>({id,label,values:{...defaults,...values},note});

// Return radial force on body 1 pointing from body 2 toward body 1, and U.
// K has units J; the inverse-square coupling is K*R0, in J m.
export function interactionAt(p,r) {
  const main=singleInteractionAt(p,r);
  if(!p.secondInteraction||p.secondInteraction==='none')return main;
  const second=singleInteractionAt({...p,interaction:p.secondInteraction,strength:p.secondStrength,
    range:p.secondRange,radius:p.secondRange,diffuseness:p.secondDiffuseness,stiffness:p.secondStiffness},r);
  return {potential:main.potential+second.potential,force:main.force+second.force};
}
function singleInteractionAt(p,r) {
  if (!(r>0)) throw new RangeError('Separation must be positive');
  const k=p.strength,R=p.range;
  switch(p.interaction) {
    case 'hard': return {potential:0,force:0}; // Contact is an impulse, not a finite U barrier.
    case 'soft': {const overlap=Math.max(0,p.radius-r);
      return {potential:p.stiffness*overlap*overlap/2,force:p.stiffness*overlap};}
    case 'coulomb': return {potential:k*R/r,force:k*R/(r*r)};
    case 'shielded':
    case 'yukawa': {const u=k*R*Math.exp(-r/R)/r;return {potential:u,force:u*(1/r+1/R)};}
    case 'truncated': return r>=R ? {potential:k*R/r,force:k*R/(r*r)} :
      {potential:k*(3-r*r/(R*R))/2,force:k*r/(R*R)};
    case 'power': {const q=r/R,n=p.power;
      return {potential:Math.abs(n+1)<1e-10 ? -k*Math.log(q) : -k*q**(n+1)/(n+1),force:k/R*q**n};}
    case 'woods-saxon': {const z=(r-R)/p.diffuseness;
      const f=z>=0 ? Math.exp(-z)/(1+Math.exp(-z)) : 1/(1+Math.exp(z));
      return {potential:k*f,force:k*f*(1-f)/p.diffuseness};}
    default: throw new RangeError('Unknown interaction');
  }
}

export function rutherfordAngle({m1,m2,strength,range,b,speed}) {
  const reduced=m1*m2/(m1+m2);
  return 2*Math.atan2(Math.abs(strength*range),reduced*speed*speed*Math.abs(b));
}

export const model={
  id:'collisions',title:'Two-body collisions',params,
  presets:[
    preset('exchange','Swap velocities',{b:0},'Equal masses exchange velocities in a head-on elastic collision.'),
    preset('glancing','Glancing collision',{},'Only the normal component changes; equal-mass outgoing velocities are perpendicular.'),
    preset('heavy','Heavy target',{m2:10,b:0},'A massive target sends the projectile back.'),
    preset('inelastic','Energy into deformation',{b:0,restitution:.5},'Momentum is conserved while normal relative kinetic energy decreases.'),
    preset('rutherford','Rutherford',{interaction:'coulomb',distance:20,b:1},'Repulsive inverse-square scattering bends the relative velocity; the launch is finite-distance.'),
    preset('screening','Screening',{interaction:'shielded',distance:20,b:1},'Screening suppresses distant deflections.'),
    preset('spring','Spring contact',{interaction:'soft',b:.3},'Contact stores energy in compression and gives it back.'),
    preset('yukawa','Short-range attraction',{interaction:'yukawa',strength:-1,b:.8,distance:20},'The attractive tail acts over a finite range.'),
    preset('nuclear','Finite-depth well',{interaction:'woods-saxon',strength:-2,b:.8,distance:20},'A finite well avoids the divergent central potential.'),
    preset('combined-well','Coulomb + nuclear well',{interaction:'coulomb',strength:.2,secondInteraction:'woods-saxon',b:.5},'An outer repulsive barrier competes with a short-range attractive well.'),
    preset('combined-yukawa','Coulomb + Yukawa',{interaction:'coulomb',strength:.2,secondInteraction:'yukawa',b:.5},'Long- and short-range forces contribute to the same conservative potential.'),
    preset('combined-hard','Coulomb + hard core',{interaction:'coulomb',strength:.2,secondInteraction:'hard',b:.2},'Repulsive acceleration and an exact contact impulse act in one encounter.'),
    preset('combined-soft','Coulomb + spring core',{interaction:'coulomb',strength:.2,secondInteraction:'soft',b:.2},'A finite contact spring supplements the inverse-square force.'),
  ],
  observables:[['separation','Separation','r','m'],['radialSpeed','Radial speed','v_r','m/s'],['relativeSpeed','Relative speed','v_{rel}','m/s'],
    ['vx1','Projectile x velocity','v_{1x}','m/s'],['vy1','Projectile y velocity','v_{1y}','m/s'],
    ['vx2','Target x velocity','v_{2x}','m/s'],['vy2','Target y velocity','v_{2y}','m/s'],
    ['energy','Mechanical energy','E','J'],['kinetic','Kinetic energy','K','J'],['potential','Potential energy','U','J'],
    ['dissipated','Deformation energy','Q','J'],['px','Total x momentum','p_x','kg m/s'],
    ['py','Total y momentum','p_y','kg m/s'],['angularMomentum','Angular momentum about CM','L','kg m²/s'],
    ['scatteringAngle','Current relative deflection','\\theta','rad'],['cmSpeed1','CM projectile speed','v^*_1','m/s'],
    ['cmSpeed2','CM target speed','v^*_2','m/s']].map(([key,label,symbol,unit])=>({key,label,symbol,unit})),
  create(values={}) {
    const p={...defaults,...values};
    for(const key of Object.keys(values)) if(!(key in defaults)) throw new RangeError(`Unknown parameter ${key}`);
    for(const d of params) if(d.options ? !d.options.some(o=>o.value===p[d.key]) :
      !Number.isFinite(p[d.key])||p[d.key]<d.min||p[d.key]>d.max) throw new RangeError(`Invalid ${d.key}`);
    if(p.secondInteraction!=='none'&&p.interaction!=='coulomb')throw new RangeError('Secondary interactions require Coulomb');
    if(p.secondInteraction==='hard'&&Math.hypot(p.distance,p.b)<=p.secondRange)
      throw new RangeError('Initial bodies overlap the hard core');
    const total=p.m1+p.m2,reduced=p.m1*p.m2/total;
    const cmVelocity=(p.m1*p.speed+p.m2*p.targetSpeed)/total;
    const cmInitial={x:-p.distance*p.m1/total,y:p.b*p.m1/total};
    let x,y,vx,vy,t,dissipated,contactCount,status,lastContact;
    function reset(){x=-p.distance;y=p.b;vx=p.speed-p.targetSpeed;vy=0;t=0;
      dissipated=0;contactCount=0;status='running';lastContact=null;}
    reset();
    const maxH=Math.min(.01,.002*p.range/(Math.abs(vx)+1),
      .002*Math.sqrt(reduced*Math.min(p.range,p.radius)**2/(Math.abs(p.strength)+p.stiffness*p.radius**2+1)));
    function drift(h){x+=vx*h;y+=vy*h;}
    function stepHard(dt,elapsed=0) {
      const radius=p.secondInteraction==='hard'?p.secondRange:p.radius;
      const v2=vx*vx+vy*vy,rv=x*vx+y*vy,c=x*x+y*y-radius*radius;
      const discriminant=rv*rv-v2*c;
      const hit=v2>0 && rv<0 && discriminant>=0 ? (-rv-Math.sqrt(discriminant))/v2 : -1;
      if(hit>=-1e-12 && hit<=dt) {
        const flight=Math.max(0,hit);drift(flight);
        const r=Math.hypot(x,y),nx=x/r,ny=y/r,normal=vx*nx+vy*ny;
        const impulse=-(1+p.restitution)*reduced*normal;
        dissipated+=reduced*(1-p.restitution*p.restitution)*normal*normal/2;
        vx-=(1+p.restitution)*normal*nx;vy-=(1+p.restitution)*normal*ny;
        lastContact={t:t+elapsed+flight,normal:{x:nx,y:ny},impulse,relativeNormalBefore:normal};
        contactCount++;drift(dt-flight);
      } else drift(dt);
    }
    const accel=()=>{
      const r=Math.hypot(x,y),f=interactionAt(p,r).force/(reduced*r);
      return [f*x,f*y];
    };
    function step(dt) {
      if(!Number.isFinite(dt)||dt<0||dt>60) throw new RangeError('dt must be 0..60 seconds');
      if(!dt) return;
      if(status==='running' && p.interaction==='hard') stepHard(dt);
      else if(status==='running') {
        // Velocity Verlet, refined near close encounters. Momentum and angular
        // momentum are preserved algebraically; energy convergence is tested.
        let elapsed=0,count=0;
        while(elapsed<dt) {
          const r=Math.hypot(x,y),speed=Math.hypot(vx,vy),force=Math.abs(interactionAt(p,r).force);
          if(r<1e-5) {status='close-encounter';break;}
          const h=Math.min(dt-elapsed,maxH,.002*r/(speed+1),.002*Math.sqrt(reduced*r/(force+1e-30)));
          if(++count>2e6) throw new RangeError('Integration budget exceeded; use a shorter step');
          const oldVx=vx,oldVy=vy;
          const a=accel();vx+=a[0]*h/2;vy+=a[1]*h/2;
          const oldX=x,oldY=y;
          if(p.secondInteraction==='hard')stepHard(h,elapsed);else drift(h);
          const nx=x,ny=y;
          if(Math.hypot(nx,ny)<1e-5 || oldX*nx+oldY*ny<0 && Math.hypot(nx-oldX,ny-oldY)>r) {
            x=oldX;y=oldY;vx=oldVx;vy=oldVy;
            status='close-encounter';break;
          }
          const b=accel();vx+=b[0]*h/2;vy+=b[1]*h/2;elapsed+=h;
        }
      }
      t+=dt;
    }
    function invariants() {
      const kinetic=reduced*(vx*vx+vy*vy)/2+total*cmVelocity*cmVelocity/2;
      const potential=interactionAt(p,Math.hypot(x,y)).potential;
      return {energy:kinetic+potential,kinetic,potential,dissipated,
        accountedEnergy:kinetic+potential+dissipated,
        momentum:{x:total*cmVelocity,y:0},angularMomentum:reduced*(x*vy-y*vx)};
    }
    function sample() {
      const a=p.m2/total,b=-p.m1/total,inv=invariants(),v=Math.hypot(vx,vy);
      return {t,...inv,px:inv.momentum.x,py:inv.momentum.y,separation:Math.hypot(x,y),radialSpeed:(x*vx+y*vy)/Math.hypot(x,y),relativeSpeed:v,
        vx1:cmVelocity+a*vx,vy1:a*vy,vx2:cmVelocity+b*vx,vy2:b*vy,
        cmSpeed1:a*v,cmSpeed2:-b*v,
        scatteringAngle:Math.atan2((Math.sign(p.speed-p.targetSpeed)||1)*vy,
          (Math.sign(p.speed-p.targetSpeed)||1)*vx),contactCount,status};
    }
    function geometry() {
      const cx=cmInitial.x+cmVelocity*t,cy=cmInitial.y;
      const contactRadius=p.secondInteraction==='hard'||p.secondInteraction==='soft'?p.secondRange:p.radius;
      const body=(mass,f,cm)=>({mass,radius:contactRadius/2,x:f*x+(cm?0:cx),y:f*y+(cm?0:cy),
        vx:f*vx+(cm?0:cmVelocity),vy:f*vy});
      const lab=[body(p.m1,p.m2/total,false),body(p.m2,-p.m1/total,false)];
      const cm=[body(p.m1,p.m2/total,true),body(p.m2,-p.m1/total,true)];
      const r=Math.hypot(x,y),force=interactionAt(p,r).force;
      return {bodies:p.frame==='lab'?lab:cm,frames:{lab,cm},relative:{x,y,vx,vy},
        centreOfMass:p.frame==='lab'?{x:cx,y:cy}:{x:0,y:0},
        force:{x:force*x/r,y:force*y/r},impactParameter:p.b,contact:lastContact,status};
    }
    return {get t(){return t;},step,reset,sample,invariants,geometry};
  },
};

// Numerical curve points carry a completion flag, so an unfinished encounter is
// never shown as a final scattering result. Relative angle is the CM angle.
export function scatteringCurve(values,impactParameters,{duration=30,dt=.1}={}) {
  if(!Array.isArray(impactParameters)||impactParameters.length>100 ||
    !Number.isFinite(duration)||duration<=0||duration>6000||!Number.isFinite(dt)||dt<=0||dt>60 ||
    Math.ceil(duration/dt)*impactParameters.length>100000)
    throw new RangeError('Invalid or excessive curve request');
  return impactParameters.map(b=>{
    const sim=model.create({...values,b}),first=sim.sample(),initial=first.separation;
    let complete=false;
    while(sim.t<duration) {
      sim.step(Math.min(dt,duration-sim.t));
      const s=sim.sample(),r=sim.geometry().relative;
      if(s.status!=='running') break;
      if(s.separation>=initial && r.x*r.vx+r.y*r.vy>0) {complete=true;break;}
    }
    const s=sim.sample(),p={...defaults,...values},reduced=p.m1*p.m2/(p.m1+p.m2);
    const epsilon=first.relativeSpeed**2/2+first.potential/reduced;
    const asymptotic=p.interaction==='coulomb'&&p.secondInteraction==='none'&&epsilon>0;
    const vInfinity=asymptotic?Math.sqrt(2*epsilon):0;
    return {b,angle:s.scatteringAngle,labAngle:Math.atan2(s.vy1,s.vx1),
      labAngleAvailable:Math.hypot(s.vx1,s.vy1)>1e-12,complete,status:s.status,t:s.t,
      asymptoticAvailable:asymptotic,bInfinity:asymptotic?Math.abs(b*first.relativeSpeed/vInfinity):0};
  });
}

// Classical axially symmetric cross section, on individual local branches:
// dσ/dΩ = | b / (sin θ * dθ/db) |. Multivalued branches are NOT silently summed.
export function differentialCrossSection(points,{frame='cm',coordinate='initial'}={}) {
  if(!Array.isArray(points)||points.length<3||points.length>10000||!['lab','cm'].includes(frame)||
    !['initial','asymptotic'].includes(coordinate))throw new RangeError('Invalid cross-section request');
  const rows=points.map(p=>({source:p,b:coordinate==='initial'?p.b:p.bInfinity,
    angle:Math.abs(frame==='cm'?p.angle:p.labAngle),valid:p.complete===true&&
      (frame==='cm'||p.labAngleAvailable===true)&&(coordinate==='initial'||p.asymptoticAvailable===true)}));
  for(let i=0;i<rows.length;i++) if(!Number.isFinite(rows[i].b)||rows[i].b<0||
    !Number.isFinite(rows[i].angle)||rows[i].angle>Math.PI+1e-10||i&&rows[i].b<=rows[i-1].b)
    throw new RangeError('Cross-section impact parameters must be finite, nonnegative and strictly increasing');
  return rows.map((row,i)=>{
    const out={b:row.b,angle:row.angle,sigma:0,logSigma:0,available:false,frame,coordinate,reason:'unfinished'};
    const indexes=i===0?[0,1,2]:i===rows.length-1?[i-2,i-1,i]:[i-1,i,i+1];
    const local=indexes.map(j=>rows[j]);
    if(!local.every(p=>p.valid))return out;
    // Derivative of the local quadratic interpolant handles nonuniform b grids.
    let derivative=0;
    for(let k=0;k<3;k++) {
      const j=(k+1)%3,l=(k+2)%3;
      derivative+=local[k].angle*(2*row.b-local[j].b-local[l].b)/
        ((local[k].b-local[j].b)*(local[k].b-local[l].b));
    }
    if(Math.abs(Math.sin(row.angle))<1e-10||Math.abs(derivative)<1e-10)
      return {...out,reason:'forward-or-caustic-singularity'};
    const left=local[1].angle-local[0].angle,right=local[2].angle-local[1].angle;
    if(left*right<0)return {...out,reason:'branch-turning-point'};
    const sigma=Math.abs(row.b/(Math.sin(row.angle)*derivative));
    if(!Number.isFinite(sigma)||sigma<=0)return {...out,reason:'degenerate'};
    return {...out,sigma,logSigma:Math.log(sigma),available:true,reason:''};
  });
}

export function sweepValues(min,max,count,{scale='linear',concentration=1}={}) {
  if(!Number.isFinite(min)||!Number.isFinite(max)||max<=min||!Number.isInteger(count)||count<2||count>100||
    !['linear','geometric'].includes(scale)||![1,2,3].includes(concentration)||scale==='geometric'&&min<=0)
    throw new RangeError('Invalid sweep grid');
  return Array.from({length:count},(_,i)=>{const f=(i/(count-1))**concentration;
    return scale==='linear'?min+(max-min)*f:min*(max/min)**f;});
}

export function collisionSweep(values,key,choices,options={}) {
  if(!params.some(p=>p.key===key)||!Array.isArray(choices)||choices.length>32||!choices.length||
    choices.length*Math.ceil((options.duration??30)/(options.dt??.1))>100000)
    throw new RangeError('Invalid or excessive collision sweep');
  return choices.map(value=>({key,value,...scatteringCurve({...values,[key]:value},
    [key==='b'?value:(values.b??defaults.b)],options)[0]}));
}

// Finite, JSON-serializable history data for later overlay/export UI. No disk I/O.
export function collisionTrace(values,{duration=10,dt=.05}={}) {
  if(!Number.isFinite(duration)||duration<=0||duration>6000||!Number.isFinite(dt)||dt<=0||dt>60||
    Math.ceil(duration/dt)>10000)throw new RangeError('Invalid trace bounds');
  const sim=model.create(values),samples=[];
  const capture=()=>samples.push({sample:sim.sample(),frames:sim.geometry().frames});capture();
  while(sim.t<duration&&sim.sample().status==='running') {sim.step(Math.min(dt,duration-sim.t));capture();}
  return {values:{...defaults,...values},samples,complete:sim.sample().status==='running'};
}
