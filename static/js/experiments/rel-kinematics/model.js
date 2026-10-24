// Four-momenta use conventional particle units: E in MeV, p in MeV/c,
// masses in MeV/c^2. Coordinate geometry and playback remain SI.
export const C=299792458;
export const H_C=1.2398419843320026e-12; // h*c, MeV m (not hbar*c)
export const masses=Object.freeze({electron:.51099895,muon:105.6583755,proton:938.27208816,pion0:134.9768,pion:139.57039});
const gamma=b=>{if(!Number.isFinite(b)||Math.abs(b)>=1)throw new RangeError('|beta| must be < 1');return 1/Math.sqrt((1-b)*(1+b));};
export function boostMomentum(q,beta) {
  const g=gamma(beta);
  return {...q,E:g*(q.E-beta*q.px),px:g*(q.px-beta*q.E),py:q.py??0,pz:q.pz??0};
}
export const sumMomentum=qs=>qs.reduce((s,q)=>({E:s.E+q.E,px:s.px+q.px,py:s.py+(q.py??0),pz:s.pz+(q.pz??0)}),{E:0,px:0,py:0,pz:0});
export const massSquared=q=>q.E*q.E-q.px*q.px-(q.py??0)**2-(q.pz??0)**2;
export const invariantMass=q=>Math.sqrt(Math.max(0,massSquared(q)));
export function twoBodyMomentum(M,m1,m2) {
  if(![M,m1,m2].every(Number.isFinite)||M<=0||m1<0||m2<0||M<m1+m2-1e-12*Math.max(M,m1+m2))throw new RangeError('Forbidden two-body decay');
  return Math.sqrt(Math.max(0,(M-m1-m2)*(M+m1+m2)*(M-m1+m2)*(M+m1-m2)))/(2*M);
}
export function thresholdKinetic(mBeam,mTarget,finalMasses) {
  if(mBeam<0||mTarget<=0||!Number.isFinite(mBeam+mTarget)||!finalMasses.length||!finalMasses.every(m=>Number.isFinite(m)&&m>=0))throw new RangeError('Invalid masses');
  const M=finalMasses.reduce((a,b)=>a+b,0);
  return Math.max(0,(M*M-(mBeam+mTarget)**2)/(2*mTarget));
}
export function comptonEnergy(E,theta,m=masses.electron) {
  if(!Number.isFinite(E)||E<=0||!Number.isFinite(theta)||theta<0||theta>Math.PI||m<=0)throw new RangeError('Invalid Compton input');
  return E/(1+E/m*(1-Math.cos(theta)));
}
const q=(E,px,py=0,pz=0,id='')=>({E,px,py,pz,id});
function decay(M,m1,m2,angle) {
  const p=twoBodyMomentum(M,m1,m2),x=p*Math.cos(angle),y=p*Math.sin(angle);
  return [{...q(Math.hypot(m1,p),x,y,0,'daughter-1'),mass:m1},{...q(Math.hypot(m2,p),-x,-y,0,'daughter-2'),mass:m2}];
}
// Boost from an arbitrary rest frame into its parent four-momentum.
function fromRest(a,parent) {
  const M=invariantMass(parent), E=parent.E, p2=parent.px**2+parent.py**2+parent.pz**2;
  if(p2===0)return {...a};
  const dot=a.px*parent.px+a.py*parent.py+a.pz*parent.pz;
  const f=dot/(M*(E+M))+a.E/M;
  return {...a,E:(E*a.E+dot)/M,px:a.px+f*parent.px,py:a.py+f*parent.py,pz:a.pz+f*parent.pz};
}
function threeBody(M,m1,m2,m3,fraction,angle,secondaryAngle) {
  const pairMass=m2+m3+fraction*(M-m1-m2-m3);
  const [first,pair]=decay(M,m1,pairMass,angle);
  const rest=decay(pairMass,m2,m3,secondaryAngle);
  return [{...first,id:'daughter-1'},...rest.map((a,i)=>({...fromRest(a,pair),id:`daughter-${i+2}`}))];
}
const reactions=[['pion-decay','Neutral pion → two photons'],['decay','Two-body decay'],['elastic','Elastic collision'],
  ['collision','Two-body reaction'],['pp-pion','Proton + proton → proton + proton + pion'],
  ['compton','Compton scattering'],['muon','Muon → electron + two neutrinos'],['pion-proton','Pion + proton elastic scattering']];
export const plotVariables=[
  {value:'energy',label:'Energy',unit:'MeV'},{value:'momentum',label:'Momentum',unit:'MeV/c'},
  {value:'beta',label:'Speed / c',unit:''},{value:'theta',label:'Polar angle',unit:'°'},
  {value:'cosTheta',label:'Cosine of polar angle',unit:''},{value:'pT',label:'Transverse momentum',unit:'MeV/c'},
  {value:'kinetic',label:'Kinetic energy',unit:'MeV'},{value:'openingAngle',label:'Daughter opening angle',unit:'°'},
  {value:'invariantMass',label:'Final invariant mass',unit:'MeV/c²'},
  {value:'transferSquared',label:'Four-momentum transfer squared',unit:'MeV²/c²'},
  {value:'momentumTransfer',label:'Three-momentum transfer',unit:'MeV/c'},
];
const params=[
  {key:'reaction',label:'Reaction',unit:'',value:'pion-decay',options:reactions.map(([value,label])=>({value,label}))},
  {key:'frame',label:'Frame',unit:'',value:'lab',options:[{value:'lab',label:'Lab'},{value:'cm',label:'Center of momentum'}]},
  {key:'beta',label:'Parent speed',symbol:'v/c',unit:'',min:-.95,max:.95,step:.01,value:.6,group:'Decay'},
  {key:'parentMass',label:'Parent mass',symbol:'M',unit:'MeV/c²',min:.01,max:10000,step:.01,value:10,group:'Custom decay'},
  {key:'mass1',label:'Beam / daughter 1 mass',symbol:'m_1',unit:'MeV/c²',min:0,max:5000,step:.01,value:1,group:'Custom reaction'},
  {key:'mass2',label:'Target / daughter 2 mass',symbol:'m_2',unit:'MeV/c²',min:0,max:5000,step:.01,value:1,group:'Custom reaction'},
  {key:'mass3',label:'Final particle 1 mass',symbol:'m_3',unit:'MeV/c²',min:0,max:5000,step:.01,value:1,group:'Custom collision'},
  {key:'mass4',label:'Final particle 2 mass',symbol:'m_4',unit:'MeV/c²',min:0,max:5000,step:.01,value:1,group:'Custom collision'},
  {key:'kinetic',label:'Beam kinetic energy / incident photon energy',symbol:'K',unit:'MeV',min:0,max:10000,step:.01,value:400,group:'Beam'},
  {key:'inputMode',label:'Beam input',unit:'',value:'kinetic',options:[{value:'kinetic',label:'Kinetic energy'},{value:'momentum',label:'Momentum'}],group:'Beam'},
  {key:'beamMomentum',label:'Incoming / parent momentum',symbol:'p',unit:'MeV/c',min:0,max:100000,step:.01,value:100,group:'Beam'},
  {key:'angle',label:'CM polar angle (Compton: lab photon angle)',symbol:'\\theta',unit:'°',min:0,max:180,step:1,value:60,group:'Angles'},
  {key:'pairFraction',label:'Three-body pair mass fraction',symbol:'f',unit:'',min:.01,max:.99,step:.01,value:.5,group:'Three-body kinematics'},
  {key:'secondaryAngle',label:'Pair rest-frame daughter angle',symbol:'\\phi',unit:'°',min:0,max:180,step:1,value:90,group:'Three-body kinematics'},
  {key:'distribution',label:'Angular sample',unit:'',value:'locus',options:[{value:'locus',label:'Allowed locus'},{value:'isotropic',label:'Isotropic CM toy sample'}],group:'Plots'},
  {key:'eventCount',label:'Sample size',unit:'events',min:4,max:2048,step:1,value:100,group:'Plots'},
  {key:'seed',label:'Sample seed',unit:'',min:1,max:4294967295,step:1,value:1,group:'Plots'},
  ...['x','y'].flatMap(axis=>[
    {key:`${axis}Variable`,label:`${axis} variable`,unit:'',value:'theta',options:plotVariables,group:'Plots'},
    {key:`${axis}Frame`,label:`${axis} frame`,unit:'',value:axis==='x'?'cm':'lab',options:[{value:'cm',label:'CM'},{value:'lab',label:'Lab'}],group:'Plots'},
    {key:`${axis}Particle`,label:`${axis} daughter`,unit:'',min:1,max:3,step:1,value:axis==='x'?1:2,group:'Plots'},
    {key:`${axis}Min`,label:`${axis} lower limit`,unit:'selected variable',min:-10000000000,max:10000000000,step:.01,value:0,group:'Plots'},
    {key:`${axis}Max`,label:`${axis} upper limit`,unit:'selected variable',min:-10000000000,max:10000000000,step:.01,value:180,group:'Plots'},
  ]),
  {key:'plotRange',label:'Plot range',unit:'',value:'auto',options:[{value:'auto',label:'Automatic'},{value:'manual',label:'Manual'}],group:'Plots'},
  {key:'bins',label:'Histogram bins',unit:'bins',min:2,max:100,step:1,value:20,group:'Plots'},
];
// Physical/plot dependencies, independently of the compact Setup presentation.
const appliesWhen={
  beta:{reaction:['pion-decay','decay','muon'],inputMode:['kinetic']},
  parentMass:{reaction:['decay']},
  mass1:{reaction:['decay','elastic','collision']},
  mass2:{reaction:['decay','elastic','collision']},
  mass3:{reaction:['collision']},mass4:{reaction:['collision']},
  kinetic:{reaction:['elastic','collision','pp-pion','compton','pion-proton'],inputMode:['kinetic']},
  beamMomentum:{inputMode:['momentum']},
  pairFraction:{reaction:['muon','pp-pion']},secondaryAngle:{reaction:['muon','pp-pion']},
  seed:{distribution:['isotropic']},
  xMin:{plotRange:['manual']},xMax:{plotRange:['manual']},
  yMin:{plotRange:['manual']},yMax:{plotRange:['manual']},
};
for(const spec of params)if(appliesWhen[spec.key])spec.appliesWhen=appliesWhen[spec.key];
const presets=[
  {id:'pion-rest',label:'Pion at rest',values:{reaction:'pion-decay',beta:0,angle:60},note:'Each photon carries half the pion rest energy.'},
  {id:'pion-flight',label:'Pion in flight',values:{reaction:'pion-decay',beta:.8,angle:60},note:'Boosting changes photon energies, not the pair invariant mass.'},
  {id:'equal-masses',label:'Equal masses',values:{reaction:'elastic',mass1:1,mass2:1,kinetic:4,angle:60},note:'The center of momentum is moving in the lab.'},
  {id:'threshold',label:'Make a pion',values:{reaction:'pp-pion',kinetic:280,angle:60,pairFraction:.5},note:'Some beam energy must remain as center-of-momentum motion.'},
  {id:'compton',label:'Photon recoil',values:{reaction:'compton',kinetic:.51,angle:90},note:'Photon energy decreases as the electron recoils.'},
  {id:'muon-rest',label:'Muon at rest',values:{reaction:'muon',beta:0,pairFraction:.5,angle:60,secondaryAngle:90},note:'Three daughters share energy; this is a selected kinematic event, not a decay-rate prediction.'},
  {id:'muon-flight',label:'Muon in flight',values:{reaction:'muon',beta:.8,pairFraction:.5,angle:60,secondaryAngle:90},note:'One Lorentz boost carries all three daughter four-momenta to the lab.'},
  {id:'pion-target',label:'Pion meets proton',values:{reaction:'pion-proton',inputMode:'momentum',beamMomentum:100,angle:30},note:'A light beam particle hits a heavy target: compare the two outgoing lab angles.'},
];
// Presets must not inherit the previous experiment's unrelated advanced settings.
for(const preset of presets)preset.values={...Object.fromEntries(params.map(s=>[s.key,s.value])),...preset.values};
function read(values) {
  const p={};for(const s of params){const v=values[s.key]??s.value;
    if(s.options?!s.options.some(o=>o.value===v):!Number.isFinite(v)||v<s.min||v>s.max)throw new RangeError(`Invalid ${s.key}`);
    p[s.key]=v;
  }
  for(const k of ['eventCount','seed','bins','xParticle','yParticle'])if(!Number.isInteger(p[k]))throw new RangeError(`Invalid integer ${k}`);
  if(p.plotRange==='manual'&&(p.xMin>=p.xMax||p.yMin>=p.yMax))throw new RangeError('Plot lower limit must be below upper limit');
  if(['elastic','collision'].includes(p.reaction)&&p.mass2===0)throw new RangeError('A resting target must have positive mass');
  return p;
}
function event(p,angle=p.angle*Math.PI/180) {
  let initial=[],final=[],cmFinal=[],cmInitial=[],b=0,W=0,threshold=0,allowed=true,photonEnergy=0,requiredMass=0;
  const r=p.reaction;
  if(['pion-decay','decay','muon'].includes(r)) {
    const M=r==='pion-decay'?masses.pion0:r==='muon'?masses.muon:p.parentMass;
    const a=r==='pion-decay'?0:r==='muon'?masses.electron:p.mass1;
    const d=r==='decay'?p.mass2:0;
    b=p.inputMode==='momentum'?p.beamMomentum/Math.hypot(M,p.beamMomentum):p.beta;W=M;requiredMass=a+d;allowed=M>=requiredMass;
    cmInitial=[q(M,0,0,0,'parent')];
    cmFinal=allowed?(r==='muon'?threeBody(M,a,0,0,p.pairFraction,angle,p.secondaryAngle*Math.PI/180):decay(M,a,d,angle)):[];
    initial=cmInitial.map(a=>boostMomentum(a,-b));final=cmFinal.map(a=>boostMomentum(a,-b));
  } else {
    const a=r==='compton'?0:r==='pp-pion'?masses.proton:r==='pion-proton'?masses.pion:p.mass1;
    const d=r==='compton'?masses.electron:['pp-pion','pion-proton'].includes(r)?masses.proton:p.mass2;
    const E=p.inputMode==='momentum'?Math.hypot(a,p.beamMomentum):a+p.kinetic;
    const px=p.inputMode==='momentum'?p.beamMomentum:Math.sqrt(p.kinetic*(p.kinetic+2*a));
    initial=[q(E,px,0,0,'beam'),q(d,0,0,0,'target')];
    b=px/(E+d);W=Math.sqrt(a*a+d*d+2*d*E);
    cmInitial=initial.map(a=>boostMomentum(a,b));
    const finals=r==='pp-pion'?[masses.pion0,masses.proton,masses.proton]:
      r==='compton'?[0,d]:['elastic','pion-proton'].includes(r)?[a,d]:[p.mass3,p.mass4];
    requiredMass=finals.reduce((a,b)=>a+b,0);
    threshold=thresholdKinetic(a,d,finals);
    // Equivalent closed forms differ by a few ulps right at threshold.
    allowed=E-a>=threshold-32*Number.EPSILON*Math.max(1,threshold)&&!(a===0&&E===0);
    if(allowed&&W<requiredMass)W=requiredMass;
    if(allowed) {
      if(r==='compton') {
        photonEnergy=comptonEnergy(E,angle,d);
        const photon={...q(photonEnergy,photonEnergy*Math.cos(angle),photonEnergy*Math.sin(angle),0,'photon'),mass:0};
        final=[photon,{...q(E+d-photon.E,px-photon.px,-photon.py,0,'electron'),mass:d}];
        cmFinal=final.map(a=>boostMomentum(a,b));
      }else{
        cmFinal=r==='pp-pion'?threeBody(W,...finals,p.pairFraction,angle,p.secondaryAngle*Math.PI/180):decay(W,...finals,angle);
        final=cmFinal.map(a=>boostMomentum(a,-b));
      }
    }
  }
  return {initial,final,cmInitial,cmFinal,betaCM:b,W,threshold,allowed,photonEnergy,requiredMass};
}
const residual=(a,b)=>({energy:a.E-b.E,px:a.px-b.px,py:a.py-b.py,pz:a.pz-b.pz});
// Bounded single-event evaluation for independently labeled graph axes.
export const eventFor=values=>event(read(values));
const clamp=v=>Math.max(-1,Math.min(1,v));
export function plotQuantity(ev,variable,frame='lab',particle=1) {
  const final=frame==='cm'?ev.cmFinal:ev.final,initial=frame==='cm'?ev.cmInitial:ev.initial;
  const a=final[particle-1];if(!a)return undefined;
  const momentum=Math.hypot(a.px,a.py,a.pz),cosine=momentum?a.px/momentum:1;
  const other=final[particle%final.length],otherMomentum=Math.hypot(other.px,other.py,other.pz);
  switch(variable){
    case 'energy':return a.E;
    case 'momentum':return momentum;
    case 'beta':return a.E?momentum/a.E:0;
    case 'theta':return Math.acos(clamp(cosine))*180/Math.PI;
    case 'cosTheta':return cosine;
    case 'pT':return Math.hypot(a.py,a.pz);
    case 'kinetic':return a.E-(a.mass??invariantMass(a));
    case 'openingAngle':return momentum&&otherMomentum?Math.acos(clamp((a.px*other.px+a.py*other.py+a.pz*other.pz)/(momentum*otherMomentum)))*180/Math.PI:0;
    case 'invariantMass':return invariantMass(sumMomentum(final));
    case 'transferSquared':return massSquared(q(initial[0].E-a.E,initial[0].px-a.px,initial[0].py-a.py,initial[0].pz-a.pz));
    case 'momentumTransfer':return Math.hypot(initial[0].px-a.px,initial[0].py-a.py,initial[0].pz-a.pz);
    default:throw new RangeError('Unknown plot variable');
  }
}
export function histogram(values,bins,min,max) {
  if(!Number.isInteger(bins)||bins<1||!Number.isFinite(min)||!Number.isFinite(max)||min>=max)throw new RangeError('Invalid histogram range');
  const counts=Array(bins).fill(0);let underflow=0,overflow=0;
  for(const v of values){if(!Number.isFinite(v))continue;if(v<min)underflow++;else if(v>max)overflow++;
    else counts[Math.min(bins-1,Math.floor((v-min)/(max-min)*bins))]++;}
  return {min,max,counts,underflow,overflow,edges:Array.from({length:bins+1},(_,i)=>min+(max-min)*i/bins)};
}
function plotData(p) {
  let seed=p.seed>>>0;
  const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
  const points=[];
  for(let i=0;i<p.eventCount;i++){
    const cosine=p.distribution==='isotropic'?2*random()-1:-1+2*i/(p.eventCount-1);
    // Compton's single-event control uses lab angle; the sample measure is CM.
    const base=event(p),labCos=p.reaction==='compton'?(cosine+base.betaCM)/(1+base.betaCM*cosine):cosine;
    const ev=event(p,Math.acos(clamp(labCos)));
    const x=plotQuantity(ev,p.xVariable,p.xFrame,p.xParticle),y=plotQuantity(ev,p.yVariable,p.yFrame,p.yParticle);
    if(Number.isFinite(x)&&Number.isFinite(y))points.push({x,y,cosine});
  }
  const range=(axis)=>{
    if(p.plotRange==='manual')return [p[`${axis}Min`],p[`${axis}Max`]];
    const v=points.map(a=>a[axis]);let min=v.length?Math.min(...v):0,max=v.length?Math.max(...v):1;
    if(min===max){const padding=Math.max(1,Math.abs(min)*.05);min-=padding;max+=padding;}return [min,max];
  };
  const [xMin,xMax]=range('x'),[yMin,yMax]=range('y');
  return {points,x:{variable:p.xVariable,frame:p.xFrame,particle:p.xParticle,min:xMin,max:xMax},
    y:{variable:p.yVariable,frame:p.yFrame,particle:p.yParticle,min:yMin,max:yMax},
    histogram:histogram(points.map(a=>a.x),p.bins,xMin,xMax),distribution:p.distribution,seed:p.seed,
    requested:p.eventCount,available:points.length>0,
    note:p.distribution==='isotropic'?'Seeded uniform CM cosine toy sample; not a differential cross section.':'Allowed locus sampled uniformly in CM cosine; point density is not a probability.'};
}
export const model={id:'rel-kinematics',title:'Relativistic kinematics',params,presets,
  observables:[['cmEnergy','CM energy','\\sqrt{s}','MeV'],['invariantMass','Total invariant mass','M','MeV/c²'],
    ['betaCM','CM speed','\\beta_{CM}',''],['threshold','Threshold beam kinetic energy','K_{th}','MeV'],
    ['availableEnergy','Energy above final rest masses','Q','MeV'],['energy1','Daughter 1 energy','E_1','MeV'],
    ['momentum1','Daughter 1 momentum','p_1','MeV/c'],['angle1','Daughter 1 polar angle','\\theta_1','°'],
    ['photonEnergy','Scattered photon energy',"E'_\\gamma",'MeV'],['wavelengthShift','Compton wavelength shift','\\Delta\\lambda','m'],
    ['energyResidual','Energy balance residual','\\Delta E','MeV'],['momentumResidual','Momentum balance residual','|\\Delta p|','MeV/c'],
    ['allowed','Reaction kinematically allowed','', '']].map(([key,label,symbol,unit])=>({key,label,symbol,unit})),
  create(values={}) {
    const p=read(values), e=event(p),scatter=plotData(p);let t=0;
    const locus=Array.from({length:73},(_,i)=>{
      const cosine=-1+2*i/72,base=p.reaction==='compton'?(cosine+e.betaCM)/(1+e.betaCM*cosine):cosine;
      const ev=event(p,Math.acos(clamp(base))),a=ev.final[0]??q(0,0);
      return {cosine,E:a.E,px:a.px,py:a.py,theta:Math.atan2(Math.abs(a.py),a.px)};
    });
    const incoming=sumMomentum(e.initial),outgoing=sumMomentum(e.final);
    const delta=e.allowed?residual(incoming,outgoing):{energy:0,px:0,py:0,pz:0};
    return {get t(){return t;},step(dt){if(!Number.isFinite(dt)||dt<0||!Number.isFinite(t+dt))throw new RangeError('dt must be finite and nonnegative');t+=dt;},reset(){t=0;},
      sample(){
        const list=p.frame==='cm'?e.cmFinal:e.final,a=list[0]??q(0,0);
        const mom=Math.hypot(a.px,a.py,a.pz);
        return {t,cmEnergy:e.W,invariantMass:e.W,betaCM:e.betaCM,threshold:e.threshold,
          availableEnergy:e.W-e.requiredMass,
          energy1:a.E,momentum1:mom,angle1:mom?Math.acos(Math.max(-1,Math.min(1,a.px/mom)))*180/Math.PI:0,
          photonEnergy:e.photonEnergy,wavelengthShift:p.reaction==='compton'?H_C/masses.electron*(1-Math.cos(p.angle*Math.PI/180)):0,
          energyResidual:delta.energy,momentumResidual:Math.hypot(delta.px,delta.py,delta.pz),allowed:e.allowed?1:0};
      },
      invariants(){return {massSquared:e.W**2,initialEnergy:incoming.E,finalEnergy:outgoing.E,
        energyResidual:delta.energy,momentumResidual:Math.hypot(delta.px,delta.py,delta.pz),allowed:e.allowed};},
      geometry(){
        const bodies=qs=>qs.map(a=>({...a,x:a.E?C*a.px/a.E*t:0,y:a.E?C*a.py/a.E*t:0,z:a.E?C*a.pz/a.E*t:0}));
        return {reaction:p.reaction,frame:p.frame,time:t,allowed:e.allowed,betaCM:e.betaCM,
          lab:{initial:e.initial.map(a=>({...a})),final:bodies(e.final)},
          cm:{initial:e.cmInitial.map(a=>({...a})),final:bodies(e.cmFinal)},
          locus:locus.map(a=>({...a})),scatter:structuredClone(scatter),units:{x:'m',y:'m',z:'m',t:'s',E:'MeV',px:'MeV/c',mass:'MeV/c²'},
          angularMeasure:p.reaction==='compton'?'lab photon angle':'CM polar angle',
          note:p.reaction==='muon'?'Three-body kinematics only; no weak-interaction spectrum or lifetime sampling.':
            p.reaction==='pp-pion'?'Selected three-body event; no production cross section.':'Kinematic locus; no event probabilities.'};
      },
    };
  },
};
