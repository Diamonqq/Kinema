// Independently implemented SI mechanics. No DOM or CUPS implementation code.
const rad = Math.PI / 180;
const number = (key, label, symbol, unit, min, max, step, value, group) =>
  ({key,label,symbol,unit,min,max,step,value,group});
const choice = (key,label,value,options) => ({key,label,symbol:key,unit:'',value,group:'Air',options:options.map(value=>({value,label:value}))});
const params = [
  number('mass','Mass','m','kg',.001,50,.001,.145,'Object'),
  number('diameter','Diameter','d','m',.002,.5,.001,.074,'Object'),
  number('speed','Launch speed','v_0','m/s',0,200,.1,40,'Launch'),
  number('angle','Launch angle','α','°',0,90,.1,40,'Launch'),
  number('height','Release height','h','m',0,10000,.1,0,'Launch'),
  number('gravity','Gravity','g','m/s²',.1,25,.01,9.81,'World'),
  choice('drag','Drag law','quadratic',['vacuum','linear','quadratic','combined','sphere']),
  number('linear','Linear coefficient','b','kg/s',0,10,.001,.05,'Air'),
  number('cd','Drag coefficient','C_D','1',.01,2,.01,.47,'Air'),
  number('density','Sea-level density','ρ_0','kg/m³',.01,2,.001,1.225,'Air'),
  choice('atmosphere','Density profile','constant',['constant','exponential']),
  number('altitude','Ground altitude','z_0','m',0,10000,10,0,'Air'),
  number('scaleHeight','Density scale height','H','m',1000,20000,10,8500,'Air'),
  number('viscosity','Dynamic viscosity','η','Pa·s',.000001,.0001,.000001,.000018,'Air'),
  number('wind','Horizontal wind','w','m/s',-50,50,.1,0,'Air'),
  number('spin','Backspin','ω','rad/s',-1000,1000,1,0,'Object'),
];
export function resolve(values={}) {
  const p={};
  for(const d of params){ const v=values[d.key]??d.value;
    if(d.options ? !d.options.some(o=>o.value===v) : typeof v!=='number'||!Number.isFinite(v)||v<d.min||v>d.max)
      throw new RangeError(`Invalid ${d.key}`);
    p[d.key]=v;
  } return p;
}
export function airDensity(p,y=0){return p.density*(p.atmosphere==='exponential'?Math.exp(-(p.altitude+y)/p.scaleHeight):1);}
// Smooth sphere correlation: Stokes low-Re limit, intermediate correction,
// ~0.4 high-Re plateau. Deliberately excludes a surface-dependent drag crisis.
export function sphereCd(re){if(re<=0)return 0;return 24/re*(1+.15*re**.687)+.42/(1+42500/re**1.16);}
function air(p,s){
  const ux=s[2]-p.wind,uy=s[3],u=Math.hypot(ux,uy),rho=airDensity(p,s[1]);
  const reynolds=rho*u*p.diameter/p.viscosity;
  let k=0,cd=0;
  if(p.drag==='linear')k=p.linear;
  else if(p.drag!=='vacuum'){
    cd=p.drag==='sphere'?sphereCd(reynolds):p.cd;
    // Evaluate Stokes limit directly, avoiding infinity * zero at rest.
    k=u===0?(p.drag==='sphere'?3*Math.PI*p.viscosity*p.diameter:0):.5*rho*cd*Math.PI*p.diameter**2/4*u;
  }
  if(p.drag==='combined')k+=p.linear;
  const lift=p.drag==='vacuum'||u===0?0:.5*rho*Math.PI*p.diameter**2/4*u*Math.max(-.6,Math.min(.6,1.2*p.spin*p.diameter/(2*u)));
  const dx=-k*ux,dy=-k*uy,lx=-lift*uy,ly=lift*ux;
  return {fx:dx+lx,fy:dy+ly,dragX:dx,dragY:dy,liftX:lx,liftY:ly,rho,reynolds,cd,k,liftK:lift,dissipation:k*u*u,windPower:(dx+lx)*p.wind};
}
function derivative(p,s){const f=air(p,s);return [s[2],s[3],f.fx/p.mass,-p.gravity+f.fy/p.mass,f.dissipation,f.windPower];}
function rk4(p,s,h){const a=derivative(p,s),b=derivative(p,s.map((v,i)=>v+h*a[i]/2)),c=derivative(p,s.map((v,i)=>v+h*b[i]/2)),d=derivative(p,s.map((v,i)=>v+h*c[i]));return s.map((v,i)=>v+h*(a[i]+2*b[i]+2*c[i]+d[i])/6);}
// Still-air, no-spin local drag-only terminal speed. Vacuum has no terminal speed;
// return 0 plus hasTerminal=false so all numeric observables remain finite.
export function terminalVelocity(values={},height=0){
  const p=resolve(values);if(p.drag==='vacuum'||(p.drag==='linear'&&p.linear===0))return 0;
  if(p.drag==='linear')return p.mass*p.gravity/p.linear;
  let lo=0,hi=1;const q={...p,wind:0,spin:0};
  while(air(q,[0,height,0,-hi]).fy<p.mass*p.gravity)hi*=2;
  for(let i=0;i<70;i++){let mid=(lo+hi)/2;if(air(q,[0,height,0,-mid]).fy<p.mass*p.gravity)lo=mid;else hi=mid;}return (lo+hi)/2;
}
function create(values={}){
  const p=resolve(values);let t,s,flightTime,landed,apex,apexX,apexVx,apexTime,initialEnergy,impactLoss;
  function reset(){t=0;s=[0,p.height,p.speed*Math.cos(p.angle*rad),p.speed*Math.sin(p.angle*rad),0,0];flightTime=0;landed=p.height===0&&s[3]<=0;apex=p.height;apexX=0;apexVx=s[2];apexTime=0;initialEnergy=.5*p.mass*p.speed**2+p.mass*p.gravity*p.height;impactLoss=landed?.5*p.mass*(s[2]**2+s[3]**2):0;if(landed){s[2]=0;s[3]=0;}}
  reset();
  function step(dt){
    if(!Number.isFinite(dt)||dt<0||dt>600)throw new RangeError('dt must be 0..600 s');
    const target=t+dt;let remaining=dt;
    while(remaining>0&&!landed){
      const f=air(p,s),rate=(f.k+Math.abs(f.liftK))/p.mass;
      const h=Math.min(remaining,.01,.12/Math.max(rate,1e-12));
      let next=rk4(p,s,h),used=h;
      if(next[1]<0){let lo=0,hi=h;for(let i=0;i<38;i++){let mid=(lo+hi)/2;if(rk4(p,s,mid)[1]>=0)lo=mid;else hi=mid;}used=(lo+hi)/2;next=rk4(p,s,used);next[1]=0;landed=true;}
      // Resolve the actual apex inside a substep rather than sampling frame peaks.
      if(s[3]>0&&next[3]<=0){let lo=0,hi=used;for(let i=0;i<32;i++){let mid=(lo+hi)/2;if(rk4(p,s,mid)[3]>0)lo=mid;else hi=mid;}const local=rk4(p,s,(lo+hi)/2);if(local[1]>=apex){apex=local[1];apexX=local[0];apexVx=local[2];apexTime=flightTime+(lo+hi)/2;}}
      s=next;if(s[1]>apex){apex=s[1];apexX=s[0];apexVx=s[2];apexTime=flightTime+used;}flightTime+=used;remaining-=used;
    }if(landed&&Math.hypot(s[2],s[3])>0){impactLoss=.5*p.mass*(s[2]**2+s[3]**2);s[2]=0;s[3]=0;}t=target;
  }
  function invariants(){const kinetic=.5*p.mass*(s[2]**2+s[3]**2),potential=p.mass*p.gravity*s[1],energy=kinetic+potential;return {kinetic,potential,energy,dissipatedWork:s[4],windWork:s[5],impactLoss,accountedEnergy:energy+s[4]+impactLoss-s[5],initialEnergy,energyError:energy+s[4]+impactLoss-s[5]-initialEnergy};}
  function sample(){const f=air(p,s);return {t,x:s[0],y:s[1],vx:s[2],vy:s[3],speed:Math.hypot(s[2],s[3]),ax:landed?0:f.fx/p.mass,ay:landed?0:-p.gravity+f.fy/p.mass,flightTime,range:s[0],apex,apexX,apexVx,apexTime,landed,ended:landed,airSpeed:Math.hypot(s[2]-p.wind,s[3]),density:f.rho,reynolds:f.reynolds,cd:f.cd,terminalSpeed:terminalVelocity(p,s[1]),hasTerminal:p.drag!=='vacuum'&&(p.drag!=='linear'||p.linear>0),...invariants()};}
  function geometry(){const f=air(p,s),vy=p.speed*Math.sin(p.angle*rad),ghostFlight=(vy+Math.sqrt(vy*vy+2*p.gravity*p.height))/p.gravity,gt=Math.min(t,ghostFlight);return {position:{x:s[0],y:s[1]},velocity:{x:s[2],y:s[3]},radius:p.diameter/2,ground:0,ghost:{x:p.speed*Math.cos(p.angle*rad)*gt,y:Math.max(0,p.height+vy*gt-.5*p.gravity*gt*gt),landed:t>=ghostFlight},forces:{gravity:{x:0,y:-p.mass*p.gravity},drag:{x:f.dragX,y:f.dragY},lift:{x:f.liftX,y:f.liftY}},wind:{x:p.wind,y:0},landed};}
  return {get t(){return t;},step,reset,sample,invariants,geometry};
}
export function flight(values={},maxTime=300){const instance=create(values);while(!instance.sample().landed&&instance.t<maxTime)instance.step(Math.min(.25,maxTime-instance.t));return instance.sample();}
export function rangeCurve(values={},angles=Array.from({length:18},(_,i)=>(i+1)*5)){return angles.map(angle=>{const s=flight({...values,angle});return {angle,range:s.range,flightTime:s.flightTime,landed:s.landed};});}
const base={...Object.fromEntries(params.map(p=>[p.key,p.value])),height:0,drag:'quadratic',atmosphere:'constant',wind:0,spin:0,cd:.47};
const preset=(id,label,values,note)=>({id,label,values:{...base,...values},note});
export const model={id:'projectile-air',title:'Projectile in air',params,presets:[
  preset('vacuum','Vacuum parabola',{drag:'vacuum',speed:40,angle:45},'Equal launch and landing height: maximum range at 45°.'),
  preset('baseball','Baseball',{mass:.145,diameter:.074,speed:40,angle:40},'Compare the drag trajectory with its vacuum ghost.'),
  preset('golf','Golf ball',{mass:.046,diameter:.043,cd:.25,speed:65,angle:25,spin:300},'Backspin adds lift; constant Cd is an illustrative dimpled-ball approximation.'),
  preset('shot','Shot put',{mass:7.26,diameter:.12,speed:14,angle:40,height:2},'Large mass makes air resistance a small correction.'),
  preset('pingpong','Ping-pong ball',{mass:.003,diameter:.04,speed:15,angle:40},'Low mass and large area cause rapid slowing.'),
  preset('cannonball','Cannonball',{mass:5,diameter:.1,speed:150,angle:40,atmosphere:'exponential'},'Density decreases as altitude increases.'),
  preset('linear','Linear drag',{drag:'linear',linear:.05,speed:25,angle:50},'Horizontal speed decays exponentially.'),
],observables:[['x','Horizontal position','x','m'],['y','Height','y','m'],['vx','Horizontal speed','v_x','m/s'],['vy','Vertical speed','v_y','m/s'],['speed','Speed','v','m/s'],['range','Range','R','m'],['apex','Apex','y_max','m'],['flightTime','Flight time','T','s'],['terminalSpeed','Local terminal speed','v_t','m/s'],['energy','Mechanical energy','E','J'],['dissipatedWork','Air heating','D','J'],['windWork','Wind work','W_w','J'],['impactLoss','Impact loss','Q_i','J']].map(([key,label,symbol,unit])=>({key,label,symbol,unit})),create};
