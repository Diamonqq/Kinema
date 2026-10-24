// Linear chain: M x'' + gamma M x' + K x = e1 F cos(Omega t).
// Independent implementation; symmetric mass-weighted eigensolve + exact modal
// propagator or velocity Verlet (conservative) / RK4 (damped or driven).
const numeric=(key,label,min,max,step,value,unit='',group='Motion')=>({key,label,min,max,step,value,unit,group});
const options=(key,label,value,items,group)=>({key,label,value,options:items.map(([value,label])=>({value,label})),group});
export const params=[
 numeric('n','Masses',2,10,1,2,'','Chain'),
 options('ends','Ends','walls',[['walls','Two walls'],['free','Free ends'],['left','Left wall'],['right','Right wall']],'Chain'),
 options('method','Solution','modes',[['modes','Normal modes'],['numerical','Numerical']],'Chain'),
 ...Array.from({length:10},(_,i)=>numeric('m'+(i+1),'Mass '+(i+1),.1,10,.1,1,'kg','Masses')),
 ...Array.from({length:11},(_,i)=>numeric('k'+(i+1),'Spring '+(i+1),.1,100,.1,i===1?2:20,'N/m','Springs')),
 numeric('gamma','Damping rate',0,2,.01,0,'s⁻¹','Damping & drive'),
 numeric('force','Drive amplitude',0,5,.01,0,'N','Damping & drive'),
 numeric('frequency','Drive frequency',.1,20,.01,4.47,'rad/s','Damping & drive'),
 options('modeA','First mode',0,[[0,'Manual'],...Array.from({length:10},(_,i)=>[i+1,'Mode '+(i+1)])],'Modes'),
 numeric('amplitudeA','First amplitude',-.3,.3,.01,.15,'m','Modes'),
 options('modeB','Second mode',0,[[0,'None'],...Array.from({length:10},(_,i)=>[i+1,'Mode '+(i+1)])],'Modes'),
 numeric('amplitudeB','Second amplitude',-.3,.3,.01,.15,'m','Modes'),
 ...Array.from({length:10},(_,i)=>numeric('x'+(i+1),'Displacement '+(i+1),-.3,.3,.01,i===0?.2:0,'m','Initial state')),
 ...Array.from({length:10},(_,i)=>numeric('v'+(i+1),'Velocity '+(i+1),-1,1,.01,0,'m/s','Initial state')),
];
export const defaults=Object.fromEntries(params.map(p=>[p.key,p.value]));
const base={...defaults,n:2,ends:'walls',method:'modes',m1:1,m2:1,k1:20,k2:2,k3:20};
export const presets=[
 {id:'mode1',label:'Mode 1',values:{...base,modeA:1,modeB:0,amplitudeA:.2},note:'Together: the middle spring keeps its length.'},
 {id:'mode2',label:'Mode 2',values:{...base,modeA:2,modeB:0,amplitudeA:.2},note:'Opposite motion stretches the middle spring.'},
 {id:'beats',label:'Beats',values:{...base,x1:.24,x2:0},note:'Energy passes between two nearly equal-frequency modes.'},
 {id:'driven',label:'Driven resonance',values:{...base,x1:0,x2:0,gamma:.2,force:.12,frequency:4.47},note:'A periodic push near the lower natural frequency.'},
 {id:'damped',label:'Damped',values:{...base,x1:.24,x2:0,gamma:.25},note:'Damping removes mechanical energy.'},
];

// Jacobi diagonalization of the real symmetric mass-weighted stiffness matrix.
export function normalModes(values={}) {
 const p={...defaults,...values},n=p.n,m=Array.from({length:n},(_,i)=>p['m'+(i+1)]);
 const springs=Array.from({length:n+1},(_,i)=>p['k'+(i+1)]);
 if(p.ends==='free'||p.ends==='right')springs[0]=0;
 if(p.ends==='free'||p.ends==='left')springs[n]=0;
 const a=Array.from({length:n},()=>Array(n).fill(0)),v=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>+(i===j)));
 for(let i=0;i<n;i++){a[i][i]=(springs[i]+springs[i+1])/m[i];if(i+1<n)a[i][i+1]=a[i+1][i]=-springs[i+1]/Math.sqrt(m[i]*m[i+1]);}
 for(let iter=0;iter<100*n*n;iter++){
  let r=0,s=1,big=0;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(Math.abs(a[i][j])>big){big=Math.abs(a[i][j]);r=i;s=j;}
  if(big<1e-12)break;
  const theta=.5*Math.atan2(2*a[r][s],a[s][s]-a[r][r]),c=Math.cos(theta),sn=Math.sin(theta),rr=a[r][r],ss=a[s][s],rs=a[r][s];
  a[r][r]=c*c*rr-2*c*sn*rs+sn*sn*ss;a[s][s]=sn*sn*rr+2*c*sn*rs+c*c*ss;a[r][s]=a[s][r]=0;
  for(let i=0;i<n;i++){if(i!==r&&i!==s){const ar=a[i][r],as=a[i][s];a[i][r]=a[r][i]=c*ar-sn*as;a[i][s]=a[s][i]=sn*ar+c*as;}const vr=v[i][r],vs=v[i][s];v[i][r]=c*vr-sn*vs;v[i][s]=sn*vr+c*vs;}
 }
 const modes=Array.from({length:n},(_,j)=>{const shape=m.map((mass,i)=>v[i][j]/Math.sqrt(mass));const sign=shape.find(x=>Math.abs(x)>1e-9)<0?-1:1;return {omega:Math.sqrt(Math.max(0,a[j][j])),shape:shape.map(x=>x*sign)};}).sort((a,b)=>a.omega-b.omega);
 return {masses:m,springs,modes};
}

function homogeneous(q,v,w,g,t){
 const a=g/2,d=w*w-a*a;
 if(Math.abs(d)<1e-12){const b=v+a*q,e=Math.exp(-a*t);return [e*(q+b*t),e*(b-a*(q+b*t))];}
 if(d>0){const z=Math.sqrt(d),c=Math.cos(z*t),s=Math.sin(z*t),b=(v+a*q)/z,e=Math.exp(-a*t);return [e*(q*c+b*s),e*((-q*z*s+b*z*c)-a*(q*c+b*s))];}
 const z=Math.sqrt(-d),r1=-a+z,r2=-a-z,A=(v-r2*q)/(r1-r2),B=q-A;
 return [A*Math.exp(r1*t)+B*Math.exp(r2*t),A*r1*Math.exp(r1*t)+B*r2*Math.exp(r2*t)];
}
function modalAt(q,v,w,g,f,O,t){
 const d=w*w-O*O,b=g*O,den=d*d+b*b;
 if(!f)return homogeneous(q,v,w,g,t);
 if(den<1e-14){ // undamped exact resonance
  const h=homogeneous(q,v,w,g,t),A=f/(2*O);return [h[0]+A*t*Math.sin(O*t),h[1]+A*(Math.sin(O*t)+O*t*Math.cos(O*t))];
 }
 const A=f*d/den,B=f*b/den,h=homogeneous(q-A,v-B*O,w,g,t);
 return [h[0]+A*Math.cos(O*t)+B*Math.sin(O*t),h[1]+O*(-A*Math.sin(O*t)+B*Math.cos(O*t))];
}
export function create(values={}){
 const p={...defaults,...values};
 if(Object.keys(values).some(key=>!params.some(p=>p.key===key)))throw RangeError('Unknown chain parameter.');
 for(const schema of params){const value=p[schema.key];if(schema.options?!schema.options.some(o=>o.value===value):!Number.isFinite(value)||value<schema.min||value>schema.max||Math.abs((value-schema.min)/schema.step-Math.round((value-schema.min)/schema.step))>1e-7)throw RangeError('Choose a valid '+schema.label.toLowerCase()+'.');}
 if(p.modeA>p.n||p.modeB>p.n)throw RangeError('Choose a mode available for this number of masses.');
 const n=p.n,{masses:m,springs:k,modes}=normalModes(p);
 let x=Array.from({length:n},(_,i)=>p['x'+(i+1)]),v=Array.from({length:n},(_,i)=>p['v'+(i+1)]);
 if(p.modeA>0){x=Array(n).fill(0);v=Array(n).fill(0);for(const [index,amp] of [[p.modeA,p.amplitudeA],[p.modeB,p.amplitudeB]]){const mode=modes[index-1];if(mode){const max=Math.max(...mode.shape.map(Math.abs));x=x.map((val,i)=>val+amp*mode.shape[i]/max);}}}
 const x0=x.slice(),v0=v.slice(),q0=modes.map(o=>x.reduce((s,val,i)=>s+m[i]*o.shape[i]*val,0)),u0=modes.map(o=>v.reduce((s,val,i)=>s+m[i]*o.shape[i]*val,0));
 let t=0;
 const force=(pos,vel,time)=>pos.map((val,i)=>-k[i]*(val-(pos[i-1]||0))-k[i+1]*(val-(pos[i+1]||0))-p.gamma*m[i]*vel[i]+(i===0?p.force*Math.cos(p.frequency*time):0));
 const acceleration=(pos,vel,time)=>force(pos,vel,time).map((f,i)=>f/m[i]);
 const api={params:p,modes,get t(){return t},get x(){return x.slice()},get v(){return v.slice()},
  reset(){t=0;x=x0.slice();v=v0.slice();},
  motionExtent(duration=60){
   const amplitudes=modes.map((o,j)=>{
    const w=o.omega,g=p.gamma,a=g/2,f=p.force*o.shape[0],O=p.frequency,d=w*w-O*O,b=g*O,den=d*d+b*b;
    const bound=(q,u)=>{const z=w*w-a*a;if(Math.abs(z)<1e-12)return Math.abs(q)+Math.abs(u+a*q)*duration;if(z>0)return Math.hypot(q,(u+a*q)/Math.sqrt(z));const r=Math.sqrt(-z),r1=-a+r,r2=-a-r,A=(u-r2*q)/(r1-r2);return Math.abs(A)+Math.abs(q-A);};
    if(!f)return bound(q0[j],u0[j]);
    if(den<1e-14)return bound(q0[j],u0[j])+Math.abs(f)*duration/(2*O);
    const A=f*d/den,B=f*b/den;return bound(q0[j]-A,u0[j]-B*O)+Math.hypot(A,B);
   });
   return Math.max(.35,...m.map((_,i)=>modes.reduce((sum,o,j)=>sum+Math.abs(o.shape[i])*amplitudes[j],0)));
  },
  step(dt){
   if(!Number.isFinite(dt)||dt<0||dt>60)throw Error('step requires 0 ≤ dt ≤ 60 s');
   if(p.method==='modes'){
    t+=dt;x=Array(n).fill(0);v=Array(n).fill(0);
    modes.forEach((o,j)=>{const [q,u]=modalAt(q0[j],u0[j],o.omega,p.gamma,p.force*o.shape[0],p.frequency,t);for(let i=0;i<n;i++){x[i]+=o.shape[i]*q;v[i]+=o.shape[i]*u;}});
   }else{
    const count=Math.max(1,Math.ceil(dt/Math.min(1/480,.02/Math.max(1,...modes.map(o=>o.omega))))),h=dt/count;
    for(let z=0;z<count;z++){
     if(!p.gamma&&!p.force){const a=acceleration(x,v,t),xn=x.map((val,i)=>val+v[i]*h+.5*a[i]*h*h),an=acceleration(xn,v,t+h);v=v.map((val,i)=>val+.5*(a[i]+an[i])*h);x=xn;}
     else {const a=acceleration(x,v,t),x2=x.map((val,i)=>val+v[i]*h/2),v2=v.map((val,i)=>val+a[i]*h/2),a2=acceleration(x2,v2,t+h/2),x3=x.map((val,i)=>val+v2[i]*h/2),v3=v.map((val,i)=>val+a2[i]*h/2),a3=acceleration(x3,v3,t+h/2),x4=x.map((val,i)=>val+v3[i]*h),v4=v.map((val,i)=>val+a3[i]*h),a4=acceleration(x4,v4,t+h);x=x.map((val,i)=>val+h*(v[i]+2*v2[i]+2*v3[i]+v4[i])/6);v=v.map((val,i)=>val+h*(a[i]+2*a2[i]+2*a3[i]+a4[i])/6);}
     t+=h;
    }
   }
   return api.sample();
  },
  invariants(){const kinetic=v.reduce((s,val,i)=>s+.5*m[i]*val*val,0);let potential=0;for(let i=0;i<=n;i++){const d=(x[i]||0)-(x[i-1]||0);potential+=.5*k[i]*d*d;}return {energy:kinetic+potential,kinetic,potential,momentum:v.reduce((s,val,i)=>s+m[i]*val,0)};},
  sample(){const out={t,...api.invariants()};x.forEach((val,i)=>{out['x'+(i+1)]=val;out['v'+(i+1)]=v[i]});modes.forEach((o,j)=>out['q'+(j+1)]=x.reduce((s,val,i)=>s+m[i]*o.shape[i]*val,0));return out;},
  geometry(){return {masses:m.map((mass,i)=>({mass,x:1.3*(i+1)+x[i],equilibrium:1.3*(i+1),displacement:x[i],velocity:v[i]})),springs:k,forces:force(x,v,t),length:1.3*(n+1),frequencies:modes.map(o=>o.omega)};},
 };
 return api;
}
export const model={id:'coupled-oscillators',title:'Coupled oscillators',params,presets,observables:Array.from({length:10},(_,i)=>({key:'x'+(i+1),label:'Displacement '+(i+1),unit:'m'})),create};
