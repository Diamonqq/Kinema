// Analytic special relativity. SI coordinates; diagram renderers plot ct, not t.
export const C = 299792458;
export function gamma(beta) {
  if (!Number.isFinite(beta) || Math.abs(beta) >= 1) throw new RangeError('|beta| must be < 1');
  return 1 / Math.sqrt((1 - beta) * (1 + beta));
}
export function boost(event, beta) {
  if(typeof beta==='object') {
    const a=transformFourVector([C*event.t,event.x,event.y??0,event.z??0],beta);
    return {...event,t:a[0]/C,x:a[1],y:a[2],z:a[3]};
  }
  const g = gamma(beta);
  return {...event, t:g * (event.t - beta * event.x / C),
    x:g * (event.x - beta * C * event.t), y:event.y ?? 0, z:event.z ?? 0};
}
// Components are [ct,x,y,z], metric signature +---. Direction is not restricted to x.
export function lorentzMatrix(beta) {
  const b=typeof beta==='number'?[beta,0,0]:[beta.x??0,beta.y??0,beta.z??0];
  const g=gamma(Math.hypot(...b)), k=g*g/(g+1);
  return Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>
    i===0&&j===0?g:i===0?-g*b[j-1]:j===0?-g*b[i-1]:(i===j?1:0)+k*b[i-1]*b[j-1]));
}
export function transformFourVector(a,beta) {
  if(!Array.isArray(a)||a.length!==4||!a.every(Number.isFinite))throw new RangeError('Four finite components required');
  return lorentzMatrix(beta).map(row=>row.reduce((sum,v,i)=>sum+v*a[i],0));
}
export function transformTensor(a,beta) {
  if(!Array.isArray(a)||a.length!==4||!a.every(row=>Array.isArray(row)&&row.length===4&&row.every(Number.isFinite)))throw new RangeError('Finite 4 by 4 tensor required');
  const m=lorentzMatrix(beta);
  return m.map(row=>m.map(col=>row.reduce((s,ri,i)=>s+ri*col.reduce((v,cj,j)=>v+cj*a[i][j],0),0)));
}
export function symmetrizeTensor(a,mode='none') {
  if(!['none','symmetric','antisymmetric'].includes(mode))throw new RangeError('Unknown tensor symmetry');
  return a.map((row,i)=>row.map((v,j)=>mode==='none'?v:mode==='symmetric'?(v+a[j][i])/2:(v-a[j][i])/2));
}
export const interval = (a, b = {t:0,x:0}) =>
  (C * (a.t-b.t)) ** 2 - (a.x-b.x) ** 2 - ((a.y??0)-(b.y??0)) ** 2 - ((a.z??0)-(b.z??0)) ** 2;
export function addVelocity(u, v) {
  if (![u,v].every(Number.isFinite) || Math.abs(u)>C || Math.abs(v)>=C) throw new RangeError('Invalid velocity');
  return (u+v)/(1+u*v/(C*C));
}
const scenarios = [
  ['moving-mirror','Catch a mirror'], ['comoving-mirrors','Moving light clock · along x'],
  ['light-clock','Light clock · across y'], ['simultaneity','Train lightning'],
  ['length-contraction','Measure a rod'], ['twins','Twin journey'],
  ['pole-barn','Pole and barn'], ['velocity-addition','Launch a rocket'],
  ['objects','Moving objects'], ['flashes','Two light flashes'],
  ['four-vector','Four-vector'], ['tensor','Rank-two tensor'],
];
const params = [
  {key:'scenario',label:'Experiment',unit:'',value:'moving-mirror',options:scenarios.map(([value,label])=>({value,label}))},
  {key:'frame',label:'Playback clock',unit:'',value:'ground',options:[{value:'ground',label:'Ground'},{value:'moving',label:'Moving frame'}]},
  {key:'beta',label:'Frame speed',symbol:'v/c',unit:'',min:-.95,max:.95,step:.01,value:.6,group:'Setup'},
  {key:'length',label:'Length scale',symbol:'L',unit:'m',min:1,max:3000000000,step:1,value:C,group:'Setup'},
  {key:'uBeta',label:'Rocket speed in moving frame',symbol:"u'/c",unit:'',min:-.95,max:.95,step:.01,value:.5,group:'Setup'},
  {key:'barnRatio',label:'Barn length / pole proper length',symbol:'B/L_0',unit:'',min:.1,max:2,step:.01,value:.8,group:'Setup'},
  ...['Y','Z'].map(axis=>({key:`beta${axis}`,label:`Frame ${axis.toLowerCase()} speed / c`,unit:'',min:-.95,max:.95,step:.01,value:0,group:'Advanced frame'})),
  {key:'objectType',label:'Object',unit:'',value:'rod',options:['rod','rocket','rectangle','barn','ball','flash'].map(value=>({value,label:value})),group:'Objects'},
  ...['X','Y','Z'].map(axis=>({key:`objectBeta${axis}`,label:`Object ${axis.toLowerCase()} speed / c`,unit:'',min:-.95,max:.95,step:.01,value:axis==='X'?.4:0,group:'Objects'})),
  ...['X','Y','Z'].map(axis=>({key:`offset${axis}`,label:`Initial ${axis.toLowerCase()}`,unit:'m',min:-3000000000,max:3000000000,step:1,value:0,group:'Objects'})),
  {key:'widthRatio',label:'Proper width / length',unit:'',min:.01,max:2,step:.01,value:.3,group:'Objects'},
  {key:'emissionTime',label:'Flash emission time',unit:'s',min:-10,max:10,step:.01,value:0,group:'Objects'},
  {key:'bodyCount',label:'Independent objects',unit:'objects',min:1,max:6,step:1,value:1,group:'Objects'},
  ...Array.from({length:5},(_,k)=>k+2).flatMap(n=>[
    {key:`body${n}Type`,label:`Object ${n}`,unit:'',value:'rod',options:['rod','rocket','rectangle','barn','ball','flash'].map(value=>({value,label:value})),group:`Object ${n}`},
    {key:`body${n}Length`,label:'Proper length',unit:'m',min:1,max:3000000000,step:1,value:C,group:`Object ${n}`},
    {key:`body${n}WidthRatio`,label:'Proper width / length',unit:'',min:.01,max:2,step:.01,value:.3,group:`Object ${n}`},
    {key:`body${n}EmissionTime`,label:'Flash emission time',unit:'s',min:-10,max:10,step:.01,value:0,group:`Object ${n}`},
    ...['X','Y','Z'].flatMap(axis=>[
      {key:`body${n}Beta${axis}`,label:`Velocity ${axis.toLowerCase()} / c`,unit:'',min:-.95,max:.95,step:.01,value:0,group:`Object ${n}`},
      {key:`body${n}Offset${axis}`,label:`Initial ${axis.toLowerCase()}`,unit:'m',min:-3000000000,max:3000000000,step:1,value:axis==='X'?(n-1)*C:0,group:`Object ${n}`},
    ]),
  ]),
  ...['Ct','X','Y','Z'].map((axis,i)=>({key:`vector${axis}`,label:`Four-vector ${axis}`,unit:'',min:-10,max:10,step:.01,value:i===1?1:0,group:'Four-vector'})),
  {key:'symmetry',label:'Tensor symmetry',unit:'',value:'antisymmetric',options:['none','symmetric','antisymmetric'].map(value=>({value,label:value})),group:'Tensor'},
  ...Array.from({length:16},(_,k)=>({key:`tensor${Math.floor(k/4)}${k%4}`,label:`Tensor ${Math.floor(k/4)},${k%4}`,unit:'',min:-10,max:10,step:.01,value:k===1?1:k===4?-1:0,group:'Tensor'})),
];
const notes = {
  'moving-mirror':'A fixed source sends light after a moving mirror. Closing speed c-v belongs to this frame.',
  'comoving-mirrors':'Both ends move. The outward and return times have different denominators.',
  'light-clock':'A transverse light path is longer in the ground frame; light still travels at c.',
  simultaneity:'Ground-simultaneous lightning strikes are not simultaneous in the train frame.',
  'length-contraction':'Measure both ends at the same time in the measuring frame.',
  twins:'Compare clocks when they reunite. The traveler changes inertial frames.',
  'pole-barn':'The barn doors close together in the barn frame; they do not close together in the pole frame.',
  'velocity-addition':'A rocket launched from a moving ship does not add velocities by ordinary addition.',
  objects:'Compare the same extended object on simultaneous slices in two frames.',
  flashes:'Each flash expands at c in both frames, although the emission events have different times.',
  'four-vector':'The components change while the Minkowski norm stays fixed.',
  tensor:'A rank-two tensor transforms on both indices. Antisymmetric components mix like electric and magnetic fields.',
};
const presets = scenarios.map(([id,label])=>({id,label,values:{...Object.fromEntries(params.map(s=>[s.key,s.value])),scenario:id,frame:'ground',beta:id==='pole-barn'?.8:.6,length:C,uBeta:.5,barnRatio:.8},note:notes[id]}));
function read(values) {
  const p={};
  for (const spec of params) {
    const v=values[spec.key]??spec.value;
    if (spec.options ? !spec.options.some(o=>o.value===v) : !Number.isFinite(v)||v<spec.min||v>spec.max)
      throw new RangeError(`Invalid ${spec.key}`);
    p[spec.key]=v;
  }
  if(Math.hypot(p.beta,p.betaY,p.betaZ)>=1||Math.hypot(p.objectBetaX,p.objectBetaY,p.objectBetaZ)>=1)throw new RangeError('Combined speed must be below c');
  if(!Number.isInteger(p.bodyCount))throw new RangeError('Integer body count required');
  for(let n=2;n<=p.bodyCount;n++)if(Math.hypot(p[`body${n}BetaX`],p[`body${n}BetaY`],p[`body${n}BetaZ`])>=1)throw new RangeError('Combined object speed must be below c');
  return p;
}
const point=(t,x,y=0,z=0)=>({t,x,y,z});
const advanced=p=>['objects','flashes','four-vector','tensor'].includes(p.scenario);
const frameBeta=p=>advanced(p)?{x:p.beta,y:p.betaY,z:p.betaZ}:p.beta;
const inverseBeta=b=>typeof b==='number'?-b:{x:-b.x,y:-b.y,z:-b.z};
function objectConfigs(p) {
  return Array.from({length:p.bodyCount},(_,i)=>{
    if(!i)return p;const n=i+1;
    return {...p,objectType:p[`body${n}Type`],length:p[`body${n}Length`],widthRatio:p[`body${n}WidthRatio`],emissionTime:p[`body${n}EmissionTime`],
      ...Object.fromEntries(['X','Y','Z'].flatMap(axis=>[[`objectBeta${axis}`,p[`body${n}Beta${axis}`]],[`offset${axis}`,p[`body${n}Offset${axis}`]]]))};
  });
}
function shape(type,L,w) {
  // Ball is a point tracer, as in the original; no sphere/collision dynamics implied.
  const xy=type==='rod'?[[-.5,0],[.5,0]]:type==='ball'?[[0,0]]:
    type==='rectangle'?[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]:
    type==='barn'?[[-.5,-.5],[.5,-.5],[.5,.25],[0,.85],[-.5,.25]]:
    [[.6,0],[.15,.5],[-.5,.5],[-.65,0],[-.5,-.5],[.15,-.5]];
  return xy.map(([x,y])=>({x:x*L,y:y*w,z:0}));
}
function bodyVertex(p,r,t,beta=0) {
  const u={x:p.objectBetaX,y:p.objectBetaY,z:p.objectBetaZ}, b=typeof beta==='number'?{x:beta,y:0,z:0}:beta;
  const gu=gamma(Math.hypot(u.x,u.y,u.z)),dot=u.x*r.x+u.y*r.y+u.z*r.z;
  const origin={x:p.offsetX+r.x-gu/(gu+1)*dot*u.x,y:p.offsetY+r.y-gu/(gu+1)*dot*u.y,z:p.offsetZ+r.z-gu/(gu+1)*dot*u.z};
  const gb=gamma(Math.hypot(b.x,b.y,b.z)),bu=b.x*u.x+b.y*u.y+b.z*u.z;
  const tg=(t/gb+(b.x*origin.x+b.y*origin.y+b.z*origin.z)/C)/(1-bu);
  return boost(point(tg,origin.x+C*u.x*tg,origin.y+C*u.y*tg,origin.z+C*u.z*tg),b);
}
export function lightWavefront(emission,time,beta=0,count=48) {
  if(!Number.isFinite(time)||!Number.isInteger(count)||count<4||count>512)throw new RangeError('Invalid wavefront sample');
  const origin=boost(emission,beta),radius=C*(time-origin.t);
  if(radius<0)return {emission:origin,visible:false,radius:0,rings:[]};
  // Three great circles provide xy, xz, yz spatial sections of the spherical front.
  const rings=[0,1,2].map(plane=>Array.from({length:count+1},(_,i)=>{
    const a=2*Math.PI*i/count,c=Math.cos(a)*radius,s=Math.sin(a)*radius;
    return point(time,origin.x+(plane===2?0:c),origin.y+(plane===0?s:plane===2?c:0),origin.z+(plane===0?0:s));
  }));
  return {emission:origin,visible:true,radius,rings};
}
function build(p) {
  const {beta:b,length:L}=p, v=b*C, g=gamma(b), T=L/C;
  let duration=4*T, events=[], lines=[];
  const event=(id,label,q)=>events.push({id,label,...q});
  const line=(id,label,kind,points)=>lines.push({id,label,kind,points});
  const straight=(id,label,x,u,end=duration,y=0)=>line(id,label,'body',[point(0,x,y),point(end,x+u*end,y)]);
  let catchTime=L/(C-v), returnTime=2*catchTime;
  switch(p.scenario) {
    case 'moving-mirror': case 'comoving-mirrors': {
      const movingSource=p.scenario==='comoving-mirrors';
      returnTime=movingSource?catchTime+L/(C+v):2*catchTime;
      duration=returnTime*1.15;
      const hit=point(catchTime,C*catchTime), end=point(returnTime,movingSource?v*returnTime:0);
      event('emit','Emission',point(0,0)); event('reflect','Reflection',hit); event('receive','Return',end);
      straight('source','Source',0,movingSource?v:0); straight('mirror','Mirror',L,v);
      line('light','Light','light',[point(0,0),hit,end]); break;
    }
    case 'light-clock': {
      // L is transverse mirror separation in the clock rest frame.
      duration=2*g*T*1.15;
      const hit=point(g*T,v*g*T,L), end=point(2*g*T,v*2*g*T);
      event('emit','Tick 0',point(0,0)); event('reflect','Top mirror',hit); event('receive','Tick 1',end);
      straight('lower','Lower mirror',0,v); straight('upper','Upper mirror',0,v,duration,L);
      line('light','Light','light',[point(0,0),hit,end]); break;
    }
    case 'simultaneity': {
      duration=2*T/(1-Math.abs(b));
      event('left-strike','Left strike',point(0,-L/2)); event('right-strike','Right strike',point(0,L/2));
      const a=point(T/(2*(1-b)),v*T/(2*(1-b))), z=point(T/(2*(1+b)),v*T/(2*(1+b)));
      event('left-received','Left flash received',a); event('right-received','Right flash received',z);
      straight('observer','Train observer',0,v);
      line('left-light','Left flash','light',[point(0,-L/2),a]);
      line('right-light','Right flash','light',[point(0,L/2),z]); break;
    }
    case 'length-contraction': case 'pole-barn': {
      duration=4*T;
      straight('rear','Rod rear',0,v); straight('front','Rod front',L/g,v);
      event('rear-measure','Rear at ground t = 0',point(0,0));
      event('front-measure','Front at ground t = 0',point(0,L/g));
      if(p.scenario==='pole-barn') {
        straight('door-left','Back door',0,0); straight('door-right','Front door',L*p.barnRatio,0);
        event('door-left-close','Back door closes',point(0,0));
        event('door-right-close','Front door closes',point(0,L*p.barnRatio));
      }
      break;
    }
    case 'twins': {
      duration=2*T;
      event('depart','Departure',point(0,0)); event('turn','Turnaround',point(T,v*T)); event('reunite','Reunion',point(2*T,0));
      straight('home','Home clock',0,0);
      line('traveler','Traveler','body',[point(0,0),point(T,v*T),point(2*T,0)]); break;
    }
    case 'velocity-addition': {
      straight('ship','Ship',0,v); straight('rocket','Rocket',0,addVelocity(p.uBeta*C,v));
      event('launch','Launch',point(0,0)); break;
    }
    case 'objects': {
      objectConfigs(p).forEach((a,n)=>{
        if(a.objectType==='flash')event(`flash-${n+1}`,`Flash ${n+1} emission`,point(a.emissionTime,a.offsetX,a.offsetY,a.offsetZ));
        else shape(a.objectType,a.length,a.widthRatio*a.length).forEach((r,i)=>line(`body-${n+1}-vertex-${i}`,`${a.objectType} ${n+1}`,'body',[bodyVertex(a,r,-12*T),bodyVertex(a,r,12*T)]));
      });
      break;
    }
    case 'flashes': {
      event('flash-left','Left emission',point(0,-L/2));event('flash-right','Right emission',point(0,L/2));break;
    }
  }
  return {duration,events,lines,catchTime,returnTime};
}
function sliceLine(line, t) {
  for(let i=1;i<line.points.length;i++) {
    const a=line.points[i-1],b=line.points[i];
    if(t>=a.t-1e-12 && t<=b.t+1e-12) {
      const f=(t-a.t)/(b.t-a.t);
      return {id:line.id,label:line.label,kind:line.kind,...point(t,a.x+f*(b.x-a.x),a.y+f*(b.y-a.y),(a.z??0)+f*((b.z??0)-(a.z??0)))};
    }
  }
  return null;
}
function ageOnSlice(line, t, beta) {
  let age=0;
  for(let i=1;i<line.points.length;i++) {
    const a=line.points[i-1],b=line.points[i],ta=boost(a,beta).t,tb=boost(b,beta).t;
    const dTau=Math.sqrt(Math.max(0,interval(b,a)))/C;
    age+=dTau*Math.max(0,Math.min(1,(t-ta)/(tb-ta)));
  }
  return age;
}
function properTicks(line, spacing) {
  if(line.kind==='light') return [];
  const ticks=[]; let elapsed=0, next=spacing;
  for(let i=1;i<line.points.length;i++) {
    const a=line.points[i-1],b=line.points[i], dTau=Math.sqrt(Math.max(0,interval(b,a)))/C;
    while(next<=elapsed+dTau+spacing*1e-10) {
      const f=dTau===0?0:(next-elapsed)/dTau;
      ticks.push({...point(a.t+f*(b.t-a.t),a.x+f*(b.x-a.x),a.y+f*(b.y-a.y),(a.z??0)+f*((b.z??0)-(a.z??0))),tau:next});
      next+=spacing;
    }
    elapsed+=dTau;
  }
  return ticks;
}
export const model={
  id:'minkowski',title:'Minkowski diagrams',params,presets,
  observables:[
    ['gamma','Lorentz factor','\\gamma',''],['groundTime','Ground time at ground origin','t','s'],
    ['movingTime','Moving time at ground origin',"t'",'s'],['properTime','Moving clock age','\\tau','s'],
    ['contractedLength','Rod length in ground frame','L_0/\\gamma','m'],
    ['simultaneityOffset','Offset for ground-simultaneous events separated by L',"\\Delta t'",'s'],
    ['rocketVelocity','Rocket speed in ground frame','u','m/s'],['catchTime','Catch time','t_c','s'],
    ['roundTripTime','Return time for selected source/mirror arrangement','t_r','s'],
    ['homeAge','Home twin age','t_H','s'],['travelerAge','Traveler age','\\tau_T','s'],
    ['vectorNorm','Four-vector Minkowski norm','A_\\mu A^\\mu',''],
    ['tensorContraction','Tensor invariant contraction','T_{\\mu\\nu}T^{\\mu\\nu}',''],
  ].map(([key,label,symbol,unit])=>({key,label,symbol,unit})),
  create(values={}) {
    const p=read(values), scene=build(p), b=frameBeta(p), g=gamma(advanced(p)?Math.hypot(p.beta,p.betaY,p.betaZ):p.beta), T=p.length/C;
    const vector=['Ct','X','Y','Z'].map(k=>p[`vector${k}`]);
    const tensor=symmetrizeTensor(Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>p[`tensor${i}${j}`])),p.symmetry);
    const vectorNorm=vector[0]**2-vector.slice(1).reduce((sum,x)=>sum+x*x,0);
    const tensorContraction=tensor.reduce((sum,row,i)=>sum+row.reduce((s,x,j)=>s+(i===0?1:-1)*(j===0?1:-1)*x*x,0),0);
    let t=0;
    // Time is the coordinate time of the selected playback frame. No hidden clamp.
    const groundOriginTime=()=>p.frame==='ground'?t:t/g;
    return {
      get t(){return t;},
      step(dt){if(!Number.isFinite(dt)||dt<0||!Number.isFinite(t+dt))throw new RangeError('dt must be finite and nonnegative'); t+=dt;},
      reset(){t=0;},
      sample(){
        const groundTime=groundOriginTime(), ageTime=Math.min(groundTime,2*T);
        const traveler=scene.lines.find(l=>l.id==='traveler');
        // groundTime/movingTime refer to the same ground-origin event; geometry
        // independently intersects every worldline with the chosen simultaneity slice.
        const ended=['moving-mirror','comoving-mirrors','light-clock','simultaneity','twins'].includes(p.scenario)&&t>=Math.max(...scene.events.map(e=>p.frame==='ground'?e.t:boost(e,b).t));
        return {t,ended,gamma:g,groundTime,movingTime:g*groundTime,properTime:(p.frame==='ground'?t/g:t),vectorNorm,tensorContraction,
          contractedLength:p.length/g,simultaneityOffset:-g*p.beta*p.length/C,
          rocketVelocity:addVelocity(p.uBeta*C,p.beta*C),catchTime:scene.catchTime,roundTripTime:scene.returnTime,
          homeAge:ageTime,travelerAge:traveler?ageOnSlice(traveler,t,p.frame==='ground'?0:p.beta):ageTime/g};
      },
      invariants(){return {c:C,vectorNorm,tensorContraction,lightIntervalMax:Math.max(0,...scene.lines.filter(l=>l.kind==='light').flatMap(l=>l.points.slice(1).map((q,i)=>Math.abs(interval(q,l.points[i])))))};},
      geometry(){
        const transform=q=>boost(q,b);
        const groundLines=scene.lines.map(l=>({...l,points:l.points.map(q=>({...q})),ticks:properTicks(l,T/4)}));
        const movingLines=groundLines.map(l=>({...l,points:l.points.map(transform),ticks:l.ticks.map(transform)}));
        const chosen=p.frame==='ground'?groundLines:movingLines;
        const objects=chosen.map(l=>sliceLine(l,t)).filter(Boolean);
        // Both panels display the SAME chosen-frame simultaneity slice, not unrelated now lines.
        const nowGround=p.frame==='ground'?[point(t,-4*p.length),point(t,4*p.length)]:
          [boost(point(t,-4*p.length),inverseBeta(b)),boost(point(t,4*p.length),inverseBeta(b))];
        const flashEvents=['flashes','objects'].includes(p.scenario)?scene.events:[];
        const groundFronts=flashEvents.map(e=>({id:e.id,...lightWavefront(e,t,0)}));
        const movingFronts=flashEvents.map(e=>({id:e.id,...lightWavefront(e,t,b)}));
        const fronts=p.frame==='ground'?groundFronts:movingFronts;
        const solids=p.scenario==='objects'?objectConfigs(p).flatMap((a,n)=>{
          if(a.objectType==='flash')return [];
          const vertices=shape(a.objectType,a.length,a.widthRatio*a.length);
          return [{id:`body-${n+1}`,type:a.objectType,ground:vertices.map(r=>bodyVertex(a,r,t)),moving:vertices.map(r=>bodyVertex(a,r,t,b))}];
        }):[];
        const vectorPrime=transformFourVector(vector,b),tensorPrime=transformTensor(tensor,b);
        const cube=Array.from({length:16},(_,i)=>Array.from({length:4},(_,j)=>(i>>j)&1?1:-1));
        const mapped=a=>cube.map(v=>a.map(row=>row.reduce((sum,x,i)=>sum+x*v[i],0)));
        const h=Array.from({length:65},(_,i)=>{const eta=-2+4*i/64;return point(T*Math.cosh(eta),p.length*Math.sinh(eta));});
        return {scenario:p.scenario,frame:p.frame,c:C,time:t,duration:scene.duration,
          ground:{events:scene.events.map(e=>({...e})),worldlines:groundLines,now:nowGround,wavefronts:groundFronts},
          moving:{events:scene.events.map(transform),worldlines:movingLines,now:nowGround.map(transform),wavefronts:movingFronts},
          objects,lightCone:[[-1,-1],[0,0],[1,1],[-1,1],[0,0],[1,-1]].map(([x,ct])=>point(ct*T,x*p.length)),
          wavefronts:fronts,solids,
          calculator:{vector:{ground:[...vector],moving:vectorPrime},tensor:{ground:tensor.map(row=>[...row]),moving:tensorPrime,symmetry:p.symmetry,cubeGround:mapped(tensor),cubeMoving:mapped(tensorPrime)},
            fieldAnalogy:{ground:{electric:tensor.slice(1).map(row=>row[0]),magnetic:[tensor[3][2],tensor[1][3],tensor[2][1]]},
              moving:{electric:tensorPrime.slice(1).map(row=>row[0]),magnetic:[tensorPrime[3][2],tensorPrime[1][3],tensorPrime[2][1]]}}},
          calibration:{ground:h,moving:h.map(transform)},
          barnFits:p.length/g<=p.length*p.barnRatio,
          units:{x:'m',y:'m',z:'m',t:'s',ct:'m',tau:'s'},
        };
      },
    };
  },
};
