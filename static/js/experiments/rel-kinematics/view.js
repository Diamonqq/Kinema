import {eventFor,sumMomentum,invariantMass,comptonEnergy,H_C,masses,plotVariables} from './model.js';
import {texNum} from '../kit/format.js';
import {colors,fmt,panels,blockHeight,holdShell,fitScene,mapPanel,line,inside,axes,plot,clipPanel,clipLine,richText,richWidth} from '../minkowski/drawing.js';
const caches=new WeakMap();
export const closeups=[{id:'balance',label:'Zoom · momentum'},{id:'budget',label:'Zoom · energy'}];
export const graphs=[['flight','Free flight'],['ellipse','Momentum ellipse'],['energy-angle','Energy vs angle'],['threshold','Threshold'],['invariant','Invariant mass'],['compton','Compton shift'],['scatter','Scatter plot'],['histogram','Histogram']].map(([id,label])=>({id,label,kind:'custom',unit:({flight:'s, light-s',ellipse:'MeV/c','energy-angle':'\u00b0, MeV',threshold:'MeV',invariant:'MeV/c^2',compton:'\u00b0, MeV'})[id]||''}));
const symbol={energy:'E',momentum:'p',beta:'\u03b2',theta:'\u03b8',cosTheta:'cos \u03b8',pT:'p\u22a5',kinetic:'K',openingAngle:'\u0394\u03b8',invariantMass:'M',transferSquared:'q\u00b2',momentumTransfer:'|\u0394p|'};
function physicalLimits(variable){return ['theta','openingAngle'].includes(variable)?[0,180]:variable==='cosTheta'?[-1,1]:variable==='beta'?[0,1]:variable==='transferSquared'?null:[0,Infinity];}
function data(f){let d=caches.get(f.params);if(!d){const e=eventFor(f.params),sweep=Array.from({length:73},(_,i)=>eventFor({...f.params,angle:i*2.5}));
  const qs=[...e.initial,...e.final,...e.cmInitial,...e.cmFinal,...sweep.flatMap(a=>[...a.final,...a.cmFinal])];
  const frames=[{a:e.initial,b:e.final},{a:e.cmInitial,b:e.cmFinal}],boxes=frames.map(v=>{let x=0,y=0;const q=[{px:0,py:0},...v.a,...v.b,...v.b.map(a=>({px:x+=a.px,py:y+=a.py}))];return [Math.min(...q.map(a=>a.px)),Math.max(...q.map(a=>a.px)),Math.min(...q.map(a=>a.py)),Math.max(...q.map(a=>a.py))];}),span=Math.max(.01,...boxes.map(a=>Math.max(a[1]-a[0],a[3]-a[2])))/.7;
  const frameBounds=boxes.map(a=>{const x=(a[0]+a[1])/2,y=(a[2]+a[3])/2;return [x-span/2,x+span/2,y-span/2,y+span/2];});
  d={e,sweep,frameBounds,extent:Math.max(.01,...qs.map(a=>Math.hypot(a.px,a.py)))*1.22};caches.set(f.params,d);}return d;}
// Labels use typeset subscripts ("p_{1x}"); with a direction they sit just past the arrow tip.
function labelTip(s,p,text,x,y,color,segments=[],placements=null,dir=null){
  const w=richWidth(s,text,11),first=dir?[[dir[0]*7+(dir[0]>=0?4:-w-4),dir[1]*12]]:[];
  for(const [dx,dy] of [...first,...(placements||[[9,-12],[9,14],[-w-9,-12],[-w-9,14],[9,-28],[-w-9,28]])]){
    const a={x:Math.max(p.left+3,Math.min(p.left+p.width-w-3,x+dx)),y:Math.max(p.top+9,Math.min(p.top+p.height-9,y+dy))};
    const box={x:a.x-3,y:a.y-8,width:w+6,height:16};
    if(s.labels.some(b=>box.x<b.x+b.width&&box.x+box.width>b.x&&box.y<b.y+b.height&&box.y+box.height>b.y))continue;
    if(segments.some(v=>clipLine(...v,{left:box.x,top:box.y,width:box.width,height:box.height})))continue;
    richText(s,text,a.x,a.y,color,11,'left');return;
  }
}
const unit=v=>{const n=Math.hypot(v[2]-v[0],v[3]-v[1])||1;return [(v[2]-v[0])/n,(v[3]-v[1])/n];};
function momentum(s,f,p,key,headTail=false){
  if(s.w>=470&&!f.thumbnail){const size=Math.min(p.width,p.height);p={...p,height:size};}
  const d=data(f),e=f.geometry[key],star=key==='cm',extent=d.extent,zoom=headTail?.92:1;
  const bounds=s.w>=470&&!f.thumbnail?d.frameBounds[key==='lab'?0:1]:[-extent*zoom,extent*zoom,-extent*zoom,extent*zoom];
  const m=mapPanel(s,p,bounds,key),segments=[];
  axes(s,m,p,{title:key==='lab'?'Lab frame':'CM frame',x:'p_x \u00b7 MeV/c',y:'p_y',labels:!f.thumbnail});
  let x=0,y=0;
  const incoming=e.initial.filter(a=>Math.hypot(a.px,a.py)>1e-9).map(a=>({a,v:[m.x(0),m.y(0),m.x(a.px),m.y(a.py)]}));
  const outgoing=e.final.map((a,i)=>{const origin=headTail?[x,y]:[0,0];x=headTail?x+a.px:a.px;y=headTail?y+a.py:a.py;return {a,i,v:[m.x(origin[0]),m.y(origin[1]),m.x(x),m.y(y)]};});
  segments.push(...incoming.map(a=>a.v),...outgoing.map(a=>a.v));
  clipPanel(s,p,()=>{
    for(const {v} of incoming){s.ctx.setLineDash([6,4]);s.arrow(...v,'#a7b6cc',2);s.ctx.setLineDash([]);}
    for(const {a,i,v} of outgoing)if(Math.hypot(a.px,a.py)>1e-9)s.arrow(...v,colors[i%6],2.3);
    s.circle(m.x(0),m.y(0),2.7,'#e4edf9');
    if(headTail){const total=sumMomentum(e.final);line(s,m,p,[0,0],[total.px,total.py],'#eef4ff',1,[2,4]);}
  });
  if(!f.thumbnail){
    for(const {a,i,v} of outgoing)if(Math.hypot(a.px,a.py)>1e-9)labelTip(s,p,(star?'p*_':'p_')+(i+1),v[2],v[3],colors[i%6],segments,null,unit(v));
    if(s.w>=470&&(f.breakdown||headTail))for(const {v} of incoming)labelTip(s,p,'p in',v[2],v[3],'#a7b6cc',segments,null,unit(v));
  }
  if(f.breakdown&&!headTail&&e.final[0]){
    const a=e.final[0],color=colors[0],origin=[m.x(0),m.y(0)],tip=[m.x(a.px),m.y(a.py)],elbow=[tip[0],origin[1]];
    const overlap=(u,v)=>segments.some(b=>{
      const dx=v[0]-u[0],dy=v[1]-u[1],len=Math.hypot(dx,dy);if(len<1)return true;
      if(Math.abs((b[0]-u[0])*dy-(b[1]-u[1])*dx)/len>2||Math.abs((b[2]-u[0])*dy-(b[3]-u[1])*dx)/len>2)return false;
      const ts=[((b[0]-u[0])*dx+(b[1]-u[1])*dy)/len,((b[2]-u[0])*dx+(b[3]-u[1])*dy)/len];return Math.min(len,Math.max(...ts))-Math.max(0,Math.min(...ts))>3;
    });
    for(const [name,u,v,placements] of [[star?'p*_{1x}':'p_{1x}',origin,elbow,[[-12,16],[-12,-13]]],[star?'p*_{1y}':'p_{1y}',elbow,tip,[[10,0],[-36,0]]]]){
      const length=Math.hypot(v[0]-u[0],v[1]-u[1]);if(length<(s.w<470?42:28)||overlap(u,v))continue;
      clipPanel(s,p,()=>{s.ctx.setLineDash([2,4]);s.line(...u,...v,color+'90',1);s.ctx.setLineDash([]);});
      labelTip(s,p,name,(u[0]+v[0])/2,(u[1]+v[1])/2,color,segments,placements);
    }
    const angle=Math.atan2(a.py,a.px),radius=Math.min(23,Math.hypot(tip[0]-origin[0],tip[1]-origin[1])*.3);
    if(s.w>=470&&Math.abs(angle)>.4&&Math.abs(angle)<Math.PI-.3&&radius>8){clipPanel(s,p,()=>{s.ctx.strokeStyle=color;s.ctx.lineWidth=1;s.ctx.beginPath();s.ctx.arc(...origin,radius,0,-angle,angle>0);s.ctx.stroke();});labelTip(s,p,star?'\u03b8*_1':'\u03b8_1',origin[0]+(radius+22)*Math.cos(angle/2),origin[1]-(radius+22)*Math.sin(angle/2),color,segments);}
  }
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
  const y1=112,y2=196,bar=18;
  s.text('Center-of-momentum energy budget',s.w/2,63,'#c7d9ee',s.w<470?12:15);
  for(const [i,[label,value,color]] of [[0,['√s · available',e.W,colors[0]]],[1,['Σmc² · required',e.requiredMass,e.allowed?colors[2]:'#e4a9bd']]]){
    const y=i?y2:y1;s.text(label,left,y-24,color,12,'left');s.ctx.fillStyle=color+'a0';s.ctx.fillRect(left,y,width*value/max,bar);if(value===0)s.line(left,y-4,left,y+bar+4,color,2);
    s.text(fmt(value)+' MeV',left,y+bar+18,color,11,'left');
  }
  const Q=e.W-e.requiredMass;s.text('Q = '+(Q>=0?'+':'')+fmt(Q)+' MeV',s.w/2,y2+64,Q>=0?colors[2]:'#e4a9bd',14);
}
// Pane geometry shared by drawing and the zoom chips, which sit just under the (square) momentum panes.
function layoutFor(s,f){
  const opts={top:f.closeup?78:s.w>=470?34:44,bottom:s.w>=470?100:130,maxStacked:150,square:true,tail:64},ps=panels(s,{...opts,center:true});let bottom;
  if(s.w>=470){const size=Math.min(ps[0].width,ps[0].height);bottom=ps[0].top+size;}else bottom=ps[1].top+ps[1].height;
  return {ps,need:blockHeight(s,opts),cap:(22+ps[0].height+opts.tail)/.72,paneBottom:bottom,paneHeight:ps[0].height,chipTop:bottom+6};
}
// Component lines p_x = p cos θ and p_y = p sin θ with momentum, angle and result at 4 significant figures; recomputing the shown inputs agrees to rounding.
export function componentLines(v,star=''){
  const P=Math.hypot(v.px,v.py),A=Math.atan2(v.py,v.px)*180/Math.PI;
  const p=`(${texNum(P,4)}\\,\\mathrm{MeV}/c)`,a=texNum(A,4),unit='\\,\\mathrm{MeV}/c',sym=`p${star}_{1}`,ang=`\\theta${star}_{1}`;
  return [`p${star}_{1x}=${sym}\\cos${ang}`,`\\begin{aligned}p${star}_{1x}&=${p}\\cos(${a}^\\circ)\\\\&=${texNum(v.px,4)}${unit}\\end{aligned}`,`p${star}_{1y}=${sym}\\sin${ang}`,`\\begin{aligned}p${star}_{1y}&=${p}\\sin(${a}^\\circ)\\\\&=${texNum(v.py,4)}${unit}\\end{aligned}`];
}
export const view={closeups,graphs,paramVisible,
  mount(shell){holdShell(shell);shell.scene.style.minHeight='550px';shell.scene.style.flexBasis='550px';},
  graphDescriptors:p=>graphs.filter(g=>g.id==='compton'?p.reaction==='compton':g.id==='threshold'?!['pion-decay','decay','muon'].includes(p.reaction):true).map(g=>['scatter','histogram'].includes(g.id)?{...g,unit:p.distribution==='isotropic'?'isotropic toy sample':'allowed locus'}:g),
  key:f=>{
    const e=data(f).e,incoming=e.initial.some(a=>Math.hypot(a.px,a.py)>1e-9)||e.cmInitial.some(a=>Math.hypot(a.px,a.py)>1e-9);
    if(!e.allowed)return 'Dashed: incoming momenta \u00b7 below threshold';
    if(f.closeup==='budget')return 'Blue: available energy \u00b7 green: rest energy';
    if(e.final.length>1&&e.W-e.requiredMass<Math.max(1e-6,e.requiredMass*1e-4))return 'Products move together '+(e.W-e.requiredMass<1e-6?'at':'near')+' threshold'+(incoming?' \u00b7 dashed: incoming':'');
    const names=e.final.map((a,i)=>Math.hypot(a.px,a.py)>1e-9?['Blue p\u2081','warm p\u2082','green p\u2083'][i]:null).filter(Boolean);
    return (f.closeup==='balance'?'Head-to-tail sum \u00b7 ':'')+names.join(' \u00b7 ')+(incoming?' \u00b7 dashed: incoming':'');
  },
  closeupAnchors:(s,f)=>{const {ps,chipTop}=layoutFor(s,f),xs=s.w<470?[s.w*.26,s.w*.74]:ps.map(a=>a.left+a.width/2);return {balance:{x:xs[0],y:chipTop},budget:{x:xs[1],y:chipTop}};},
  draw(s,f){if(f.thumbnail||s.h<180){f={...f,thumbnail:true,breakdown:false};momentum(s,f,{left:28,top:28,width:s.w-48,height:s.h-58},'lab');return;}
    const compact=s.w<470,{ps,chipTop,need,cap,paneBottom,paneHeight}=layoutFor(s,f);fitScene(s,need,550,f.breakdown?cap:0);s.paneBottom=paneBottom;s.paneHeight=paneHeight;
    if(f.closeup==='budget')drawBudget(s,f);else for(const [i,k] of ['lab','cm'].entries())momentum(s,f,ps[i],k,f.closeup==='balance');
    const {e}=data(f),caption=f.closeup==='budget'?`√s = ${fmt(e.W)} MeV · final rest energy ${fmt(e.requiredMass)} MeV`:`√s = ${fmt(e.W)} MeV · reaction at t = 0`;
    if(f.closeup!=='budget'&&s.w>260&&s.h>200)s.text(compact?`√s = ${fmt(e.W)} MeV`:caption,s.w/2,chipTop+46,'#bccde3',compact?11:12);
    s.camera={bounds:[-data(f).extent,data(f).extent,-data(f).extent,data(f).extent],zoom:f.closeup};s.snap=false;
  },
  equations(f){const {e,a,b,mass}=budget(f),sum=(v,k)=>`\\begin{gathered}E_{${k}}=${fmt(v.E)}\\,\\mathrm{MeV}\\\\(p_x,p_y)_{${k}}=(${fmt(v.px)},${fmt(v.py)})\\,\\mathrm{MeV}/c\\end{gathered}`;
    const v=e[f.params.frame==='cm'?'cmFinal':'final'][0],star=f.params.frame==='cm'?'^{*}':'',components=v?componentLines(v,star):[];
    return ['\\sum P^\\mu_{in}=\\sum P^\\mu_{out}',sum(a,'in'),e.allowed?sum(b,'out'):'\\text{Outgoing state is forbidden}',
      ...components,
      'M^2=(\\sum E)^2-|\\sum\\mathbf p|^2',`M=${fmt(mass)}\\,\\mathrm{MeV}/c^2`,
      ...(['pion-decay','decay','muon'].includes(f.params.reaction)?[`Q=M-\\sum m_f=${fmt(e.W-e.requiredMass)}\\,\\mathrm{MeV}`]:['K_{th}=\\frac{(\\sum m_f)^2-(m_a+m_b)^2}{2m_b}',`K_{th}=${fmt(e.threshold)}\\,\\mathrm{MeV}`])];
  },
  closeupEquation(f){const {e,a,b}=budget(f);
    if(f.closeup==='balance')return ['\\sum\\mathbf p_{in}=\\sum\\mathbf p_{out}',`\\begin{gathered}p_{x,in}=${fmt(a.px)}\\,\\mathrm{MeV}/c\\\\p_{x,out}=${fmt(b.px)}\\,\\mathrm{MeV}/c\\end{gathered}`,`\\Delta E=${fmt(a.E-b.E)}\\,\\mathrm{MeV}`];
    return ['E\'=\\gamma_{CM}(E-\\beta_{CM}p_x)',`\\beta_{CM}=${fmt(e.betaCM)}`,
      'M=\\sqrt{E_{tot}^2-|\\mathbf p_{tot}|^2}',`M=${fmt(e.W)}\\,\\mathrm{MeV}/c^2`,
      ['pion-decay','decay','muon'].includes(f.params.reaction)?`Q=${fmt(e.W-e.requiredMass)}\\,\\mathrm{MeV}`:`K_{th}=${fmt(e.threshold)}\\,\\mathrm{MeV}`];
  },
  drawGraph(s,d,f){const {e,sweep}=data(f),final=e[f.params.frame==='cm'?'cmFinal':'final'],a=final[0],scatter=f.geometry.scatter;
    let points=[],marker=null,title=d.label,xLabel='',yLabel='',bars=false,bounds=null;
    if(d.id==='flight'){const ratio=a?.E?a.px/a.E:0;points=f.samples.map(p=>[p.t,p.t*ratio]);marker=[f.t,f.t*ratio];xLabel='coordinate time · s';yLabel='x_1 · light-s';}
    if(d.id==='ellipse'){const upper=sweep.map(v=>[v.final[0]?.px||0,v.final[0]?.py||0]);points=upper.concat([...upper].reverse().map(([x,y])=>[x,-y]));marker=e.final[0]?[e.final[0].px,e.final[0].py]:null;const st=f.params.frame==='cm'?'*':'';xLabel=`p${st}_{1x} · MeV/c`;yLabel=`p${st}_{1y} · MeV/c`;}
    if(d.id==='energy-angle'){points=sweep.map((v,i)=>[i*2.5,v.final[0]?.E||0]);marker=[f.params.angle,e.final[0]?.E||0];xLabel=f.params.reaction==='compton'?'Lab photon angle · °':'CM polar angle · °';yLabel='E_1 · MeV';}
    if(d.id==='invariant'){points=f.samples.map(v=>[v.t,v.invariantMass]);marker=[f.t,e.W];xLabel='coordinate time · s';yLabel='M · MeV/c²';}
    if(d.id==='threshold'){const beam=e.initial[0],target=e.initial[1],ma=invariantMass(beam),mb=target?invariantMass(target):1,K=beam.E-ma,upper=Math.max(1,e.threshold*1.5,K*1.2);points=Array.from({length:81},(_,i)=>{const k=upper*i/80;return [k,Math.sqrt(ma*ma+mb*mb+2*mb*(ma+k))-e.requiredMass];});marker=[K,e.W-e.requiredMass];xLabel='beam kinetic energy · MeV';yLabel='Q · MeV';}
    if(d.id==='compton'){const E=e.initial[0].E;points=Array.from({length:73},(_,i)=>[i*2.5,comptonEnergy(E,i*Math.PI/72)]);marker=[f.params.angle,e.photonEnergy];xLabel='Lab photon angle · °';yLabel='photon energy · MeV';}
    if(d.id==='scatter'){points=scatter.points.map(v=>[v.x,v.y]);const xv=plotVariables.find(v=>v.value===scatter.x.variable),yv=plotVariables.find(v=>v.value===scatter.y.variable);xLabel=`${symbol[scatter.x.variable]||''}${xv?.unit?' / '+xv.unit:''} · ${scatter.x.frame}`;yLabel=[symbol[scatter.y.variable],yv?.unit].filter(Boolean).join(' \u00b7 ');title='Allowed kinematics · '+(scatter.distribution==='isotropic'?'isotropic toy sample':'locus');bounds=[scatter.x.min,scatter.x.max,scatter.y.min,scatter.y.max];}
    if(d.id==='histogram'){const h=scatter.histogram;points=h.counts.map((v,i)=>[(h.edges[i]+h.edges[i+1])/2,v]);xLabel=[symbol[scatter.x.variable],plotVariables.find(v=>v.value===scatter.x.variable)?.unit].filter(Boolean).join(' / ');yLabel='sample count';title=scatter.distribution==='isotropic'?'Isotropic toy sample · no cross section':'Locus sample counts · not event rates';bars=true;bounds=[h.min,h.max,0,Math.max(1,...h.counts)*1.2];}
    // Symbols identify axes; units already supplied by this card's header stay there.
    if(d.unit&& !['scatter','histogram','flight'].includes(d.id)){
      yLabel=yLabel.split(' \u00b7 ')[0];
      if(d.id!=='invariant')xLabel=xLabel.split(' \u00b7 ')[0];
    }
    plot(s,{title,xLabel,yLabel,points,marker,bounds,bars,dots:d.id==='scatter',equalScale:d.id==='ellipse',xLimits:['compton','energy-angle'].includes(d.id)?[0,180]:d.id==='threshold'?[0,Infinity]:['scatter','histogram'].includes(d.id)?physicalLimits(scatter.x.variable):null,yLimits:d.id==='scatter'?physicalLimits(scatter.y.variable):null});
  },
};
