import {param as p, observable as o, parameters, engine, explicitStep, verlet} from './numerics.js';
const params=[
  {key:'dimensions',label:'Dimensions',symbol:'d',unit:'',value:'1d',options:[{value:'1d',label:'1D'},{value:'2d',label:'2D'},{value:'3d',label:'3D'}]},
  p('mass','Mass','m','kg',.1,10,.1,1),
  p('x0','Initial x','x_0','m',-20,20,.1,1,'Initial conditions'),p('vx0','Initial x velocity','v_{x0}','m/s',-20,20,.1,0,'Initial conditions'),
  p('y0','Initial y','y_0','m',-20,20,.1,0,'Initial conditions'),p('vy0','Initial y velocity','v_{y0}','m/s',-20,20,.1,0,'Initial conditions'),
  p('z0','Initial z','z_0','m',-20,20,.1,0,'Initial conditions'),p('vz0','Initial z velocity','v_{z0}','m/s',-20,20,.1,0,'Initial conditions'),
  {key:'method',label:'Integration method',unit:'',symbol:'method',value:'auto',options:[{value:'auto',label:'Automatic'},{value:'euler',label:'Euler (teaching)'},{value:'rk2',label:'Midpoint RK2 (teaching)'},{value:'rk4',label:'RK4'}]},p('timeStep','Internal time step','h','s',.0001,.1,.0001,.001,'Numerics'),
  p('gravity','Gravity','g','m/s²',0,20,.01,0,'Forces'),p('linearDrag','Linear drag','b','kg/s',0,10,.05,0,'Forces'),p('quadraticDrag','Quadratic drag','c','kg/m',0,5,.05,0,'Forces'),
  p('spring','Spring stiffness','k','N/m',-100,100,.1,1,'Forces'),p('cubic','Cubic restoring','\u03b2','N/m³',-10,10,.1,0,'Forces'),p('constantRestoring','Constant restoring force','s','N',-10,10,.1,0,'Forces'),
  p('inverseSquare','Attraction strength','μ','m³/s²',0,20,.1,0,'Forces'),p('softening','Attraction core radius','ε','m',.01,2,.01,.1,'Forces'),
  p('magnetic','Magnetic rotation coefficient','qB','kg/s',-10,10,.1,0,'Forces'),p('forceX','Constant x force','F_x','N',-20,20,.1,0,'Forces'),p('forceY','Constant y force','F_y','N',-20,20,.1,0,'Forces'),
  p('forceZ','Constant z force','F_z','N',-20,20,.1,0,'Forces'),p('ramp','Force ramp in x','a','N/s',-5,5,.1,0,'Drive'),p('drive','Drive force in x','F_d','N',0,20,.1,0,'Drive'),p('driveOmega','Drive frequency','Ω','rad/s',.05,20,.05,1,'Drive'),
];
const preset=(id,label,values,note)=>({id,label,values:Object.fromEntries(params.map(p=>[p.key,values[p.key]??p.value])),note});
export const model={id:'motion-generator',title:'Motion generator',params,
  presets:[preset('spatial','Spatial spring',{dimensions:'3d',x0:1,y0:.5,z0:.5,vy0:.5,vz0:1},'Three coordinates evolve in the same force field.'),preset('constant','Constant restoring',{spring:0,constantRestoring:1},'Each half of the trajectory has constant acceleration.'),preset('ramp','Force ramp',{spring:0,x0:0,ramp:1},'A linearly growing force produces cubic position.'),preset('softening','Softening spring',{cubic:-.2,x0:.5},'A negative cubic term weakens the restoring force.'),preset('resonance','Driven spring',{x0:0,linearDrag:.4,drive:.2},'The drive replaces energy lost to damping.'),preset('spring','Hooke’s law',{},'Acceleration points back toward equilibrium.'),preset('fall','Free fall',{x0:10,spring:0,gravity:9.81},'Position curves while velocity changes linearly.'),preset('terminal','Terminal speed',{x0:10,spring:0,gravity:9.81,linearDrag:1},'Linear drag eventually balances weight.'),preset('quadratic','Quadratic drag',{x0:10,spring:0,gravity:9.81,quadraticDrag:.5},'Drag grows with speed squared.'),preset('magnetic','Magnetic circle',{dimensions:'2d',x0:0,vx0:1,spring:0,magnetic:1},'A sideways force turns velocity without changing speed.'),preset('orbit','Softened attraction',{dimensions:'2d',x0:2,vy0:.7,spring:0,inverseSquare:1},'Central attraction conserves angular momentum; the core is softened.')],
  observables:[o('x','x position','x','m'),o('y','y position','y','m'),o('vx','x velocity','v_x','m/s'),o('vy','y velocity','v_y','m/s'),o('ax','x acceleration','a_x','m/s²'),o('ay','y acceleration','a_y','m/s²'),o('z','z position','z','m'),o('vz','z velocity','v_z','m/s'),o('az','z acceleration','a_z','m/s2'),o('speed','Speed','v','m/s'),o('kinetic','Kinetic energy','K','J'),o('potential','Potential energy','U','J'),o('energy','Mechanical energy','E','J'),o('work','Applied work','W','J'),o('heat','Dissipated energy','Q','J')],
  create(values){
    const c=parameters(params,values), n=c.dimensions==='3d'?3:c.dimensions==='2d'?2:1;
    const initial=[c.x0,c.vx0,n>1?c.y0:0,n>1?c.vy0:0,n>2?c.z0:0,n>2?c.vz0:0,0,0];
    const vectors=s=>({q:[s[0],s[2],s[4]],v:[s[1],s[3],s[5]]});
    const forces=(t,s)=>{
      const {q,v}=vectors(s),r=Math.hypot(...q),speed=Math.hypot(...v),drag=c.linearDrag+c.quadraticDrag*speed;
      const attract=c.mass*c.inverseSquare/(r*r+c.softening*c.softening)**1.5;
      const gravity=[0,0,0];gravity[n===1?0:1]=-c.mass*c.gravity;
      const terms={spring:q.map(x=>-c.spring*x-c.cubic*x**3),constantRestoring:q.map(x=>-c.constantRestoring*Math.sign(x)),gravity,drag:v.map(x=>-drag*x),attraction:q.map(x=>-attract*x),magnetic:n>1?[c.magnetic*v[1],-c.magnetic*v[0],0]:[0,0,0],applied:[c.forceX+c.ramp*t+c.drive*Math.cos(c.driveOmega*t),c.forceY,c.forceZ]};
      for(const f of Object.values(terms))for(let i=n;i<3;i++)f[i]=0;
      return terms;
    };
    const accel=(t,s)=>{const terms=Object.values(forces(t,s));return [0,1,2].map(i=>terms.reduce((sum,f)=>sum+f[i],0)/c.mass);};
    const derivative=(t,s)=>{const a=accel(t,s),f=forces(t,s),{v}=vectors(s);return [v[0],a[0],v[1],a[1],v[2],a[2],(c.ramp*t+c.drive*Math.cos(c.driveOmega*t))*v[0],-f.drag.reduce((sum,x,i)=>sum+x*v[i],0)];};
    const conservative=!c.linearDrag&&!c.quadraticDrag&&(n===1||!c.magnetic)&&!c.drive&&!c.ramp&&!c.constantRestoring;
    const frequency=Math.sqrt((Math.abs(c.spring)+3*Math.abs(c.cubic)*400)/c.mass+c.inverseSquare/c.softening**3)+Math.abs(c.magnetic)/c.mass;
    const h=c.method==='auto'?Math.min(c.timeStep,.001,.025/Math.max(1,frequency)):c.timeStep;
    const e=engine(initial,(s,t,h)=>c.method==='auto'&&conservative?verlet(s,t,h,accel,3):explicitStep(s,t,h,derivative,c.method),h);
    const sample=()=>{
      const {q,v}=vectors(e.state),[x,y,z]=q,[vx,vy,vz]=v,[ax,ay,az]=accel(e.t,e.state),r=Math.hypot(...q),kinetic=c.mass*v.reduce((sum,x)=>sum+x*x,0)/2;
      const potential=c.spring*r*r/2+c.cubic*q.reduce((sum,x)=>sum+x**4,0)/4+c.constantRestoring*q.reduce((sum,x)=>sum+Math.abs(x),0)+c.mass*c.gravity*(n===1?x:y)-c.mass*c.inverseSquare/Math.sqrt(r*r+c.softening*c.softening)-(c.forceX*x+(n>1?c.forceY*y:0)+(n>2?c.forceZ*z:0));
      return {t:e.t,x,y,z,vx,vy,vz,ax,ay,az,speed:Math.hypot(...v),kinetic,potential,energy:kinetic+potential,work:e.state[6],heat:e.state[7]};
    };
    const initialEnergy=sample().energy;
    return {get t(){return e.t;},step:dt=>e.step(dt),reset:()=>e.reset(),sample,forces:()=>forces(e.t,e.state),
      invariants(){const s=sample();return {energy:s.energy,momentum:[c.mass*s.vx,c.mass*s.vy,c.mass*s.vz],angularMomentum:c.mass*(s.x*s.vy-s.y*s.vx),angularMomentumVector:[c.mass*(s.y*s.vz-s.z*s.vy),c.mass*(s.z*s.vx-s.x*s.vz),c.mass*(s.x*s.vy-s.y*s.vx)],energyBalance:s.energy-s.work+s.heat-initialEnergy};},
      geometry(){const s=sample();return {dimensions:n,position:[s.x,s.y,s.z],velocity:[s.vx,s.vy,s.vz],acceleration:[s.ax,s.ay,s.az],origin:[0,0,0],forces:forces(e.t,e.state)};},
    };
  },
};
