// Local headless numerical utilities shared only by these three experiments.
export function parameters(schema, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Expected parameter values');
  for (const key of Object.keys(input)) if (!schema.some(p => p.key === key)) throw new RangeError(`Unknown parameter: ${key}`);
  return Object.fromEntries(schema.map(p => {
    const value = input[p.key] ?? p.value;
    if (p.options ? !p.options.some(o => o.value === value) : typeof value !== 'number' || !Number.isFinite(value) || value < p.min || value > p.max) throw new RangeError(`Invalid ${p.key}`);
    return [p.key, value];
  }));
}
export const param = (key, label, symbol, unit, min, max, step, value, group = 'Setup') => ({key,label,symbol,unit,min,max,step,value,group});
export const observable = (key,label,symbol,unit) => ({key,label,symbol,unit});
export function rk4(y,t,h,f) {
  const a=f(t,y), b=f(t+h/2,y.map((v,i)=>v+h*a[i]/2));
  const c=f(t+h/2,y.map((v,i)=>v+h*b[i]/2)), d=f(t+h,y.map((v,i)=>v+h*c[i]));
  return y.map((v,i)=>v+h*(a[i]+2*b[i]+2*c[i]+d[i])/6);
}
// Coordinates and velocities alternate; trailing work/heat entries stay constant.
export function verlet(y,t,h,acceleration,n) {
  const next=[...y], a=acceleration(t,y);
  for(let i=0;i<n;i++) { next[2*i]=y[2*i]+h*y[2*i+1]+h*h*a[i]/2; next[2*i+1]=y[2*i+1]+h*a[i]/2; }
  const b=acceleration(t+h,next);
  for(let i=0;i<n;i++) next[2*i+1]+=h*b[i]/2;
  return next;
}
export function engine(initial, evolve, maxStep, eventPeriod = 0, eventSample = y => [...y]) {
  let y=[...initial], t=0, event=1, points=[];
  return {
    get t(){return t;}, get state(){return y;},
    reset(){y=[...initial];t=0;event=1;points=[];},
    section(){return points.map(p=>({...p}));},
    step(dt){
      if(!Number.isFinite(dt)||dt<0||dt>3600) throw new RangeError('dt must be finite and between 0 and 3600 seconds');
      if(dt===0) return;
      const target=t+dt;
      if(target===t) throw new RangeError('Time resolution exhausted');
      // Work on local state: a rejected singular trajectory cannot corrupt a frame.
      let s=[...y], clock=t, count=0, index=event; const added=[];
      while(clock<target){
        if(++count>2000000) throw new RangeError('Integration budget exceeded; reduce dt');
        const mark=eventPeriod ? index*eventPeriod : Infinity;
        const end=Math.min(target,clock+maxStep,mark), h=end-clock;
        const next=evolve(s,clock,h);
        if(next.some(v=>!Number.isFinite(v)||Math.abs(v)>1e100)) throw new RangeError('Trajectory left the numerical domain');
        s=next;clock=end;
        if(clock===mark){added.push({t:clock,...eventSample(s)});index++;}
      }
      y=s;t=target;event=index;points=points.concat(added).slice(-4096);
    },
  };
}
// Complete elliptic integral K(k), arithmetic-geometric mean to double precision.
export function ellipticK(k) {
  if(!Number.isFinite(k)||k<0||k>1) throw new RangeError('0 <= k <= 1 required');
  if(k===1) return Infinity;
  let a=1,b=Math.sqrt((1-k)*(1+k));
  for(let i=0;i<60&&Math.abs(a-b)>2e-15*a;i++) [a,b]=[(a+b)/2,Math.sqrt(a*b)];
  return Math.PI/(a+b);
}
