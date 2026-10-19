"""Source-specific oscillator apparatus using the bounded native Planck language.

Time-dependent loads use twenty explicitly disclosed midpoint intervals because
the native engine supports constant loads, not arbitrary force callbacks.
"""
from __future__ import annotations
import math
from . import tutor, visual_library_recipes as v

G=9.81

def step(title,body,**kwargs):
    return tutor._step(title,body,at=kwargs.pop('at',0),camera=kwargs.pop('camera','side'),**kwargs)

def lesson(title,caption,scene,steps,relation,*,assumptions=(),givens=(),kind='mechanics'):
    return tutor._lesson('Mechanics · exact chapter apparatus',title,caption,list(givens),
        [v._ans('Source relation',relation)],steps,kind,scene,caption,list(assumptions),
        plan='Inspect the setup, then reveal one source-specific equation at a time.')

def oscillator(bid='mass',*,x=.3,y=.5,mass=1.,k=4.,velocity=0.,damping=0.):
    bodies=[{'id':bid+'_wall','type':'static','shape':'box','w':.12,'h':.75,'pos':[-1.06,y],'render':{'kind':'box'}},
            v._floor(-1.1,.9,y=y-.2,mu=0,bid=bid+'_track'),
            {'id':bid,'shape':'box','w':.4,'h':.4,'mass':mass,'inertia':'plate','pos':[x,y],'vel':[velocity,0],
             'friction':0,'restitution':0,'label':bid,'render':{'kind':'box','prop':'block'}}]
    joints=[{'id':bid+'_rail','type':'slider','a':'world','b':bid,'anchor':[0,y],'axis':[1,0]},
            {'id':bid+'_spring','type':'spring','a':'world','b':bid,'anchorA':[-1,y],'anchorB':[x,y],'k':k,'rest':1.,'damping':damping,'label':'spring'}]
    return bodies,joints

def sampled_load(bid,fn,duration,*,power=1.,label='applied load'):
    knots=[duration*(i/20)**power for i in range(21)]
    return [{'body':bid,'F':[fn((a+b)/2),0],'from':a,'to':b-1e-8,'label':label} for a,b in zip(knots,knots[1:])]

def increased_mass_state(t,d=.6,k=4.,m=1.):
    w=math.sqrt(k/m);wn=w/math.sqrt(2);C=d/2;D=math.sqrt(6)*d/4
    return {'x':C*math.cos(wn*t)+D*math.sin(wn*t),'v':wn*(-C*math.sin(wn*t)+D*math.cos(wn*t)),
            'omega':wn,'amplitude':math.sqrt(10)*d/4,'v_before':math.sqrt(3)*w*d/2,'v_after':math.sqrt(3)*w*d/4}

def increasing_mass():
    p=increased_mass_state(0);b,j=oscillator('joined',x=p['x'],mass=2,k=4,velocity=p['v'])
    next(x for x in b if x['id']=='joined')['label']='2m'
    steps=[step('Immediately after sticking','The run begins at t = 0 just after the collision: the joined mass is 2m, at d/2, moving right at half the incoming speed.',show=['labels']),
           step('Apply the new initial conditions',r'$\omega=\sqrt{k/m}$, $\omega\prime=\omega/\sqrt2$. Thus $x(0)=d/2$ and $\dot x(0)=\sqrt3\,\omega d/4$.',show=['velocity','labels'],camera='closeup'),
           step('Resulting oscillation',r'$x(t)=(d/2)\cos(\omega\prime t)+(\sqrt6d/4)\sin(\omega\prime t)$. The new amplitude is $\sqrt{10}d/4$; it is smaller than d because sticking dissipates kinetic energy.',show=['forces','energy','labels'])]
    sc=v._scene('Joined mass on the original spring',steps,bodies=b,joints=j,duration=2*math.pi/p['omega'],focus='joined',gravity=G,camera='side')
    return lesson('Increasing the mass','The original spring carries the joined mass immediately after sticking. Illustrative m = 1 kg, k = 4 N/m, original amplitude d = 0.6 m.',sc,steps,r'A_{\rm new}=\sqrt{10}d/4',
        givens=['At t=0: x=d/2 and velocity is positive','Two equal masses have just stuck together'],
        assumptions=['Native spring dynamics starts just after the ideal instantaneous collision. The collision itself is not animated or claimed to be simulated.','A single composite block represents the attached pair; its native mass is exactly 2m.'])

def overdamped_state(t,x0=.5,omega=2.,gamma=3.):
    if gamma<omega:raise ValueError('This comparison requires critical or overdamping')
    if abs(gamma-omega)<1e-7:
        x=x0*(1+omega*t)*math.exp(-omega*t);vel=-x0*omega*omega*t*math.exp(-omega*t)
        return {'x':x,'v':vel,'tmax':1/omega,'ratio':math.e}
    a=math.sqrt(gamma*gamma-omega*omega);slow=gamma-a;fast=gamma+a
    x=x0*(fast*math.exp(-slow*t)-slow*math.exp(-fast*t))/(2*a)
    vel=-x0*omega*omega*(math.exp(-slow*t)-math.exp(-fast*t))/(2*a)
    tm=math.log(fast/slow)/(2*a)
    ratio=math.exp(gamma*math.log(fast/slow)/(2*a))
    return {'x':x,'v':vel,'tmax':tm,'ratio':ratio}

def maximum_speed():
    b1,j1=oscillator('dry',x=.5,y=.5);b2,j2=oscillator('fluid',x=.5,y=1.6)
    forces=sampled_load('fluid',lambda t:-6*overdamped_state(t)['v'],2.,power=1.7,label='viscous load')
    steps=[step('Two releases from rest','Both masses start at the same x0 on springs with the same natural frequency. The upper apparatus represents the repeated experiment in a viscous fluid.',show=['labels']),
           step('The fluid equation',r'$\ddot x+2\gamma\dot x+\omega^2x=0$, with $\gamma>\omega$. Native forcing samples the exact viscous load in 20 short intervals; the resulting path and peak speed are independently compared with the continuous solution.',show=['forces','velocity','labels'],camera='closeup'),
           step('Compare peak speeds',r'Write $\alpha=\sqrt{\gamma^2-\omega^2}$. The ratio is $R=[(\gamma+\alpha)/(\gamma-\alpha)]^{\gamma/(2\alpha)}$. It tends to $2\gamma/\omega$ for strong damping and to e at critical damping.',show=['velocity','labels'])]
    sc=v._scene('Dry and overdamped releases',steps,bodies=b1+b2,joints=j1+j2,forces=forces,duration=2.,focus='fluid',gravity=G,camera='side',nocollide=[[x['id'],y['id']] for x in b1 for y in b2])
    return lesson('Maximum speed','Compare identical spring releases with and without viscous fluid. Illustrative omega = 2 rad/s, gamma = 3 /s, x0 = 0.5 m. The fluid load uses 20 checked short intervals.',sc,steps,r'R=[(\gamma+\alpha)/(\gamma-\alpha)]^{\gamma/(2\alpha)}',
        assumptions=['Explicit midpoint approximation to viscous drag on this release, not a general fluid or feedback-drag solver. The two apparatuses depict separate experiments.','Spring damping remains zero; the visible applied load represents the fluid. Native motion is checked against the exact overdamped solution.'])

def driven_state(t,omega=2.,gamma=.4,wd=1.6,F=.6):
    delta=omega*omega-wd*wd;den=delta*delta+4*gamma*gamma*wd*wd
    A=F*delta/den;B=2*F*gamma*wd/den
    return {'A':A,'B':B,'x':A*math.cos(wd*t)+B*math.sin(wd*t),'v':wd*(-A*math.sin(wd*t)+B*math.cos(wd*t)),
            'a':-wd*wd*(A*math.cos(wd*t)+B*math.sin(wd*t)),'drive':F*math.cos(wd*t),'duration':2*math.pi/wd}

def driven_oscillator():
    p=driven_state(0);b,j=oscillator('mass',x=p['x'],velocity=p['v'],damping=.2)
    forces=sampled_load('mass',lambda t:driven_state(t)['drive'],p['duration'],label='periodic drive')
    steps=[step('A periodic drive','The spring mass starts in its particular steady response. The actuator load is cosine-shaped; the native run uses twenty midpoint load intervals over one drive period.',show=['labels']),
           step('Match the two coefficients',r'For $\ddot x+2\gamma\dot x+\omega^2x=F\cos\omega_dt$, insert $x=A\cos\omega_dt+B\sin\omega_dt$. Cosine gives $(\omega^2-\omega_d^2)A+2\gamma\omega_dB=F$; sine gives $(\omega^2-\omega_d^2)B-2\gamma\omega_dA=0$. Here F is force per unit mass.',show=['forces','labels'],camera='closeup'),
           step('Amplitude and phase',r'With $D=(\omega^2-\omega_d^2)^2+4\gamma^2\omega_d^2$, $A=F(\omega^2-\omega_d^2)/D$ and $B=2F\gamma\omega_d/D$. The positive sine term represents the phase lag.',show=['velocity','labels'])]
    sc=v._scene('Spring mass under a periodic load',steps,bodies=b,joints=j,forces=forces,duration=p['duration'],focus='mass',gravity=G,camera='side')
    return lesson('Driven oscillator','A damped spring mass follows one drive period. Illustrative m=1 kg, omega=2 rad/s, gamma=0.4 /s, drive frequency 1.6 rad/s; the cosine load is sampled in 20 checked intervals.',sc,steps,r'A=F(\omega^2-\omega_d^2)/D,\quad B=2F\gamma\omega_d/D',
        assumptions=['Native spring damping ratio is gamma/omega = 0.2. The drive is an explicitly bounded piecewise-constant approximation, not continuous forcing.','Initial displacement and velocity are those of the particular solution; no zero-initial-condition transient is silently substituted.'])

def coupled_state(t,a=.2,k=1.,kap=.06,m=1.):
    w=math.sqrt(k/m);w2=math.sqrt((k+2*kap)/m)
    return {'x1':a/2*(math.cos(w*t)+math.cos(w2*t)),'x2':a/2*(math.cos(w*t)-math.cos(w2*t)),
            'v1':-a/2*(w*math.sin(w*t)+w2*math.sin(w2*t)),'v2':-a/2*(w*math.sin(w*t)-w2*math.sin(w2*t)),
            'omega':w,'omega2':w2,'epsilon':kap*w/(2*k),'transfer':math.pi/(w2-w)}

def weakly_coupled():
    raw=v.coupled_springs();sc=raw['visualization']['scene'];p=coupled_state(0)
    for j in sc['joints']:
        if j['type']=='spring':j['k']=.06 if j['id']=='s2' else 1.
    sc['duration']=1.04*p['transfer'];sc['checks']=[]
    steps=[step('One mass displaced','Two equal masses lie between two walls. The middle spring is weak: kappa/k=0.06. Initially only the left mass is displaced and both are at rest.',show=['labels']),
           step('Two exact mode frequencies',r'$m\ddot x_1=-kx_1+\kappa(x_2-x_1)$ and $m\ddot x_2=-kx_2-\kappa(x_2-x_1)$. Sum and difference oscillate at $\omega=\sqrt{k/m}$ and $\widetilde\omega=\sqrt{(k+2\kappa)/m}$.',show=['forces','labels'],camera='closeup'),
           step('Watch the slow transfer',r'$x_1=(a/2)(\cos\omega t+\cos\widetilde\omega t)$, $x_2=(a/2)(\cos\omega t-\cos\widetilde\omega t)$. For weak coupling, $\epsilon\approx\kappa\omega/(2k)$ gives a slow envelope. Native dynamics uses the exact two stiffnesses, not the approximate envelope.',show=['velocity','energy','labels'])]
    sc['title']='Weak middle spring and slow energy exchange';sc['steps']=[{'title':s['title'],'body':s['body'],'at':s['at'],'show':s['show'],'camera':s['camera'],'highlight':[],'actions':[]} for s in steps]
    return lesson('Weakly coupled','Two masses exchange energy through a visibly weak middle spring. Illustrative m=1 kg, outside k=1 N/m, middle kappa=0.06 N/m; the run spans the first slow energy handoff.',sc,steps,r'x_{1,2}=(a/2)(\cos\omega t\pm\cos\widetilde\omega t)',
        assumptions=['Exactly the source three-spring/two-equal-mass topology. The native solver uses kappa/k=0.06; the source weak-coupling envelope is an approximation, distinguished from the exact normal-mode solution.','A finite spring solver has numerical dissipation; energy loss over the handoff is measured separately.'])

BUILDERS={'4.3':increasing_mass,'4.6':maximum_speed,'4.8':driven_oscillator,'4.10':weakly_coupled}
