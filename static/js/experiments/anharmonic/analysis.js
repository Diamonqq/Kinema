// Independent, bounded analysis utilities. No browser, files, or background jobs.
function limit(value, min, max, label, integer=false) {
  if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw new RangeError(`Invalid ${label}`);
  return value;
}
export function testSignal({shape='sine',count=512,dt=.01,frequency=1,phase=0}={}) {
  limit(count,2,4096,'sample count',true);limit(dt,1e-8,100,'sample interval');limit(frequency,0,1/(2*dt),'frequency');limit(phase,-1e6,1e6,'phase');
  if(!['sine','square','triangle'].includes(shape))throw new RangeError('Unknown test signal');
  return Array.from({length:count},(_,i)=>{const a=2*Math.PI*frequency*i*dt+phase;return shape==='sine'?Math.sin(a):shape==='square'?(Math.sin(a)>=0?1:-1):2/Math.PI*Math.asin(Math.sin(a));});
}
export function spectrum(data,dt,{window='flat',removeMean=false}={}) {
  if(!Array.isArray(data)||data.length<2||data.length>4096||data.some(x=>!Number.isFinite(x)))throw new RangeError('Expected 2..4096 finite samples');
  limit(dt,1e-8,100,'sample interval');
  if(!['flat','sine','sine-squared','triangle'].includes(window))throw new RangeError('Unknown window');
  let n=2;while(n<data.length)n*=2;
  const mean=removeMean?data.reduce((s,x)=>s+x,0)/data.length:0;
  const weights=data.map((_,i)=>{const u=i/(data.length-1);return window==='flat'?1:window==='sine'?Math.sin(Math.PI*u):window==='sine-squared'?Math.sin(Math.PI*u)**2:1-Math.abs(2*u-1);});
  const norm=weights.reduce((s,w)=>s+w,0);if(norm<1e-12)throw new RangeError('Too few samples for this window');
  const input=Array.from({length:n},(_,i)=>[i<data.length?(data[i]-mean)*weights[i]:0,0]);
  function transform(items){
    if(items.length===1)return items;
    const even=transform(items.filter((_,i)=>i%2===0)),odd=transform(items.filter((_,i)=>i%2));
    const out=new Array(items.length);
    for(let k=0;k<items.length/2;k++){
      const a=-2*Math.PI*k/items.length,c=Math.cos(a),s=Math.sin(a),r=c*odd[k][0]-s*odd[k][1],im=s*odd[k][0]+c*odd[k][1];
      out[k]=[even[k][0]+r,even[k][1]+im];out[k+items.length/2]=[even[k][0]-r,even[k][1]-im];
    }
    return out;
  }
  return transform(input).slice(0,n/2+1).map(([r,im],k)=>{
    const real=r/norm,imaginary=im/norm,magnitude=Math.hypot(real,imaginary);
    return {frequency:k/(n*dt),real,imaginary,magnitude,amplitude:magnitude*(k===0||k===n/2?1:2),phase:magnitude<1e-14?0:Math.atan2(imaginary,real)};
  });
}
export function sectionFrames(points,count){
  return Array.from({length:count},(_,phase)=>({phase:2*Math.PI*phase/count,points:points.filter(p=>p.frame===phase).map(({frame,...p})=>p)}));
}
export function returnPoints(points,velocityKey){
  return points.slice(1).map((p,i)=>({t:p.t,previous:points[i][velocityKey],current:p[velocityKey]}));
}
export function responsePoint(instance,frequency,{settleCycles=32,measureCycles=8,samplesPerCycle=64}={}){
  limit(frequency,.05,20,'drive frequency');limit(settleCycles,0,256,'transient cycles',true);limit(measureCycles,2,64,'measurement cycles',true);limit(samplesPerCycle,16,256,'samples per cycle',true);
  const T=2*Math.PI/frequency,dt=T/samplesPerCycle;
  if(T*(settleCycles+measureCycles)>3600)throw new RangeError('Response duration exceeds 3600 seconds');
  instance.step(settleCycles*T);
  const cycles=[];let lo=Infinity,hi=-Infinity,co=0,si=0,mean=0;
  for(let cycle=0;cycle<measureCycles;cycle++){
    const start=instance.sample();let cLo=Infinity,cHi=-Infinity;
    for(let i=0;i<samplesPerCycle;i++){
      const p=instance.sample();lo=Math.min(lo,p.x);hi=Math.max(hi,p.x);cLo=Math.min(cLo,p.x);cHi=Math.max(cHi,p.x);co+=p.x*Math.cos(frequency*p.t);si+=p.x*Math.sin(frequency*p.t);mean+=p.x;
      instance.step(dt);
    }
    const end=instance.sample();cycles.push({amplitude:(cHi-cLo)/2,residual:Math.hypot(end.x-start.x,(end.v-start.v)/frequency)});
  }
  const n=measureCycles*samplesPerCycle,last=cycles.at(-1),previous=cycles.at(-2);
  return {frequency,amplitude:(hi-lo)/2,harmonicAmplitude:2*Math.hypot(co,si)/n,phaseLag:Math.atan2(si,co),mean:mean/n,cycleResidual:last.residual,periodOneSettled:last.residual<1e-3*Math.max(1,last.amplitude)&&Math.abs(last.amplitude-previous.amplitude)<1e-3*Math.max(1,last.amplitude),final:instance.sample()};
}
export function measuredCycle(instance,{settle=80,duration=40,dt=.01}={}){
  limit(settle,0,600,'settling time');limit(duration,1,600,'measurement time');limit(dt,.001,.1,'sample interval');
  instance.step(settle);let before=instance.sample(),crossings=[];
  const count=Math.ceil(duration/dt),h=duration/count;
  for(let i=0;i<count;i++){
    instance.step(h);const after=instance.sample();
    if(before.x<0&&after.x>=0)crossings.push(before.t+h*(-before.x)/(after.x-before.x));
    before=after;
  }
  const periods=crossings.slice(1).map((t,i)=>t-crossings[i]).slice(-8);
  if(periods.length<2)return {period:null,spread:null,cycles:periods.length};
  const period=periods.reduce((s,T)=>s+T,0)/periods.length;
  return {period,spread:Math.max(...periods)-Math.min(...periods),cycles:periods.length};
}
