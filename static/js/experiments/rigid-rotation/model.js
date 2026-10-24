// SI units; right-handed space frame, z up. Quaternion [w,x,y,z] maps body to space.
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const norm = a => Math.hypot(...a);
const mul = (a,b) => [a[0]*b[0]-dot(a.slice(1),b.slice(1)),
  a[0]*b[1]+b[0]*a[1]+a[2]*b[3]-a[3]*b[2],
  a[0]*b[2]+b[0]*a[2]+a[3]*b[1]-a[1]*b[3],
  a[0]*b[3]+b[0]*a[3]+a[1]*b[2]-a[2]*b[1]];
const conjugate = q => [q[0],-q[1],-q[2],-q[3]];
const rotate = (q,v) => mul(mul(q,[0,...v]),conjugate(q)).slice(1);
const normalized = q => { const n=norm(q); return q.map(v=>v/n); };
const number = (key,label,symbol,unit,min,max,step,value,group) => ({key,label,symbol,unit,min,max,step,value,group});
const choice = (key,label,value,options) => ({key,label,symbol:'',unit:'',value,options:options.map(value=>({value,label:value})),group:'Body'});
const params = [
  choice('mode','Motion','free',['free','heavy-top','fixed-axis']),
  choice('shape','Mass distribution','custom',['custom','box','plate','rod','symmetric-top']),
  choice('initial','Initial motion','components',['components','slow','fast']),
  number('mass','Mass','m','kg',.05,20,.05,1,'Body'),
  number('a','Width / diameter','a','m',.02,3,.01,1,'Body'),
  number('b','Depth','b','m',.002,3,.001,.6,'Body'),
  number('c','Height / length','c','m',.002,3,.001,.2,'Body'),
  ...[1,2,3].map((i)=>number('I'+i,'Principal moment '+i,'I_'+i,'kg m²',.000001,100,.000001,[.3,.5,.7][i-1],'Custom inertia')),
  ...[1,2,3].map((i)=>number('w'+i,'Initial body rate '+i,'ω_'+i,'rad/s',-100,100,.001,[.05,4,.02][i-1],'Initial conditions')),
  number('tilt','Initial tilt','θ₀','rad',0,Math.PI,.01,.5,'Initial conditions'),
  number('azimuth','Initial azimuth','φ₀','rad',-6.3,6.3,.001,0,'Initial conditions'),
  number('phase','Initial body phase','ψ₀','rad',-6.3,6.3,.001,0,'Initial conditions'),
  number('distance','Pivot to centre of mass','d','m',0,2,.01,.4,'Gravity'),
  number('g','Gravity','g','m/s²',0,30,.01,9.81,'Gravity'),
  ...['x','y','z'].map(i=>number('torque'+i,'Space torque '+i,'τ_'+i,'N m',-10,10,.01,0,'External torque')),
];

// Solid uniform bodies, not CUPS's eight corner masses. Rod is a slender cylinder
// with finite radius a/2, along body z; plate is the exact thin-lamina limit.
export function principalMoments(p) {
  const {mass:m,a,b,c}=p, r=a/2;
  if(p.shape==='box') return [m*(b*b+c*c)/12,m*(a*a+c*c)/12,m*(a*a+b*b)/12];
  if(p.shape==='plate') return [m*b*b/12,m*a*a/12,m*(a*a+b*b)/12];
  if(p.shape==='rod'||p.shape==='symmetric-top') return [m*(3*r*r+c*c)/12,m*(3*r*r+c*c)/12,m*r*r/2];
  return [p.I1,p.I2,p.I3];
}

// omega3 is the TOTAL body-axis component, not the Euler spin angle rate.
export function steadyPrecessionRates(I,omega3,m,g,d,theta) {
  const B=I[2]*omega3, A=I[0]*Math.cos(theta), C=m*g*d;
  const discriminant=B*B-4*A*C;
  if(discriminant<0) return null;
  if(Math.abs(A)<1e-14) return Math.abs(B)>1e-14 ? {slow:C/B,fast:null,discriminant} : null;
  const root=Math.sqrt(discriminant), far=(B+Math.sign(B||1)*root)/(2*A);
  const near=far===0 ? 0 : C/(A*far);
  return {slow:near,fast:far,discriminant};
}

export const model = {
  id:'rigid-rotation', title:'Rigid body rotation', version:'1.0.0', params,
  presets:[
    {id:'flip',label:'Intermediate-axis flip',values:{mode:'free',shape:'box',mass:1,a:1.2,b:.6,c:.12,w1:.015,w2:4,w3:.008,tilt:.5},note:'The middle principal axis is unstable.'},
    {id:'minimum',label:'Smallest moment',values:{mode:'free',shape:'box',a:1.2,b:.6,c:.12,w1:4,w2:.015,w3:.008},note:'A small wobble stays bounded.'},
    {id:'maximum',label:'Largest moment',values:{mode:'free',shape:'box',a:1.2,b:.6,c:.12,w1:.015,w2:.008,w3:4},note:'The largest-moment axis is also stable.'},
    {id:'free-top',label:'Free precession',values:{mode:'free',shape:'symmetric-top',mass:1,a:.8,c:.2,w1:1,w2:0,w3:8},note:'A fixed space angular momentum and a moving angular velocity.'},
    {id:'slow',label:'Slow precession',values:{mode:'heavy-top',shape:'symmetric-top',initial:'slow',mass:1,a:.8,c:.2,distance:.4,g:9.81,tilt:.6,w3:40},note:'Gravity turns angular momentum at constant tilt.'},
    {id:'fast',label:'Fast precession',values:{mode:'heavy-top',shape:'symmetric-top',initial:'fast',mass:1,a:.8,c:.2,distance:.4,g:9.81,tilt:.6,w3:40},note:'The second steady solution has the same spin and tilt.'},
    {id:'nutation',label:'Release a gyroscope',values:{mode:'heavy-top',shape:'symmetric-top',initial:'components',mass:1,a:.8,c:.2,distance:.4,g:9.81,tilt:1.1,w1:0,w2:0,w3:35},note:'A released spinning top both precesses and nods.'},
    {id:'torque',label:'Turn angular momentum',values:{mode:'free',shape:'box',w1:0,w2:0,w3:4,torquex:.1},note:'A constant space torque gives L(t) = L(0) + τt.'},
    {id:'fixed',label:'Constrained rotation',values:{mode:'fixed-axis',shape:'box',w1:2,w2:1,w3:3},note:'The support must supply ω × L.'},
    {id:'plate',label:'Thin plate',values:{mode:'free',shape:'plate',a:1,b:.6,w1:1,w2:.2,w3:3},note:'The perpendicular-axis relation is I₃ = I₁ + I₂.'},
    {id:'rod',label:'Long rod',values:{mode:'free',shape:'rod',a:.08,c:1.2,w1:.3,w2:0,w3:8},note:'Dimensions determine very different axial and transverse moments.'},
  ].map(p=>({...p,values:{...Object.fromEntries(params.map(p=>[p.key,p.value])),...p.values}})),
  observables:[
    ...['w1','w2','w3','omega'].map(key=>({key,label:key,symbol:key,unit:'rad/s'})),
    ...['Lx','Ly','Lz','angularMomentum'].map(key=>({key,label:key,symbol:key,unit:'kg m²/s'})),
    ...['kinetic','potential','energy','work'].map(key=>({key,label:key,symbol:key,unit:'J'})),
    {key:'theta',label:'Tilt',symbol:'θ',unit:'rad'},
    {key:'precessionRate',label:'Space precession rate',symbol:'φ̇',unit:'rad/s'},
    {key:'quaternionNorm',label:'Quaternion norm',symbol:'|q|',unit:''},
  ],
  create(values={}) {
    for(const key of Object.keys(values)) if(!params.some(p=>p.key===key)) throw new RangeError('Unknown parameter: '+key);
    const p=Object.fromEntries(params.map(d=>[d.key,values[d.key]??d.value]));
    for(const d of params) if(d.options ? !d.options.some(o=>o.value===p[d.key]) : !Number.isFinite(p[d.key])||p[d.key]<d.min||p[d.key]>d.max) throw new RangeError('Invalid '+d.key);
    const Icm=principalMoments(p);
    if(Icm.some((v,i)=>v>Icm[(i+1)%3]+Icm[(i+2)%3]+1e-12)) throw new RangeError('Principal moments must satisfy the triangle inequalities');
    const I=Icm.map((v,i)=>v+(p.mode==='heavy-top'&&i<2?p.mass*p.distance**2:0));
    if(p.mode==='heavy-top'&&Math.abs(I[0]-I[1])>1e-10) throw new RangeError('Heavy top requires equal transverse moments');
    const external=[p.torquex,p.torquey,p.torquez];
    if(p.mode==='fixed-axis'&&norm(external)>0) throw new RangeError('Fixed-axis mode computes the required support torque; external torque must be zero');
    if(p.initial!=='components'&&p.mode!=='heavy-top') throw new RangeError('Steady initial motion requires a heavy top');
    const zRotation=angle=>[Math.cos(angle/2),0,0,Math.sin(angle/2)];
    const q0=normalized(mul(mul(zRotation(p.azimuth),[Math.cos(p.tilt/2),0,Math.sin(p.tilt/2),0]),zRotation(p.phase)));
    let w0=[p.w1,p.w2,p.w3];
    const rates=p.mode==='heavy-top'?steadyPrecessionRates(I,p.w3,p.mass,p.g,p.distance,p.tilt):null;
    if(p.initial!=='components') {
      const rate=rates?.[p.initial];
      if(!Number.isFinite(rate)||Math.sin(p.tilt)<1e-8) throw new RangeError('No finite nonvertical steady-precession solution');
      const verticalBody=rotate(conjugate(q0),[0,0,1]);
      w0=[rate*verticalBody[0],rate*verticalBody[1],p.w3];
    }
    let state, time;
    const compute = s => {
      const w=s.slice(0,3), q=normalized(s.slice(3,7)), L=w.map((v,i)=>v*I[i]);
      const ws=rotate(q,w), Ls=rotate(q,L), axis=rotate(q,[0,0,1]);
      const r=axis.map(v=>p.distance*v), force=[0,0,-p.mass*p.g];
      const gravity=p.mode==='heavy-top'?cross(r,force):[0,0,0];
      const torque=p.mode==='fixed-axis'?cross(ws,Ls):external.map((v,i)=>v+gravity[i]);
      return {w,q,L,ws,Ls,axis,r,force,torque};
    };
    const derivative = s => {
      const {w,q,L,ws,torque}=compute(s), tb=rotate(conjugate(q),torque), gyroscopic=cross(w,L);
      const dw=p.mode==='fixed-axis'?[0,0,0]:tb.map((v,i)=>(v-gyroscopic[i])/I[i]);
      return [...dw,...mul(q,[0,...w]).map(v=>v/2),dot(external,ws)];
    };
    const offset=(s,k,h)=>s.map((v,i)=>v+h*k[i]);
    const api={
      get t(){return time;},
      reset(){state=[...w0,...q0,0];time=0;return api;},
      step(dt){
        if(!Number.isFinite(dt)||dt<0||dt>60) throw new RangeError('dt must be between 0 and 60 seconds');
        const end=time+dt;
        while(time<end){
          // Limit both physical time and angular advance; include anticipated torque acceleration.
          const {w,torque}=compute(state), accel=norm(torque)/Math.min(...I);
          const h=Math.min(end-time,.002,.01/(1+norm(w)+Math.sqrt(accel)));
          const a=derivative(state),b=derivative(offset(state,a,h/2)),c=derivative(offset(state,b,h/2)),d=derivative(offset(state,c,h));
          state=state.map((v,i)=>v+h*(a[i]+2*b[i]+2*c[i]+d[i])/6);
          state.splice(3,4,...normalized(state.slice(3,7)));
          time+=h;
        }
        time=end; return api;
      },
      sample(){
        const {w,q,Ls,axis,ws}=compute(state), kinetic=dot(w,w.map((v,i)=>v*I[i]))/2;
        const potential=p.mode==='heavy-top'?p.mass*p.g*p.distance*axis[2]:0;
        const da=cross(ws,axis), rho2=axis[0]**2+axis[1]**2;
        return {t:time,w1:w[0],w2:w[1],w3:w[2],omega:norm(w),Lx:Ls[0],Ly:Ls[1],Lz:Ls[2],angularMomentum:norm(Ls),kinetic,potential,energy:kinetic+potential,work:state[7],theta:Math.acos(Math.max(-1,Math.min(1,axis[2]))),precessionRate:rho2>1e-16?(axis[0]*da[1]-axis[1]*da[0])/rho2:0,quaternionNorm:norm(q)};
      },
      invariants(){const s=api.sample();return {energy:s.energy,angularMomentum:[s.Lx,s.Ly,s.Lz],angularMomentumMagnitude:s.angularMomentum,verticalAngularMomentum:s.Lz,bodyAxialAngularMomentum:I[2]*s.w3,work:s.work,energyMinusWork:s.energy-s.work};},
      geometry(){
        const o=compute(state), s=api.sample();
        return {quaternion:[...o.q],quaternionOrder:'wxyz',omegaBody:[...o.w],omegaSpace:[...o.ws],angularMomentumBody:[...o.L],angularMomentumSpace:[...o.Ls],torqueSpace:[...o.torque],torqueBody:rotate(conjugate(o.q),o.torque),principalMoments:[...I],centreMoments:[...Icm],principalAxes:[[1,0,0],[0,1,0],[0,0,1]],bodyAxisSpace:[...o.axis],origin:[0,0,0],centreOfMass:p.mode==='heavy-top'?[...o.r]:[0,0,0],gravityForce:p.mode==='heavy-top'?[...o.force]:[0,0,0],shape:p.shape,dimensions:{a:p.a,b:p.b,c:p.c},mode:p.mode,inertiaEllipsoidRadii:I.map(v=>Math.sqrt(2*s.kinetic/v)),polhodePoint:[...o.w],herpolhodePoint:[...o.ws],steadyPrecession:rates?{...rates}:null};
      },
    };
    return api.reset();
  },
};
