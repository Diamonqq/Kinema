import {eventFor,sumMomentum,invariantMass,comptonEnergy,H_C,masses,plotVariables} from './model.js';
import {colors,fmt,panels,mapPanel,line,inside,axes,plot} from '../minkowski/drawing.js';
const caches=new WeakMap();
export const closeups=[{id:'balance',label:'Zoom · momentum'},{id:'budget',label:'Zoom · energy'}];
export const graphs=[['flight','Free flight'],['ellipse','Momentum ellipse'],['energy-angle','Energy vs angle'],['threshold','Threshold'],['invariant','Invariant mass'],['compton','Compton shift'],['scatter','Scatter plot'],['histogram','Histogram']].map(([id,label])=>({id,label,kind:'custom'}));
function data(f){let d=caches.get(f.params);if(!d){const e=eventFor(f.params),sweep=Array.from({length:73},(_,i)=>eventFor({...f.params,angle:i*2.5}));
  const qs=[...e.initial,...e.final,...e.cmInitial,...e.cmFinal,...sweep.flatMap(a=>[...a.final,...a.cmFinal])];
  d={e,sweep,extent:Math.max(.01,...qs.map(a=>Math.hypot(a.px,a.py)))*1.22};caches.set(f.params,d);}return d;}
function labelTip(s,p,text,x,y,color){
  const c=s.ctx;c.font='11px system-ui';const w=c.measureText(text).width;
  for(const [dx,dy] of [[8,-10],[8,12],[-w-8,-10],[-w-8,12],[8,-24],[-w-8,26]]){
    const a={x:Math.max(p.left+2,Math.min(p.left+p.width-w-2,x+dx)),y:Math.max(p.top+8,Math.min(p.top+p.height-8,y+dy))};
    const box={x:a.x-2,y:a.y-7,width:w+4,height:14};
    if(s.labels.some(b=>box.x<b.x+b.width&&box.x+box.width>b.x&&box.y<b.y+b.height&&box.y+box.height>b.y))continue;
    s.text(text,a.x,a.y,color,11,'left');return;
  }
}
function momentum(s,f,p,key,headTail=false){
  const d=data(f),e=f.geometry[key],extent=d.extent,zoom=headTail?.92:1;
  const m=mapPanel(s,p,[-extent*zoom,extent*zoom,-extent*zoom,extent*zoom],key);
  axes(s,m,p,{title:key==='lab'?'Lab frame':'CM frame',x:'pₓ · MeV/c',y:'pᵧ'});
  // Incoming arrows are subdued; no false minimum length for massive targets at rest.
  e.initial.forEach((a,i)=>{
    line(s,m,p,[0,0],[a.px,a.py],'#91a0b275',1.2,[3,4]);
    if(f.breakdown&&Math.hypot(a.px,a.py)>1e-8)labelTip(s,p,i?'p target':'p in',m.x(a.px),m.y(a.py),'#8e9cb0');
  });
  let x=0,y=0;
  e.final.forEach((a,i)=>{
    const origin=headTail?[x,y]:[0,0];x=headTail?x+a.px:a.px;y=headTail?y+a.py:a.py;
    const v=[m.x(x),m.y(y)];
    if(inside(m,p,x,y,10)&&Math.hypot(a.px,a.py)>1e-9)s.arrow(m.x(origin[0]),m.y(origin[1]),...v,colors[i%6],2.3);
    else line(s,m,p,origin,[x,y],colors[i%6],2.3);
    if(f.breakdown||headTail)labelTip(s,p,'p'+(i+1),...v,colors[i%6]);
  });
  if(f.breakdown&&e.final[0]){
    const a=e.final[0],color=colors[0],origin=[m.x(0),m.y(0)],tip=[m.x(a.px),m.y(a.py)];
    line(s,m,p,[0,0],[a.px,0],color+'75',1,[2,3]);line(s,m,p,[a.px,0],[a.px,a.py],color+'75',1,[2,3]);
    if(Math.abs(a.px)>1e-8)labelTip(s,p,'p1x',m.x(a.px),m.y(0),color);
    if(Math.abs(a.py)>1e-8)labelTip(s,p,'p1y',m.x(a.px),m.y(a.py*.5),color);
    const angle=Math.atan2(a.py,a.px),radius=Math.min(18,Math.hypot(tip[0]-origin[0],tip[1]-origin[1])*.3);
    if(Math.abs(angle)>.05&&radius>4){s.ctx.strokeStyle=color;s.ctx.lineWidth=1;s.ctx.beginPath();s.ctx.arc(...origin,radius,0,-angle,angle>0);s.ctx.stroke();labelTip(s,p,'θ1',origin[0]+(radius+7)*Math.cos(angle/2),origin[1]-(radius+7)*Math.sin(angle/2),color);}
  }
  s.circle(m.x(0),m.y(0),2.7,'#e4edf9');
  if(headTail){const total=sumMomentum(e.final);line(s,m,p,[0,0],[total.px,total.py],'#eef4ff',1,[2,4]);}
}
export function paramVisible(spec,p){const k=spec.key,r=p.reaction,decay=['pion-decay','decay','muon'].includes(r);
  if(['reaction','frame','angle','inputMode'].includes(k))return true;
  if(k==='beta')return decay&&p.inputMode!=='momentum';
  if(k==='beamMomentum')return p.inputMode==='momentum';
  if(k==='kinetic')return !decay&&p.inputMode==='kinetic';
  if(k==='parentMass')return r==='decay';
  if(['mass1','mass2'].includes(k))return ['decay','elastic','collision'].includes(r);
  if(['mass3','mass4'].includes(k))return r==='collision';
  if(['pairFraction','secondaryAngle'].includes(k))return ['muon','pp-pion'].includes(r);
  // Advanced plot selections remain available to the tutor without crowding entry.
  return ['xVariable','yVariable','distribution'].includes(k);
}
function budget(f){const e=data(f).e,cm=f.params.frame==='cm',a=sumMomentum(cm?e.cmInitial:e.initial),b=sumMomentum(cm?e.cmFinal:e.final);
  return {e,a,b,mass:invariantMass(a),finalMass:e.requiredMass};}
function drawBudget(s,f){
  const {e}=data(f),max=Math.max(.001,e.W,e.requiredMass)*1.18,left=32,right=s.w-32,width=right-left;
  const y1=120,y2=Math.min(s.h-180,230),bar=18;
  s.text('Center-of-momentum energy budget',s.w/2,63,'#c7d9ee',s.w<470?12:15);
  for(const [i,[label,value,color]] of [[0,['√s · available',e.W,colors[0]]],[1,['Σmc² · required',e.requiredMass,e.allowed?colors[2]:'#e4a9bd']]]){
    const y=i?y2:y1;s.text(label,left,y-24,color,12,'left');s.ctx.fillStyle=color+'a0';s.ctx.fillRect(left,y,width*value/max,bar);
    s.text(fmt(value)+' MeV',left,y+bar+18,color,11,'left');
  }
  const Q=e.W-e.requiredMass;s.text('Q = '+(Q>=0?'+':'')+fmt(Q)+' MeV',s.w/2,Math.min(s.h-115,y2+80),Q>=0?colors[2]:'#e4a9bd',14);
}
export const view={closeups,graphs,paramVisible,
  mount(shell){shell.scene.style.minHeight='440px';shell.scene.style.flexBasis='440px';},
  graphDescriptors:p=>graphs.filter(g=>g.id==='compton'?p.reaction==='compton':g.id==='threshold'?!['pion-decay','decay','muon'].includes(p.reaction):true),
  key:f=>!f.geometry.allowed?'Below threshold · no outgoing event':f.closeup==='balance'?'Head-to-tail sum · blue p1 · warm p2 · green p3':'Blue p1 · warm p2 · green p3 · dashed incoming',
  closeupAnchors:s=>({balance:{x:s.w*.26,y:s.h-69},budget:{x:s.w*.74,y:s.h-69}}),
  draw(s,f){if(s.h<180){momentum(s,f,{left:28,top:28,width:s.w-48,height:s.h-58},'lab');return;}
    const compact=s.w<470,ps=panels(s,{top:f.closeup?78:44,bottom:130});
    if(f.closeup==='budget')drawBudget(s,f);else for(const [i,k] of ['lab','cm'].entries())momentum(s,f,ps[i],k,f.closeup==='balance');
    const {e}=data(f),caption=f.closeup==='budget'?`√s = ${fmt(e.W)} MeV · final rest energy ${fmt(e.requiredMass)} MeV`:`√s = ${fmt(e.W)} MeV · reaction at t = 0`;
    if(s.w>260&&s.h>200)s.text(compact?`√s = ${fmt(e.W)} MeV`:caption,s.w/2,s.h-100,'#bccde3',compact?11:12);
    s.camera={bounds:[-data(f).extent,data(f).extent,-data(f).extent,data(f).extent],zoom:f.closeup};s.snap=false;
  },
  equations(f){const {e,a,b,mass}=budget(f),sum=v=>`(${fmt(v.E)},${fmt(v.px)},${fmt(v.py)})`;
    const v=e[f.params.frame==='cm'?'cmFinal':'final'][0],momentum=v?Math.hypot(v.px,v.py,v.pz):0,angle=v?Math.atan2(Math.hypot(v.py,v.pz),v.px)*180/Math.PI:0;
    return ['\\sum P^\\mu_{in}=\\sum P^\\mu_{out}',`\\begin{gathered}(E,p_x,p_y)_{in}=${sum(a)}\\\\(E,p_x,p_y)_{out}=${e.allowed?sum(b):'\\text{forbidden}'}\\end{gathered}`,
      '\\text{Particle units: MeV, MeV}/c',
      ...(v?['p_{1x}=p_1\\cos\\theta_1',`p_{1x}=${fmt(momentum)}\\cos(${fmt(angle,1)}^\\circ)=${fmt(v.px)}`,'p_{1\\perp}=p_1\\sin\\theta_1',`p_{1\\perp}=${fmt(Math.hypot(v.py,v.pz))}\\,\\mathrm{MeV}/c`]:[]),
      'M^2=(\\sum E)^2-|\\sum\\mathbf p|^2',`M=${fmt(mass)}\\,\\mathrm{MeV}/c^2`,
      ...(['pion-decay','decay','muon'].includes(f.params.reaction)?[`Q=M-\\sum m_f=${fmt(e.W-e.requiredMass)}\\,\\mathrm{MeV}`]:['K_{th}=\\frac{(\\sum m_f)^2-(m_a+m_b)^2}{2m_b}',`K_{th}=${fmt(e.threshold)}\\,\\mathrm{MeV}`])];
  },
  closeupEquation(f){const {e,a,b}=budget(f);
    if(f.closeup==='balance')return ['\\sum\\mathbf p_{in}=\\sum\\mathbf p_{out}',`\\begin{gathered}p_{x,in}=${fmt(a.px)}\\\\p_{x,out}=${fmt(b.px)}\\end{gathered}`,`\\Delta E=${fmt(a.E-b.E)}\\,\\mathrm{MeV}`];
    return ['E\'=\\gamma_{CM}(E-\\beta_{CM}p_x)',`\\beta_{CM}=${fmt(e.betaCM)}`,
      'M=\\sqrt{E_{tot}^2-|\\mathbf p_{tot}|^2}',`M=${fmt(e.W)}\\,\\mathrm{MeV}/c^2`,
      ['pion-decay','decay','muon'].includes(f.params.reaction)?`Q=${fmt(e.W-e.requiredMass)}\\,\\mathrm{MeV}`:`K_{th}=${fmt(e.threshold)}\\,\\mathrm{MeV}`];
  },
  drawGraph(s,d,f){const {e,sweep}=data(f),final=e[f.params.frame==='cm'?'cmFinal':'final'],a=final[0],scatter=f.geometry.scatter;
    let points=[],marker=null,title=d.label,xLabel='',yLabel='',bars=false,bounds=null;
    if(d.id==='flight'){const ratio=a?.E?a.px/a.E:0;points=f.samples.map(p=>[p.t,p.t*ratio]);marker=[f.t,f.t*ratio];xLabel='coordinate time · s';yLabel='x₁ · light-seconds';}
    if(d.id==='ellipse'){const upper=sweep.map(v=>[v.final[0]?.px||0,v.final[0]?.py||0]);points=upper.concat([...upper].reverse().map(([x,y])=>[x,-y]));marker=e.final[0]?[e.final[0].px,e.final[0].py]:null;xLabel='p₁ₓ · MeV/c';yLabel='p₁ᵧ · MeV/c';}
    if(d.id==='energy-angle'){points=sweep.map((v,i)=>[i*2.5,v.final[0]?.E||0]);marker=[f.params.angle,e.final[0]?.E||0];xLabel=f.params.reaction==='compton'?'Lab photon angle · °':'CM polar angle · °';yLabel='E₁ · MeV';}
    if(d.id==='invariant'){points=f.samples.map(v=>[v.t,v.invariantMass]);marker=[f.t,e.W];xLabel='coordinate time · s';yLabel='M · MeV/c²';}
    if(d.id==='threshold'){const beam=e.initial[0],target=e.initial[1],ma=invariantMass(beam),mb=target?invariantMass(target):1,K=beam.E-ma,upper=Math.max(1,e.threshold*1.5,K*1.2);points=Array.from({length:81},(_,i)=>{const k=upper*i/80;return [k,Math.sqrt(ma*ma+mb*mb+2*mb*(ma+k))-e.requiredMass];});marker=[K,e.W-e.requiredMass];xLabel='beam kinetic energy · MeV';yLabel='Q · MeV';}
    if(d.id==='compton'){const E=e.initial[0].E;points=Array.from({length:73},(_,i)=>[i*2.5,comptonEnergy(E,i*Math.PI/72)]);marker=[f.params.angle,e.photonEnergy];xLabel='Lab photon angle · °';yLabel='photon energy · MeV';}
    if(d.id==='scatter'){points=scatter.points.map(v=>[v.x,v.y]);const xv=plotVariables.find(v=>v.value===scatter.x.variable),yv=plotVariables.find(v=>v.value===scatter.y.variable);xLabel=`${xv?.label||''} · ${scatter.x.frame}`;yLabel=yv?.unit||yv?.label||'';title='Allowed kinematics · '+(scatter.distribution==='isotropic'?'isotropic toy sample':'locus');bounds=[scatter.x.min,scatter.x.max,scatter.y.min,scatter.y.max];}
    if(d.id==='histogram'){const h=scatter.histogram;points=h.counts.map((v,i)=>[(h.edges[i]+h.edges[i+1])/2,v]);xLabel=plotVariables.find(v=>v.value===scatter.x.variable)?.label||'';yLabel='sample count';title=scatter.distribution==='isotropic'?'Isotropic toy sample · no cross section':'Locus sample counts · not event rates';bars=true;bounds=[h.min,h.max,0,Math.max(1,...h.counts)*1.2];}
    plot(s,{title,xLabel,yLabel,points,marker,bounds,bars,dots:d.id==='scatter',equalScale:d.id==='ellipse'});
  },
};
