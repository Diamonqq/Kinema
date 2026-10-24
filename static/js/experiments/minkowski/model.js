// Analytic special relativity. SI coordinates; diagram renderers plot ct, not t.
export const C = 299792458;
export function gamma(beta) {
  if (!Number.isFinite(beta) || Math.abs(beta) >= 1) throw new RangeError('|beta| must be < 1');
  return 1 / Math.sqrt((1 - beta) * (1 + beta));
}
export function boost(event, beta) {
  const g = gamma(beta);
  return {...event, t:g * (event.t - beta * event.x / C),
    x:g * (event.x - beta * C * event.t), y:event.y ?? 0, z:event.z ?? 0};
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
];
const params = [
  {key:'scenario',label:'Experiment',unit:'',value:'moving-mirror',options:scenarios.map(([value,label])=>({value,label}))},
  {key:'frame',label:'Playback clock',unit:'',value:'ground',options:[{value:'ground',label:'Ground'},{value:'moving',label:'Moving frame'}]},
  {key:'beta',label:'Frame speed',symbol:'v/c',unit:'',min:-.95,max:.95,step:.01,value:.6,group:'Setup'},
  {key:'length',label:'Length scale',symbol:'L',unit:'m',min:1,max:3000000000,step:1,value:C,group:'Setup'},
  {key:'uBeta',label:'Rocket speed in moving frame',symbol:"u'/c",unit:'',min:-.95,max:.95,step:.01,value:.5,group:'Setup'},
  {key:'barnRatio',label:'Barn length / pole proper length',symbol:'B/L_0',unit:'',min:.1,max:2,step:.01,value:.8,group:'Setup'},
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
};
const presets = scenarios.map(([id,label])=>({id,label,values:{scenario:id,frame:'ground',beta:id==='pole-barn'?.8:.6,length:C,uBeta:.5,barnRatio:.8},note:notes[id]}));
function read(values) {
  const p={};
  for (const spec of params) {
    const v=values[spec.key]??spec.value;
    if (spec.options ? !spec.options.some(o=>o.value===v) : !Number.isFinite(v)||v<spec.min||v>spec.max)
      throw new RangeError(`Invalid ${spec.key}`);
    p[spec.key]=v;
  }
  return p;
}
const point=(t,x,y=0)=>({t,x,y,z:0});
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
  }
  return {duration,events,lines,catchTime,returnTime};
}
function sliceLine(line, t) {
  for(let i=1;i<line.points.length;i++) {
    const a=line.points[i-1],b=line.points[i];
    if(t>=a.t-1e-12 && t<=b.t+1e-12) {
      const f=(t-a.t)/(b.t-a.t);
      return {id:line.id,label:line.label,kind:line.kind,...point(t,a.x+f*(b.x-a.x),a.y+f*(b.y-a.y))};
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
      ticks.push({...point(a.t+f*(b.t-a.t),a.x+f*(b.x-a.x),a.y+f*(b.y-a.y)),tau:next});
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
  ].map(([key,label,symbol,unit])=>({key,label,symbol,unit})),
  create(values={}) {
    const p=read(values), scene=build(p), g=gamma(p.beta), T=p.length/C;
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
        return {t,gamma:g,groundTime,movingTime:g*groundTime,properTime:(p.frame==='ground'?t/g:t),
          contractedLength:p.length/g,simultaneityOffset:-g*p.beta*p.length/C,
          rocketVelocity:addVelocity(p.uBeta*C,p.beta*C),catchTime:scene.catchTime,roundTripTime:scene.returnTime,
          homeAge:ageTime,travelerAge:traveler?ageOnSlice(traveler,t,p.frame==='ground'?0:p.beta):ageTime/g};
      },
      invariants(){return {c:C,lightIntervalMax:Math.max(0,...scene.lines.filter(l=>l.kind==='light').flatMap(l=>l.points.slice(1).map((q,i)=>Math.abs(interval(q,l.points[i])))))};},
      geometry(){
        const transform=q=>boost(q,p.beta);
        const groundLines=scene.lines.map(l=>({...l,points:l.points.map(q=>({...q})),ticks:properTicks(l,T/4)}));
        const movingLines=groundLines.map(l=>({...l,points:l.points.map(transform),ticks:l.ticks.map(transform)}));
        const chosen=p.frame==='ground'?groundLines:movingLines;
        const objects=chosen.map(l=>sliceLine(l,t)).filter(Boolean);
        // Both panels display the SAME chosen-frame simultaneity slice, not unrelated now lines.
        const nowGround=p.frame==='ground'?[point(t,-4*p.length),point(t,4*p.length)]:
          [boost(point(t,-4*p.length),-p.beta),boost(point(t,4*p.length),-p.beta)];
        const h=Array.from({length:65},(_,i)=>{const eta=-2+4*i/64;return point(T*Math.cosh(eta),p.length*Math.sinh(eta));});
        return {scenario:p.scenario,frame:p.frame,c:C,time:t,duration:scene.duration,
          ground:{events:scene.events.map(e=>({...e})),worldlines:groundLines,now:nowGround},
          moving:{events:scene.events.map(transform),worldlines:movingLines,now:nowGround.map(transform)},
          objects,lightCone:[[-1,-1],[0,0],[1,1],[-1,1],[0,0],[1,-1]].map(([x,ct])=>point(ct*T,x*p.length)),
          calibration:{ground:h,moving:h.map(transform)},
          barnFits:p.length/g<=p.length*p.barnRatio,
          units:{x:'m',y:'m',t:'s',ct:'m',tau:'s'},
        };
      },
    };
  },
};
