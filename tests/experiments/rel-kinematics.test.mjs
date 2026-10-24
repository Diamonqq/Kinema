import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../static/js/experiments/rel-kinematics/model.js',import.meta.url),'utf8');
const {model,C,H_C,masses,boostMomentum,sumMomentum,massSquared,invariantMass,twoBodyMomentum,thresholdKinetic,comptonEnergy,histogram,plotVariables}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function near(a,b,tol,label=''){assert.ok(Math.abs(a-b)<=tol,`${label}: ${a} vs ${b}; absolute tolerance ${tol}`);}
function conserve(m,tol=1e-8) {
  for(const f of ['lab','cm']) {
    const {initial,final}=m.geometry()[f],a=sumMomentum(initial),b=sumMomentum(final);
    for(const k of ['E','px','py','pz'])near(a[k],b[k],tol,`${f}.${k}`);
  }
}
test('four-momentum boosts preserve invariant mass: 1e-8 MeV² and inverse 1e-10 MeV, MeV/c',()=>{
  const a={E:10,px:3,py:4,pz:1};
  for(const b of [-.95,-.6,0,.6,.95]){
    const x=boostMomentum(a,b),back=boostMomentum(x,-b);
    near(massSquared(x),74,1e-8);
    for(const k of ['E','px','py','pz'])near(back[k],a[k],1e-10,k);
  }
});
test('two-body decay momentum vs closed form: tolerance 1e-12 MeV/c',()=>{
  near(twoBodyMomentum(10,3,4),Math.sqrt((100-49)*(100-1))/20,1e-12);
  near(twoBodyMomentum(masses.pion0,0,0),masses.pion0/2,1e-12);
  near(twoBodyMomentum(7,3,4),0,1e-12);
  assert.throws(()=>twoBodyMomentum(6,3,4),RangeError);
});
test('neutral-pion photons: energy sharing, masses, CM total momentum (1e-8 MeV, MeV/c, MeV²)',()=>{
  for(const beta of [-.95,0,.8,.95])for(const angle of [0,60,90,180]) {
    const m=model.create({reaction:'pion-decay',beta,angle});conserve(m);
    const {lab,cm}=m.geometry();
    for(const a of [...lab.final,...cm.final])near(massSquared(a),0,1e-8);
    near(invariantMass(sumMomentum(lab.final)),masses.pion0,1e-8);
    near(cm.final[0].E,masses.pion0/2,1e-8);
    near(sumMomentum(cm.final).px,0,1e-8);
    const g=1/Math.sqrt(1-beta*beta);
    near(lab.final[0].E,g*masses.pion0/2*(1+beta*Math.cos(angle*Math.PI/180)),1e-8);
  }
});
test('custom elastic and inelastic lab/CM conservation: tolerance 1e-8 MeV and MeV/c',()=>{
  for(const reaction of ['elastic','collision'])for(const angle of [0,45,90,180]) {
    const m=model.create({reaction,mass1:2,mass2:3,mass3:4,mass4:1,kinetic:20,angle});
    conserve(m);near(sumMomentum(m.geometry().cm.initial).px,0,1e-8);
    near(m.sample().invariantMass,Math.sqrt(4+9+6*22),1e-8);
  }
});
test('fixed-target pion threshold: K = 2 m_pi + m_pi²/(2 m_p), tolerance 1e-10 MeV',()=>{
  const {proton:p,pion0:pi}=masses,expected=2*pi+pi*pi/(2*p);
  near(thresholdKinetic(p,p,[p,p,pi]),expected,1e-10);
  const below=model.create({reaction:'pp-pion',kinetic:expected-.001});assert.equal(below.sample().allowed,0);
  assert.equal(below.geometry().lab.final.length,0);
  const at=model.create({reaction:'pp-pion',kinetic:expected});assert.equal(at.sample().allowed,1);conserve(at);
  near(at.sample().availableEnergy,0,1e-10);
  for(const fraction of [.01,.5,.99]){
    const above=model.create({reaction:'pp-pion',kinetic:400,pairFraction:fraction});conserve(above);
    for(const a of above.geometry().lab.final)assert.ok(a.E>0);
  }
});
test('general reaction threshold and forbidden decay remain finite (1e-10 MeV)',()=>{
  near(thresholdKinetic(2,3,[4,5]),(81-25)/6,1e-10);
  const m=model.create({reaction:'collision',mass1:2,mass2:3,mass3:4,mass4:5,kinetic:1});
  assert.equal(m.sample().allowed,0);assert.ok(m.sample().availableEnergy<0);
  const forbidden=model.create({reaction:'decay',parentMass:1,mass1:1,mass2:1});
  assert.equal(forbidden.sample().allowed,0);near(forbidden.sample().availableEnergy,-1,1e-10);
});
test('Compton shift Δlambda = h/(mc)(1-cos theta), tolerance 1e-24 m; conservation 1e-8 MeV',()=>{
  for(const E of [.01,.51,10,10000])for(const angle of [0,60,90,180]) {
    const m=model.create({reaction:'compton',kinetic:E,angle});conserve(m,2e-8);
    const rad=angle*Math.PI/180,expected=E/(1+E/masses.electron*(1-Math.cos(rad)));
    near(m.sample().photonEnergy,expected,1e-10);
    near(comptonEnergy(E,rad),expected,1e-10);
    near(m.sample().wavelengthShift,H_C/masses.electron*(1-Math.cos(rad)),1e-24);
    near(H_C/expected-H_C/E,m.sample().wavelengthShift,1e-24);
    const electron=m.geometry().lab.final[1];near(massSquared(electron),masses.electron**2,3e-8,'electron on shell MeV²');
  }
});
test('muon true three-body kinematics at rest/in flight: conservation 1e-8 MeV, shell 1e-8 MeV²',()=>{
  for(const beta of [0,.8,.95])for(const pairFraction of [.01,.5,.99]) {
    const m=model.create({reaction:'muon',beta,pairFraction});conserve(m);
    const daughters=m.geometry().lab.final;assert.equal(daughters.length,3);
    near(massSquared(daughters[0]),masses.electron**2,1e-8);
    near(massSquared(daughters[1]),0,1e-8);near(massSquared(daughters[2]),0,1e-8);
    near(invariantMass(sumMomentum(daughters)),masses.muon,1e-8);
  }
});
test('kinematic ellipse locus follows boosted momentum circle: tolerance 1e-10 dimensionless',()=>{
  const m=model.create({reaction:'pion-decay',beta:.8}),geo=m.geometry();
  const P=masses.pion0/2,g=1/Math.sqrt(1-.8**2),center=g*.8*P;
  for(const a of geo.locus)near(((a.px-center)/(g*P))**2+(a.py/P)**2,1,1e-10);
});
test('declared extreme mass/energy ranges: finite data and conservation within 5e-9 times input energy (MeV, MeV/c)',()=>{
  for(const mass1 of [0,.01,5000])for(const mass2 of [.01,5000])for(const kinetic of [.01,10000])for(const reaction of ['elastic','collision']) {
    const m=model.create({reaction,mass1,mass2,kinetic,mass3:0,mass4:0,angle:179});
    const geo=m.geometry();
    assert.ok(Object.values(m.sample()).every(Number.isFinite));
    assert.ok(!JSON.stringify(geo).includes('null'),'finite geometry at parameter limits');
    if(geo.allowed)conserve(m,5e-9*Math.max(1,sumMomentum(geo.lab.initial).E));
  }
});
test('all presets finite, SI straight-line playback, step/reset and validation (1e-6 m, 1e-15 s)',()=>{
  for(const preset of model.presets){
    const m=model.create(preset.values);assert.ok(Object.values(m.sample()).every(Number.isFinite));
    if(m.sample().allowed)conserve(m);
    m.step(.13);m.step(.27);near(m.t,.4,1e-15);
    for(const a of m.geometry().lab.final)near(a.x,C*a.px/a.E*.4,1e-6);
    m.reset();assert.equal(m.t,0);
    const snapshot=m.geometry();snapshot.lab.initial[0].E=-1;assert.ok(m.geometry().lab.initial[0].E>0);
  }
  for(const v of [{beta:1},{kinetic:NaN},{reaction:'elastic',mass2:0},{reaction:'oops'},{frame:'oops'}])assert.throws(()=>model.create(v),RangeError);
  const m=model.create();for(const dt of [-1,Infinity,NaN])assert.throws(()=>m.step(dt),RangeError);
});
test('CUPS default pion/proton event and momentum input conserve four-momentum (1e-8 MeV, MeV/c)',()=>{
  const m=model.create({reaction:'pion-proton',inputMode:'momentum',beamMomentum:100,angle:30});conserve(m);
  near(m.geometry().lab.initial[0].px,100,1e-8);
  near(m.geometry().lab.initial[0].E,Math.hypot(masses.pion,100),1e-8);
  const decay=model.create({reaction:'pion-decay',inputMode:'momentum',beamMomentum:100});conserve(decay);
  near(sumMomentum(decay.geometry().lab.final).px,100,1e-8);
  const zero=model.create({reaction:'elastic',kinetic:0});conserve(zero);
});
test('all nine original plot quantities plus transfers are selectable in either frame/daughter (finite; invariant mass 1e-8 MeV/c²)',()=>{
  for(const {value} of plotVariables)for(const xFrame of ['cm','lab'])for(const xParticle of [1,2]){
    const m=model.create({reaction:'pion-proton',inputMode:'momentum',beamMomentum:100,xVariable:value,xFrame,xParticle});
    const s=m.geometry().scatter;assert.equal(s.points.length,100);assert.equal(s.histogram.counts.reduce((a,b)=>a+b,0),100);
    assert.ok(s.points.every(a=>Number.isFinite(a.x)&&Number.isFinite(a.y)));
    if(value==='invariantMass')for(const a of s.points)near(a.x,m.sample().invariantMass,1e-8);
  }
  const absent=model.create({xParticle:3}).geometry().scatter;assert.equal(absent.available,false);assert.deepEqual(absent.points,[]);
});
test('plot angles and energy obey CM-to-lab boost; transfer is invariant (1e-8 MeV / MeV², 1e-10 degrees)',()=>{
  const p={reaction:'pion-decay',beta:.8,eventCount:5,xVariable:'cosTheta',xFrame:'cm',yVariable:'energy',yFrame:'lab',yParticle:1};
  const s=model.create(p).geometry().scatter,g=1/Math.sqrt(1-.8**2),E=masses.pion0/2;
  for(const a of s.points)near(a.y,g*E*(1+.8*a.x),1e-8);
  const cm=model.create({...p,xVariable:'transferSquared',xFrame:'cm'}).geometry().scatter;
  const lab=model.create({...p,xVariable:'transferSquared',xFrame:'lab'}).geometry().scatter;
  cm.points.forEach((a,i)=>near(a.x,lab.points[i].x,1e-8));
  const opening=model.create({...p,xVariable:'openingAngle',xFrame:'cm'}).geometry().scatter;
  for(const a of opening.points)near(a.x,180,1e-10);
});
test('seeded isotropic CM sampling is reproducible, balanced and Compton uses CM cosine (0.04 cosine mean; 1e-10 cosine)',()=>{
  const p={reaction:'compton',distribution:'isotropic',eventCount:2048,seed:42,xVariable:'cosTheta',xFrame:'cm',xParticle:1};
  const m=model.create(p),a=m.geometry().scatter,b=model.create(p).geometry().scatter;
  assert.deepEqual(a,b);near(a.points.reduce((s,v)=>s+v.x,0)/a.points.length,0,.04);
  for(const v of a.points)near(v.x,v.cosine,1e-10);
  assert.notDeepEqual(a.points,model.create({...p,seed:43}).geometry().scatter.points);
  a.points[0].x=99;assert.notEqual(m.geometry().scatter.points[0].x,99);
});
test('histogram includes upper edge and reports manual-range clipping (exact integer counts)',()=>{
  const h=histogram([-1,0,.5,1,1.5,2,3],2,0,2);
  assert.deepEqual(h.counts,[2,3]);assert.equal(h.underflow,1);assert.equal(h.overflow,1);
  const s=model.create({xVariable:'theta',xFrame:'cm',eventCount:5,plotRange:'manual',xMin:45,xMax:135,yMin:0,yMax:180,bins:2}).geometry().scatter;
  assert.equal(s.histogram.counts.reduce((a,b)=>a+b,0)+s.histogram.underflow+s.histogram.overflow,5);
  for(const p of [{eventCount:5.5},{bins:2.5},{seed:0},{plotRange:'manual',xMin:2,xMax:1}])assert.throws(()=>model.create(p),RangeError);
});
