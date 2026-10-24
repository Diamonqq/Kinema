import {param as p, observable as o, parameters, engine, rk4, verlet} from '../motion-generator/numerics.js';
const params=[{key:'potential',label:'Potential',symbol:'U',unit:'',value:'polynomial',options:[{value:'polynomial',label:'Polynomial / Duffing'},{value:'morse',label:'Morse'},{value:'lennard-jones',label:'Lennard-Jones'},{value:'walls',label:'Two-wall springs'},{value:'van-der-pol',label:'Van der Pol'}]},p('mass','Mass','m','kg',.1,10,.1,1),p('x0','Initial position','x_0','m',-5,5,.01,1,'Initial conditions'),p('v0','Initial velocity','v_0','m/s',-20,20,.1,0,'Initial conditions'),p('k','Quadratic stiffness','k','N/m',-20,100,.1,1,'Potential'),p('cubic','Cubic potential coefficient','a','N/m²',-10,10,.1,0,'Potential'),p('quartic','Quartic potential coefficient','β','N/m³',-10,20,.1,1,'Potential'),p('depth','Well depth','D / ε','J',.05,10,.05,1,'Potential'),p('width','Morse inverse width','a_M','1/m',.1,5,.1,1,'Potential'),p('equilibrium','Morse equilibrium','r_e','m',-3,3,.1,0,'Potential'),p('sigma','Lennard–Jones length','σ','m',.1,3,.1,1,'Potential'),p('halfSeparation','Half wall separation','d','m',.1,3,.1,.5,'Potential'),p('restLength','Spring rest length','ℓ_0','m',.1,3,.1,1,'Potential'),p('damping','Damping coefficient','b','kg/s',0,10,.01,0,'Drive'),p('drive','Drive force','F_d','N',0,20,.01,0,'Drive'),p('driveOmega','Drive frequency','Ω','rad/s',.05,20,.01,1,'Drive'),p('active','Van der Pol coefficient','μ','kg/(m²·s)',0,5,.05,1,'Drive'),p('limitScale','Van der Pol length scale','A','m',.1,3,.1,1,'Drive')];
const preset=(id,label,values,note)=>({id,label,values:Object.fromEntries(params.map(p=>[p.key,values[p.key]??p.value])),note});
function bisect(f,a,b){for(let i=0;i<70;i++){const m=(a+b)/2;if((f(a)>0)===(f(m)>0))a=m;else b=m;}return (a+b)/2;}
export const model={id:'anharmonic',title:'Anharmonic oscillator',params,
  presets:[preset('harmonic','Harmonic',{quartic:0},'The period is independent of amplitude.'),preset('hardening','Hardening',{},'A positive quartic term makes larger swings faster.'),preset('asymmetric','Asymmetric',{cubic:.6,quartic:.3,x0:.6},'The average position shifts away from the minimum.'),preset('double-well','Double well',{k:-1,quartic:1,x0:1.35},'Below the barrier, motion stays in one well.'),preset('morse','Molecular bond',{potential:'morse',x0:1},'A Morse bond softens as its energy approaches dissociation.'),preset('lj','Attraction & repulsion',{potential:'lennard-jones',x0:1.3},'Repulsion rises sharply at short separation.'),preset('walls','Buckling springs',{potential:'walls',k:4,x0:.6},'Compressed springs create two stable positions.'),preset('duffing','Driven Duffing',{k:-1,quartic:1,damping:.2,drive:.3,driveOmega:1.2,x0:1},'A periodic force can carry the mass between wells.'),preset('limit-cycle','Self-sustained',{potential:'van-der-pol',k:1,x0:.1},'Small motion gains energy; large motion loses it.')],
  observables:[o('x','Position','x','m'),o('v','Velocity','v','m/s'),o('acceleration','Acceleration','a_x','m/s²'),o('force','Restoring force','−U′','N'),o('kinetic','Kinetic energy','K','J'),o('potential','Potential energy','U','J'),o('energy','Mechanical energy','E','J'),o('work','Drive work','W','J'),o('heat','Reservoir energy transfer','Q','J')],
  create(values){
    const c=parameters(params,values);c.potential=['polynomial','morse','lennard-jones','walls','van-der-pol'].indexOf(c.potential);
    if(c.potential===2 && c.x0<=0) throw new RangeError('Lennard–Jones separation must be positive');
    if((c.potential===3||c.potential===4)&&c.k<=0) throw new RangeError('Wall springs and Van der Pol require positive k');
    const U=x=>{
      switch(c.potential){
        case 1:{const z=Math.exp(-c.width*(x-c.equilibrium));return c.depth*(1-z)**2;}
        case 2:{if(x<=0)return Infinity;const z=(c.sigma/x)**6;return 4*c.depth*(z*z-z);}
        case 3:return c.k*(Math.hypot(x,c.halfSeparation)-c.restLength)**2;
        case 4:return c.k*x*x/2;
        default:return c.k*x*x/2+c.cubic*x**3/3+c.quartic*x**4/4;
      }
    };
    const F=x=>{
      switch(c.potential){
        case 1:{const z=Math.exp(-c.width*(x-c.equilibrium));return -2*c.depth*c.width*z*(1-z);}
        case 2:{if(x<=0)throw new RangeError('Lennard–Jones singularity');const z=(c.sigma/x)**6;return 24*c.depth*(2*z*z-z)/x;}
        case 3:return -2*c.k*x*(1-c.restLength/Math.hypot(x,c.halfSeparation));
        case 4:return -c.k*x;
        default:return -c.k*x-c.cubic*x*x-c.quartic*x**3;
      }
    };
    const reservoir=(x,v)=>(c.damping-(c.potential===4?c.active*(c.limitScale*c.limitScale-x*x):0))*v;
    const accel=(t,s)=>[(F(s[0])-reservoir(s[0],s[1])+c.drive*Math.cos(c.driveOmega*t))/c.mass];
    const derivative=(t,s)=>[s[1],accel(t,s)[0],c.drive*Math.cos(c.driveOmega*t)*s[1],reservoir(s[0],s[1])*s[1]];
    const conservative=!c.damping&&!c.drive&&c.potential!==4;
    // Step doubling handles the steep molecular repulsive wall; no hard clipping.
    function adaptive(s,t,h,depth=0,budget={calls:0}){
      if(++budget.calls>8192)throw new RangeError('Molecular refinement budget exceeded; reduce energy');
      let full,half;
      try{full=rk4(s,t,h,derivative);half=rk4(rk4(s,t,h/2,derivative),t+h/2,h/2,derivative);}catch(err){if(depth>=25)throw err;return adaptive(adaptive(s,t,h/2,depth+1,budget),t+h/2,h/2,depth+1,budget);}
      const error=Math.max(...half.map((v,i)=>Math.abs(v-full[i])/(1+Math.abs(v))));
      if(Number.isFinite(error)&&error<1e-10)return half;
      if(depth>=25)throw new RangeError('Molecular trajectory cannot be resolved');
      return adaptive(adaptive(s,t,h/2,depth+1,budget),t+h/2,h/2,depth+1,budget);
    }
    const scale=Math.sqrt((Math.abs(c.k)+2*Math.abs(c.cubic)*5+3*Math.abs(c.quartic)*25)/c.mass);
    const h=Math.min(.001,.02/Math.max(1,scale,c.driveOmega,c.damping/c.mass));
    const e=engine([c.x0,c.v0,0,0],(s,t,h)=>c.potential===1||c.potential===2?adaptive(s,t,h):conservative?verlet(s,t,h,accel,1):rk4(s,t,h,derivative),h,c.drive?2*Math.PI/c.driveOmega:0,s=>({x:s[0],v:s[1]}));
    const sample=()=>{const [x,v,work,heat]=e.state,kinetic=c.mass*v*v/2,potential=U(x);return {t:e.t,x,v,acceleration:accel(e.t,e.state)[0],force:F(x),kinetic,potential,energy:kinetic+potential,work,heat};};
    const initialEnergy=sample().energy;
    if(!Number.isFinite(initialEnergy)||!Number.isFinite(sample().force))throw new RangeError('Initial state is outside the numerical domain');
    // Nearest turning points delimit the connected allowed interval containing anchor.
    function turningPoints(energy=sample().energy,anchor=e.state[0]){
      if(!Number.isFinite(energy)||!Number.isFinite(anchor)||U(anchor)>energy+1e-9*Math.max(1,Math.abs(energy)))throw new RangeError('Anchor must lie in the energy-allowed region');
      const f=x=>U(x)-energy;
      return [-1,1].map(sign=>{
        let prev=anchor,delta=1e-7*Math.max(1,Math.abs(anchor));
        for(let i=0;i<1000;i++){
          const next=prev+sign*delta;
          if(f(next)>0) return Math.abs(f(prev))<1e-13?prev:bisect(f,prev,next);
          prev=next;delta*=1.035;
          if(Math.abs(prev)>1e6)return null;
        }
        return null;
      });
    }
    function periodAtEnergy(energy=sample().energy,anchor=e.state[0]){
      if(!conservative)return null;
      const [left,right]=turningPoints(energy,anchor);
      if(left===null||right===null)return Infinity;
      if(right-left<1e-7){const dx=1e-5,curvature=-(F(anchor+dx)-F(anchor-dx))/(2*dx);return curvature>0?2*Math.PI*Math.sqrt(c.mass/curvature):Infinity;}
      // At an interior unstable equilibrium E=U, the trajectory takes infinite
      // time to reach the saddle. Midpoint quadrature alone would miss this pole.
      let previous=left;
      for(let i=1;i<=512;i++){
        const x=left+(right-left)*i/512;
        if(F(previous)*F(x)<0||F(x)===0){
          const root=F(x)===0?x:bisect(F,previous,x);
          if(root>left+1e-8&&root<right-1e-8&&Math.abs(U(root)-energy)<1e-12*Math.max(1,Math.abs(energy)))return Infinity;
        }
        previous=x;
      }
      // x = midpoint + halfWidth sin(u) removes simple turning-point singularities.
      const center=(left+right)/2,r=(right-left)/2,n=4096,du=Math.PI/n;
      let integral=0;
      for(let i=0;i<n;i++){
        const u=-Math.PI/2+(i+.5)*du,x=center+r*Math.sin(u),gap=energy-U(x);
        if(gap<=0)return Infinity;
        integral+=r*Math.cos(u)/Math.sqrt(gap);
      }
      return Math.sqrt(2*c.mass)*integral*du;
    }
    return {get t(){return e.t;},step:dt=>e.step(dt),reset:()=>e.reset(),sample,potential:U,restoringForce:F,turningPoints,periodAtEnergy,period:()=>periodAtEnergy(),section:()=>e.section(),
      invariants(){const s=sample();return {energy:s.energy,momentum:c.mass*s.v,energyBalance:s.energy-s.work+s.heat-initialEnergy};},
      geometry(){const s=sample();return {position:[s.x,0,0],velocity:[s.v,0,0],potentialKind:c.potential,wallAnchors:[[0,-c.halfSeparation,0],[0,c.halfSeparation,0]],restLength:c.restLength,restoringForce:s.force,driveForce:c.drive*Math.cos(c.driveOmega*e.t),reservoirForce:-reservoir(s.x,s.v)};},
    };
  },
};
