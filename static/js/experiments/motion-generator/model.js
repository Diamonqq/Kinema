import {param as p, observable as o, parameters, engine, rk4, verlet} from './numerics.js';
const params=[
  {key:'dimensions',label:'Dimensions',symbol:'d',unit:'',value:'1d',options:[{value:'1d',label:'1D'},{value:'2d',label:'2D'}]},
  p('mass','Mass','m','kg',.1,10,.1,1),
  p('x0','Initial x','x_0','m',-20,20,.1,1,'Initial conditions'),p('vx0','Initial x velocity','v_{x0}','m/s',-20,20,.1,0,'Initial conditions'),
  p('y0','Initial y','y_0','m',-20,20,.1,0,'Initial conditions'),p('vy0','Initial y velocity','v_{y0}','m/s',-20,20,.1,0,'Initial conditions'),
  p('gravity','Gravity','g','m/s²',0,20,.01,0,'Forces'),p('linearDrag','Linear drag','b','kg/s',0,10,.05,0,'Forces'),p('quadraticDrag','Quadratic drag','c','kg/m',0,5,.05,0,'Forces'),
  p('spring','Spring stiffness','k','N/m',0,100,.1,1,'Forces'),p('cubic','Cubic restoring','α','N/m³',0,10,.1,0,'Forces'),p('constantRestoring','Constant restoring force','s','N',0,10,.1,0,'Forces'),
  p('inverseSquare','Attraction strength','μ','m³/s²',0,20,.1,0,'Forces'),p('softening','Attraction core radius','ε','m',.01,2,.01,.1,'Forces'),
  p('magnetic','Magnetic rotation coefficient','qB','kg/s',-10,10,.1,0,'Forces'),p('forceX','Constant x force','F_x','N',-20,20,.1,0,'Forces'),p('forceY','Constant y force','F_y','N',-20,20,.1,0,'Forces'),
  p('ramp','Force ramp in x','a','N/s',-5,5,.1,0,'Drive'),p('drive','Drive force in x','F_d','N',0,20,.1,0,'Drive'),p('driveOmega','Drive frequency','Ω','rad/s',.05,20,.05,1,'Drive'),
];
const preset=(id,label,values,note)=>({id,label,values:Object.fromEntries(params.map(p=>[p.key,values[p.key]??p.value])),note});
export const model={id:'motion-generator',title:'Motion generator',params,
  presets:[preset('spring','Hooke’s law',{},'Acceleration points back toward equilibrium.'),preset('fall','Free fall',{x0:10,spring:0,gravity:9.81},'Position curves while velocity changes linearly.'),preset('terminal','Terminal speed',{x0:10,spring:0,gravity:9.81,linearDrag:1},'Linear drag eventually balances weight.'),preset('quadratic','Quadratic drag',{x0:10,spring:0,gravity:9.81,quadraticDrag:.5},'Drag grows with speed squared.'),preset('magnetic','Magnetic circle',{dimensions:'2d',x0:0,vx0:1,spring:0,magnetic:1},'A sideways force turns velocity without changing speed.'),preset('orbit','Softened attraction',{dimensions:'2d',x0:2,vy0:.7,spring:0,inverseSquare:1},'Central attraction conserves angular momentum; the core is softened.')],
  observables:[o('x','x position','x','m'),o('y','y position','y','m'),o('vx','x velocity','v_x','m/s'),o('vy','y velocity','v_y','m/s'),o('ax','x acceleration','a_x','m/s²'),o('ay','y acceleration','a_y','m/s²'),o('speed','Speed','v','m/s'),o('kinetic','Kinetic energy','K','J'),o('potential','Potential energy','U','J'),o('energy','Mechanical energy','E','J'),o('work','Applied work','W','J'),o('heat','Dissipated energy','Q','J')],
  create(values){
    const c=parameters(params,values), two=c.dimensions==='2d';
    const forces=(t,s)=>{
      const [x,vx,y,vy]=s, r=Math.hypot(x,y), speed=Math.hypot(vx,vy), drag=c.linearDrag+c.quadraticDrag*speed;
      const attract=c.mass*c.inverseSquare/(r*r+c.softening*c.softening)**1.5;
      const terms={spring:[-c.spring*x-c.cubic*x**3,-c.spring*y-c.cubic*y**3],constantRestoring:[-c.constantRestoring*Math.sign(x),-c.constantRestoring*Math.sign(y)],gravity:two?[0,-c.mass*c.gravity]:[-c.mass*c.gravity,0],drag:[-drag*vx,-drag*vy],attraction:[-attract*x,-attract*y],magnetic:two?[c.magnetic*vy,-c.magnetic*vx]:[0,0],applied:[c.forceX+c.ramp*t+c.drive*Math.cos(c.driveOmega*t),two?c.forceY:0]};
      if(!two) for(const f of Object.values(terms)) f[1]=0;
      return terms;
    };
    const accel=(t,s)=>{const terms=Object.values(forces(t,s));return [terms.reduce((a,f)=>a+f[0],0)/c.mass,terms.reduce((a,f)=>a+f[1],0)/c.mass];};
    const derivative=(t,s)=>{const [ax,ay]=accel(t,s), f=forces(t,s);return [s[1],ax,s[3],ay,(c.ramp*t+c.drive*Math.cos(c.driveOmega*t))*s[1],-(f.drag[0]*s[1]+f.drag[1]*s[3])];};
    // A cusp at x=0 uses RK4; smooth position-only forces use symplectic Verlet.
    const conservative=!c.linearDrag&&!c.quadraticDrag&&(!two||!c.magnetic)&&!c.drive&&!c.ramp&&!c.constantRestoring;
    const frequency=Math.sqrt((c.spring+3*c.cubic*400)/c.mass+c.inverseSquare/c.softening**3)+Math.abs(c.magnetic)/c.mass;
    const h=Math.min(.001,.025/Math.max(1,frequency));
    const e=engine([c.x0,c.vx0,two?c.y0:0,two?c.vy0:0,0,0],(s,t,h)=>conservative?verlet(s,t,h,accel,2):rk4(s,t,h,derivative),h);
    const sample=()=>{const [x,vx,y,vy,work,heat]=e.state,[ax,ay]=accel(e.t,e.state),r=Math.hypot(x,y),kinetic=c.mass*(vx*vx+vy*vy)/2;
      const potential=c.spring*r*r/2+c.cubic*(x**4+y**4)/4+c.constantRestoring*(Math.abs(x)+Math.abs(y))+c.mass*c.gravity*(two?y:x)-c.mass*c.inverseSquare/Math.sqrt(r*r+c.softening*c.softening)-(c.forceX*x+(two?c.forceY*y:0));
      // Constant applied forces are included in U, so work tracks only time-dependent drive.
      return {t:e.t,x,y,vx,vy,ax,ay,speed:Math.hypot(vx,vy),kinetic,potential,energy:kinetic+potential,work,heat};};
    const initialEnergy=sample().energy;
    return {get t(){return e.t;},step:dt=>e.step(dt),reset:()=>e.reset(),sample,
      forces:()=>forces(e.t,e.state),
      invariants(){const s=sample();return {energy:s.energy,momentum:[c.mass*s.vx,c.mass*s.vy],angularMomentum:c.mass*(s.x*s.vy-s.y*s.vx),energyBalance:s.energy-s.work+s.heat-initialEnergy};},
      geometry(){const s=sample();return {dimensions:two?2:1,position:[s.x,s.y,0],velocity:[s.vx,s.vy,0],acceleration:[s.ax,s.ay,0],origin:[0,0,0],forces:forces(e.t,e.state)};},
    };
  },
};
