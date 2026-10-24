// Independent Newtonian two-body mechanics. All lengths, masses and times are SI.
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
  number('vy0','Tangential launch speed','v_{t0}','m/s',-30,30,.01,2.4),
  choice('launch','Launch','custom', [['custom','Custom velocity'],['circular','Circular'],
    ['transfer','Hohmann first burn'],['escape','Escape threshold']]),
  number('targetRadius','Transfer destination','r_2','m',1,100,.1,20),
  number('alpha','Extra inverse-cube attraction','\\alpha','m',0,1,.01,0,'Force'),
  choice('frame','Frame','cm',[['cm','Centre of mass'],['primary','Primary body']]),
];
const defaults = Object.fromEntries(params.map(p=>[p.key,p.value]));
const preset = (id,label,values,note)=>({id,label,values:{...defaults,...values},note});
export const model = {
  id:'orbits',title:'Gravitational orbits',params,
  presets:[
    preset('circular','Circular',{launch:'circular'},'Gravity supplies exactly the centripetal acceleration.'),
    preset('ellipse','Equal areas',{},'The companion speeds up near the primary; equal times sweep equal areas.'),
    preset('binary','Binary stars',{m2:1e12,launch:'circular'},'Both equal masses orbit the stationary centre of mass.'),
    preset('transfer','Hohmann first burn',{launch:'transfer'},'One launch impulse enters the transfer ellipse; the second circularising burn is not applied.'),
    preset('escape','Just escape',{launch:'escape'},'Zero relative energy is the boundary between bound and unbound motion.'),
    preset('precession','Precessing ellipse',{alpha:.6},'An added inverse-cube force rotates the line of apsides; this is a toy force, not general relativity.'),
  ],
  observables:[['r','Separation','r','m'],['speed','Relative speed','v','m/s'],
    ['energy','Energy','E','J'],['kinetic','Kinetic energy','K','J'],['potential','Potential energy','U','J'],
    ['angularMomentum','Angular momentum','L','kg m²/s'],['eccentricity','Osculating eccentricity','e',''],
    ['semiMajorAxis','Osculating semimajor axis','a','m'],['period','Kepler period','T','s'],
    ['periapsis','Inner turning radius','r_p','m'],['apoapsis','Outer turning radius','r_a','m'],
    ['escapeSpeed','Escape speed','v_e','m/s'],['sweptArea','Signed swept area','A','m²'],
    ['areaRate','Area rate','dA/dt','m²/s']].map(([key,label,symbol,unit])=>({key,label,symbol,unit})),
  create(values={}) {
    const p={...defaults,...values};
    for (const key of Object.keys(values)) if (!(key in defaults)) throw new RangeError(`Unknown parameter ${key}`);
    for (const d of params) {
      if (d.options ? !d.options.some(o=>o.value===p[d.key]) :
        !Number.isFinite(p[d.key]) || p[d.key]<d.min || p[d.key]>d.max)
        throw new RangeError(`Invalid ${d.key}`);
    }
    const total=p.m1+p.m2, reduced=p.m1*p.m2/total, mu=G*total;
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
    const maxH=Math.min(.01,.001*Math.sqrt(peri**3/(mu*(1+p.alpha/peri))));
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
        const h=Math.min(dt-elapsed,dt/n,captureTrajectory ?
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
        const b=acceleration(x,y);vx+=h*b[0]/2;vy+=h*b[1]/2;elapsed+=h;
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
      return {t,r,speed:Math.sqrt(v2),...energy,eccentricity,semiMajorAxis,
        period:keplerBound ? 2*Math.PI*Math.sqrt(semiMajorAxis**3/mu) : 0,
        periapsis,apoapsis,escapeSpeed:Math.sqrt(mu*(2/r+p.alpha/(r*r))),
        sweptArea:area,areaRate:h/2,bound,keplerExact:p.alpha===0,status};
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
