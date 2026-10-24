// Independent Newtonian mechanics. All lengths, masses and times are SI.
import {createNBody,scenarioBodies,replicateBodies} from './nbody.js';
export {createNBody,stateFromElements,orbitalElements,replicateBodies} from './nbody.js';
export const G = 6.67430e-11;
const number = (key,label,symbol,unit,min,max,step,value,group='Launch') =>
  ({key,label,symbol,unit,min,max,step,value,group});
const choice = (key,label,value,options) => ({key,label,symbol:'',unit:'',value,
  options:options.map(([value,label])=>({value,label})),group:'View'});
const params = [
  number('m1','Primary mass','m_1','kg',1e10,1e14,1e10,1e12,'Masses'),
  number('m2','Companion mass','m_2','kg',1e10,1e14,1e10,1e11,'Masses'),
  number('r0','Initial separation','r_0','m',1,100,.1,10),
  number('vx0','Radial launch speed','v_{r0}','m/s',-30,30,.01,0),
  number('vy0','Tangential launch speed','v_{t0}','m/s',-30,30,.01,1.9),
  choice('launch','Launch','custom', [['custom','Custom velocity'],['circular','Circular'],
    ['transfer','Hohmann first burn'],['escape','Escape threshold']]),
  number('targetRadius','Transfer destination','r_2','m',1,100,.1,20),
  number('alpha','Extra inverse-cube attraction','\\alpha','m',0,1,.01,0,'Force'),
  choice('frame','Frame','primary',[['cm','Center of mass'],['primary','Primary body'],['secondary','Body 2'],
    ['third','Body 3'],['universe','Inertial'],['rotating','Rotating with bodies 1–2']]),
  choice('system','System','two-body', [['two-body','Two bodies'],['custom-nbody','Custom 3–5 bodies'],
    ['sun-earth-moon','Sun–Earth–Moon analogue'],['solar-system','Solar system analogue'],
    ['docking','Shuttle docking analogue'],['jupiter-comet','Jupiter and comet analogue'],
    ['jupiter-moons','Jupiter moons analogue'],['lagrange','Lagrange probes'],
    ['binary-comet','Binary stars and comet'],['retrograde','Apparent retrograde motion']]),
  number('bodyCount','Custom body count','N','',3,5,1,3,'Extra bodies'),
  ...[3,4,5].flatMap(n=>[
    number(`m${n}`,`Mass ${n}`,`m_${n}`,'kg',0,1e14,1e8,n===3?1e9:0,'Extra bodies'),
    number(`x${n}`,`Body ${n} x`,`x_${n}`,'m',-1000,1000,.01,n===3?13:n===4?-15:0,'Extra bodies'),
    number(`y${n}`,`Body ${n} y`,`y_${n}`,'m',-1000,1000,.01,n===5?20:0,'Extra bodies'),
    number(`vx${n}`,`Body ${n} x speed`,`v_{${n}x}`,'m/s',-100,100,.01,n===5?-2:0,'Extra bodies'),
    number(`vy${n}`,`Body ${n} y speed`,`v_{${n}y}`,'m/s',-100,100,.01,n===3?5:n===4?-2:0,'Extra bodies')]),
  number('gravityScale','Gravity multiplier','G/G_0','',0,10,.01,1,'Force'),
  number('maxStep','Maximum physics step','h','s',.0001,.1,.0001,.01,'Accuracy'),
  choice('timeDirection','Physical time','forward',[['forward','Forward'],['reverse','Reverse']]),
  number('thrustBody','Thrust body','i','',1,5,1,2,'Thrust'),
  number('thrustAlong','Along / inertial x acceleration','a_t','m/s²',-1,1,.001,0,'Thrust'),
  number('thrustNormal','Left normal / inertial y acceleration','a_n','m/s²',-1,1,.001,0,'Thrust'),
  number('burnStart','Burn start','t_b','s',0,60,.1,0,'Thrust'),
  number('burnDuration','Burn duration (0 = continuous)','\\Delta t_b','s',0,600,.1,0,'Thrust'),
  choice('thrustFrame','Thrust directions','velocity',[['velocity','Along velocity / left normal'],['inertial','Inertial x / y']]),
  number('replicas','Nearby test probes','N_p','',0,12,1,0,'Probes'),
  number('replicaSpread','Probe x spacing','\\delta x','m',.001,1,.001,.01,'Probes'),
  number('boostX','Inertial drift x','V_x','m/s',-5,5,.01,0,'View'),
  number('boostY','Inertial drift y','V_y','m/s',-5,5,.01,0,'View'),
];
const defaults = Object.fromEntries(params.map(p=>[p.key,p.value]));
const preset = (id,label,values,note)=>({id,label,values:{...defaults,...values},note});
export const model = {
  id:'orbits',title:'Gravitational orbits',params,
  presets:[
    preset('circular','Circular',{launch:'circular'},'Gravity supplies exactly the centripetal acceleration.'),
    preset('ellipse','Equal areas',{},'The companion speeds up near the primary; equal times sweep equal areas.'),
    preset('binary','Binary stars',{m2:1e12,launch:'circular',frame:'cm'},'Both equal masses orbit the stationary center of mass.'),
    preset('transfer','Hohmann first burn',{launch:'transfer'},'One launch impulse enters the transfer ellipse; the second circularizing burn is not applied.'),
    preset('escape','Just escape',{launch:'escape'},'Zero relative energy is the boundary between bound and unbound motion.'),
    preset('precession','Precessing ellipse',{alpha:.6},'An added inverse-cube force rotates the line of apsides; this is a toy force, not general relativity.'),
    ...[['custom-nbody','Three gravitating bodies'],['sun-earth-moon','Sun–Earth–Moon'],['solar-system','Solar system'],
      ['docking','Shuttle docking'],['jupiter-comet','Comet encounter'],['jupiter-moons','Jupiter moons'],
      ['lagrange','Lagrange probes'],['binary-comet','Binary and comet'],['retrograde','Retrograde motion']]
      .map(([system,label])=>preset(system,label,{system},'Compact planar teaching analogue; not an ephemeris.')),
    preset('thrust','Prograde thrust',{launch:'circular',thrustAlong:.01},'Continuous acceleration adds orbital energy; its work and impulse are tracked.'),
  ],
  observables:[['r','Separation','r','m'],['radialSpeed','Radial speed','v_r','m/s'],['speed','Relative speed','v','m/s'],
    ['energy','Energy','E','J'],['kinetic','Kinetic energy','K','J'],['potential','Potential energy','U','J'],
    ['angularMomentum','Angular momentum','L','kg m²/s'],['eccentricity','Osculating eccentricity','e',''],
    ['semiMajorAxis','Osculating semimajor axis','a','m'],['period','Kepler period','T','s'],
    ['periapsis','Inner turning radius','r_p','m'],['apoapsis','Outer turning radius','r_a','m'],
    ['escapeSpeed','Escape speed','v_e','m/s'],['sweptArea','Signed swept area','A','m²'],
    ['areaRate','Area rate','dA/dt','m²/s'],['work','Thruster work','W','J'],
    ['jacobi','Restricted circular Jacobi constant','C_J','m²/s²'],
    ['lineOfSightRate','Apparent angular speed','d\\phi/dt','rad/s']].map(([key,label,symbol,unit])=>({key,label,symbol,unit})),
  create(values={}) {
    const p={...defaults,...values};
    for (const key of Object.keys(values)) if (!(key in defaults)) throw new RangeError(`Unknown parameter ${key}`);
    for (const d of params) {
      if (d.options ? !d.options.some(o=>o.value===p[d.key]) :
        !Number.isFinite(p[d.key]) || p[d.key]<d.min || p[d.key]>d.max)
        throw new RangeError(`Invalid ${d.key}`);
    }
    if(![p.bodyCount,p.thrustBody,p.replicas].every(Number.isInteger)) throw new RangeError('Counts must be integers');
    const total=p.m1+p.m2, reduced=p.m1*p.m2/total, mu=G*p.gravityScale*total;
    if(p.system!=='two-body'||p.thrustAlong||p.thrustNormal||p.replicas||p.boostX||p.boostY||p.gravityScale===0||
      !['cm','primary'].includes(p.frame)) {
      let vx=p.vx0,vy=p.vy0;
      if(p.launch!=='custom')vx=0;
      if(p.launch==='circular')vy=Math.sqrt(mu/p.r0*(1+p.alpha/p.r0));
      if(p.launch==='escape')vy=Math.sqrt(mu*(2/p.r0+p.alpha/p.r0**2));
      if(p.launch==='transfer')vy=Math.sqrt(mu*(2/p.r0-2/(p.r0+p.targetRadius)));
      const binary=[{name:'Primary',mass:p.m1,x:-p.m2/total*p.r0,y:0,vx:-p.m2/total*vx,vy:-p.m2/total*vy},
        {name:'Companion',mass:p.m2,x:p.m1/total*p.r0,y:0,vx:p.m1/total*vx,vy:p.m1/total*vy}];
      let bodies=scenarioBodies(p,binary);
      bodies=bodies.map(b=>({...b,vx:b.vx+p.boostX,vy:b.vy+p.boostY}));
      if(p.replicas)bodies=replicateBodies(bodies,bodies.length-1,p.replicas,{dx:p.replicaSpread});
      if((p.thrustAlong||p.thrustNormal)&&p.thrustBody>bodies.length)throw new RangeError('Thrust body does not exist');
      return createNBody({bodies,gravity:G*p.gravityScale,alpha:p.alpha,maxStep:p.maxStep,
        direction:p.timeDirection==='reverse'?-1:1,frame:p.frame,
        thrust:{body:Math.min(p.thrustBody-1,bodies.length-1),along:p.thrustAlong,normal:p.thrustNormal,
          frame:p.thrustFrame,start:p.burnStart,duration:p.burnDuration}});
    }
    let x,y,vx,vy,t,area,status;
    const potential = r=>-reduced*mu*(1/r+p.alpha/(2*r*r));
    const acceleration = (x,y)=>{
      const r=Math.hypot(x,y), f=-mu*(1+p.alpha/r)/(r*r*r);
      return [f*x,f*y];
    };
    function reset() {
      x=p.r0;y=0;vx=p.vx0;vy=p.vy0;t=0;area=0;status='running';
      if (p.launch!=='custom') vx=0;
      if (p.launch==='circular') vy=Math.sqrt(mu/p.r0*(1+p.alpha/p.r0));
      if (p.launch==='escape') vy=Math.sqrt(mu*(2/p.r0+p.alpha/(p.r0*p.r0)));
      if (p.launch==='transfer') vy=Math.sqrt(mu*(2/p.r0-2/(p.r0+p.targetRadius)));
    }
    reset();
    const initialH=x*vy-y*vx;
    // Fixed kick-drift-kick mesh set by the initial periapsis timescale. Keeping
    // the mesh fixed preserves symplectic bounded energy error across many orbits.
    const specific0=(vx*vx+vy*vy)/2-mu/p.r0-mu*p.alpha/(2*p.r0*p.r0);
    const barrier0=(initialH*initialH-mu*p.alpha)/2;
    const estimatedPeri=barrier0>0 ?
      2*barrier0/(mu+Math.sqrt(Math.max(0,mu*mu+4*specific0*barrier0))) : 0;
    const captureTrajectory=estimatedPeri<.02;
    const peri=captureTrajectory ? p.r0 : estimatedPeri;
    const maxH=Math.min(p.maxStep,.001*Math.sqrt(peri**3/(mu*(1+p.alpha/peri))));
    function step(dt) {
      if (!Number.isFinite(dt)||dt<0||dt>60) throw new RangeError('dt must be 0..60 seconds');
      if (!dt) return;
      const n=Math.ceil(dt/maxH);
      if (n>2e6) throw new RangeError('Requested interval exceeds the integration budget; use a shorter step');
      let elapsed=0,count=0;
      while(elapsed<dt && status==='running') {
        const r=Math.hypot(x,y);
        if (r<.02) {status='close-encounter';break;}
        if(++count>2e6) throw new RangeError('Integration budget exceeded; use a shorter step');
        const h=(p.timeDirection==='reverse'?-1:1)*Math.min(dt-elapsed,dt/n,captureTrajectory ?
          .001*Math.sqrt(r**3/(mu*(1+p.alpha/r))) : Infinity);
        const a=acceleration(x,y);
        vx+=h*a[0]/2;vy+=h*a[1]/2;
        const nx=x+h*vx,ny=y+h*vy;
        // Do not integrate through the point-mass singularity. Frozen physical
        // state is explicitly flagged; the transport clock still advances dt.
        if (Math.hypot(nx,ny)<.02 || x*nx+y*ny<0 && Math.hypot(nx-x,ny-y)>Math.hypot(x,y)) {
          status='close-encounter';break;
        }
        area+=(x*ny-y*nx)/2;x=nx;y=ny;
        const b=acceleration(x,y);vx+=h*b[0]/2;vy+=h*b[1]/2;elapsed+=Math.abs(h);
      }
      t+=dt;
    }
    function invariants() {
      const r=Math.hypot(x,y),kinetic=reduced*(vx*vx+vy*vy)/2;
      return {energy:kinetic+potential(r),kinetic,potential:potential(r),
        momentum:{x:0,y:0},angularMomentum:reduced*(x*vy-y*vx)};
    }
    function sample() {
      const r=Math.hypot(x,y),h=x*vy-y*vx,v2=vx*vx+vy*vy;
      const energy=invariants(),epsilon=v2/2-mu/r;
      const eccentricity=Math.hypot(vy*h/mu-x/r,-vx*h/mu-y/r);
      const bound=energy.energy/reduced < -1e-12*mu/p.r0;
      const keplerBound=epsilon < -1e-12*mu/p.r0;
      const semiMajorAxis=Math.abs(epsilon)>1e-12*mu/p.r0 ? -mu/(2*epsilon) : 0;
      const specific=energy.energy/reduced,barrier=(h*h-mu*p.alpha)/2;
      // Turning points solve epsilon*r² + mu*r - barrier = 0. The stable
      // small root avoids cancellation near parabolic escape.
      const disc=Math.max(0,mu*mu+4*specific*barrier);
      const periapsis=barrier>0 ? 2*barrier/(mu+Math.sqrt(disc)) : 0;
      const apoapsis=specific < -1e-12*mu/p.r0 ? (-mu-Math.sqrt(disc))/(2*specific) : 0;
      return {t,r,radialSpeed:(x*vx+y*vy)/r,speed:Math.sqrt(v2),...energy,eccentricity,semiMajorAxis,
        period:keplerBound ? 2*Math.PI*Math.sqrt(semiMajorAxis**3/mu) : 0,
        periapsis,apoapsis,escapeSpeed:Math.sqrt(mu*(2/r+p.alpha/(r*r))),
        sweptArea:area,areaRate:h/2,bound,keplerExact:p.alpha===0,work:0,jacobi:0,
        jacobiApplicable:false,lineOfSightRate:0,bodyCount:2,status};
    }
    function geometry() {
      const body=(mass,f)=>({mass,x:f*x,y:f*y,vx:f*vx,vy:f*vy});
      const cm=[body(p.m1,-p.m2/total),body(p.m2,p.m1/total)];
      const primary=[body(p.m1,0),body(p.m2,1)];
      const a=acceleration(x,y),s=sample();
      return {bodies:p.frame==='cm'?cm:primary,frames:{cm,primary},relative:{x,y,vx,vy},
        force:{x:reduced*a[0],y:reduced*a[1]},centreOfMass:p.frame==='cm'?{x:0,y:0}:{x:p.m2/total*x,y:p.m2/total*y},
        elements:{a:s.semiMajorAxis,e:s.eccentricity,periapsis:s.periapsis,apoapsis:s.apoapsis},
        effectivePotential:effectivePotential(),status};
    }
    function effectivePotential() {
      const h=x*vy-y*vx,s=sample();
      const end=Math.max(p.r0*3,s.apoapsis*1.2),start=Math.max(.02,s.periapsis*.4);
      return {energy:s.energy,r:Math.hypot(x,y),turningPoints:[s.periapsis,s.apoapsis].filter(r=>r>0),
        points:Array.from({length:160},(_,i)=>{const r=start*(end/start)**(i/159);
          return {r,potential:potential(r)+reduced*h*h/(2*r*r)};})};
    }
    return {get t(){return t;},step,reset,sample,invariants,geometry};
  },
};
