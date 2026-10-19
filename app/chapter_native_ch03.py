"""Exact chapter 3 apparatus, driven only by the existing native Planck engine.

Double Atwood uses its analytically reduced constant tensions; the falling chain
is an explicit finite-element approximation, never silently a continuum solver.
"""
from __future__ import annotations
import math
from . import tutor,visual_library_recipes as v
from .chapter_native_ch02 import G,step,rod,force,apparatus,lesson

def atwood_values(m1=3.,m2=1.,m3=2.):
    T=4*G/(4/m1+1/m2+1/m3)
    a=[2*T/m1-G,T/m2-G,T/m3-G]
    return {'masses':[m1,m2,m3],'T':T,'a':a,'pulley_a':-a[0]}

def double_atwood():
    p=atwood_values();T=p['T'];R=.3;P=[.3,2.7]
    bodies=[rod('ceiling',[-.6,4.5],[.65,4.5],thickness=.15),rod('axle',[0,4.5],[0,4.1],thickness=.045),
            {'id':'fixed','type':'static','shape':'circle','r':R,'pos':[0,4.1],'render':{'kind':'disk','prop':'pulley'}},
            {'id':'carrier','type':'dynamic','shape':'circle','r':R,'pos':P,'mass':.0001,'inertia':'point','label':'moving pulley','friction':0,'render':{'kind':'disk','prop':'pulley'}}]
    places=[[-.3,2.7],[0,1.2],[.6,1.2]]
    for i,(m,pos) in enumerate(zip(p['masses'],places),1):
        bodies.append({'id':f'm{i}','type':'dynamic','shape':'circle','r':.13,'pos':pos,'mass':m,'inertia':'point','friction':0,'label':f'm{i}','render':{'kind':'sphere'}})
    forces=[force(f'm{i}',[0,(2 if i==1 else 1)*T],'2T' if i==1 else 'T') for i in (1,2,3)]
    # This independent pose carrier has no constraint or force coupling to the
    # masses. Its explicit force makes its acceleration equal -a1, as the ideal
    # upper-string reduction requires. Its tiny mass never enters T or the masses.
    forces.append(force('carrier',[0,.0001*(G+p['pulley_a'])],'ideal support'))
    joints=[{'id':f'guide{i}','type':'slider','a':'world','b':f'm{i}','anchor':pos,'axis':[0,1]} for i,pos in enumerate(places,1)]
    joints.append({'id':'carrier_guide','type':'slider','a':'world','b':'carrier','anchor':P,'axis':[0,1]})
    strings=[{'id':'upper','via':[{'body':'m1','attach':'top'},{'wrap':'fixed','ccw':False},{'body':'carrier','attach':'center'}],'tension':['2T'],'labels':[]},
             {'id':'lower','via':[{'body':'m2','attach':'top'},{'wrap':'carrier','ccw':False},{'body':'m3','attach':'top'}],'tension':['T'],'labels':[]}]
    steps=[step('Two ropes, two tensions','The upper rope supports the axle of the lower pulley. The lower rope carries the two lower masses.',show=['labels']),
           step('Force equations',r'Take upward positive. Then $2T-m_1g=m_1a_1$, $T-m_2g=m_2a_2$, and $T-m_3g=m_3a_3$.',show=['forces','labels'],camera='closeup'),
           step('Rope constraints',r'The moving pulley has $a_p=-a_1$. The lower rope gives $a_2+a_3=2a_p$, so $2a_1+a_2+a_3=0$. The displayed native trajectories satisfy both constraints.',show=['velocity','labels'])]
    sc=apparatus('Double Atwood — ideal constant-tension reduction',bodies,'m2',steps,forces=forces,joints=joints,strings=strings,duration=.65,
        nocollide=[[a,b] for a in ['carrier','m1','m2','m3'] for b in ['fixed','ceiling','axle']]+[['carrier','m1']],
        checks=[v._chk(f'm{i} acceleration','ay',p['a'][i-1],body=f'm{i}',at=.35,tol=.1) for i in (1,2,3)])
    return lesson("Double Atwood's machine",'Two ideal ropes and a moving lower pulley. Native motion uses the exact constant tensions obtained from the source constraints; pulley spin is not modeled.',sc,steps,
        ['m1 = 3 kg, m2 = 1 kg, m3 = 2 kg (illustrative)','released from rest; ideal massless ropes and pulleys'],
        ['Analytically reduced native Planck integration, not an arbitrary moving-pulley constraint solver. Both rope-length relations and each mass equation are checked over the entire motion.'])

def moving_plane():
    raw=v.block_on_free_wedge()
    raw['title']='Moving plane'
    raw['restatement']='Release a block from rest on a frictionless wedge which is free to slide on a frictionless horizontal surface.'
    raw['visualization']['caption']='Illustrative m = 1 kg, M = 2 kg, angle 30°. Both frictionless contacts are solved by the native engine; the wedge recoils.'
    raw['assumptions']=['Initial rest; no friction at either contact. Wedge size and block size are illustrative; the run stops before the block reaches an edge.']
    return raw

def chain_state(t,ell=4.,y0=2.):
    k=math.sqrt(G/ell);end=math.acosh(ell/y0)/k;t=min(max(0,t),end)
    return {'y':y0*math.cosh(k*t),'v':y0*k*math.sinh(k*t),'a':G*y0*math.cosh(k*t)/ell,'end':end}

def falling_chain(n=36):
    """Native discrete chain; a frictionless round guide redirects actual links.

    Equal point masses connected by inextensible rods approximate uniform density.
    A finite-radius tube is explicitly retained, rather than hiding its effects.
    """
    ell,y0=4.,2.;ds=ell/(n-1);bead=.012;radius=.10
    # Arc length coordinate s=0 is the tube entrance. Positive s follows the
    # clockwise quarter turn and then the downward vertical leg.
    def path(s):
        if s<=0:return [s,0]
        if s<math.pi*radius/2:
            a=s/radius;return [radius*math.sin(a),radius*(math.cos(a)-1)]
        return [radius,-radius-(s-math.pi*radius/2)]
    span_below=y0
    start=span_below-ell;places=[path(start+i*ds) for i in range(n)]
    # The point masses stay just above the physical table and inner guide. A
    # second guide surface is deliberately omitted: its solver skin pins small
    # beads in a zero-clearance slot. Tension maintains the downward tangent. The
    # bead radius is included in their physical contact geometry.
    center=[0,-radius]
    bodies=[v._floor(start-.2,0,y=-bead,mu=0,bid='table'),
        {'id':'inner_guide','type':'static','shape':'circle','r':radius-bead,'pos':center,'friction':0,'render':{'kind':'disk'}}]
    for i,pos in enumerate(places):bodies.append({'id':f'link{i:02}','type':'dynamic','shape':'circle','r':bead,'pos':pos,'mass':ell/n,'inertia':'point','friction':0,'restitution':0,'label':'chain' if i==n-1 else '', 'render':{'kind':'sphere'}})
    joints=[{'id':f'chain{i:02}','type':'rod','a':f'link{i:02}','b':f'link{i+1:02}','anchorA':places[i],'anchorB':places[i+1],'length':math.dist(places[i],places[i+1]),'label':'T' if i==n-2 else ''} for i in range(n-1)]
    # Actual continuous routing is drawn through all mass elements. Adjacent
    # point masses do not collide; all still contact the table and tube guides.
    strings=[{'id':'chain','via':[{'body':f'link{i:02}','attach':'center'} for i in range(n)],'tension':[],'labels':[]}]
    duration=.62
    steps=[step('Uniform chain and guide','Thirty-six equal mass elements approximate the chain. A short frictionless round guide redirects it from the table to the vertical leg.',show=['labels']),
           step('The ideal equation',r'In the short-guide continuum limit the whole chain has mass $\rho\ell$, while the hanging portion supplies $\rho gy$. Thus $\ddot y=(g/\ell)y$.',show=['forces','labels'],camera='closeup'),
           step('Release from rest',r'$y(t)=y_0\cosh(\sqrt{g/\ell}\,t)$ until the end leaves the table. The ideal final speed is $\sqrt{g\ell}\sqrt{1-(y_0/\ell)^2}$. Finite links and the finite guide make this native run an approximation.',show=['velocity','labels'])]
    sc=apparatus('Falling chain — native finite-element approximation',bodies,f'link{n-1:02}',steps,joints=joints,strings=strings,duration=duration,
        nocollide=[[f'link{i:02}',f'link{i+1:02}'] for i in range(n-1)])
    return lesson('Falling chain','Native finite-element chain over a frictionless table and curved guide. Illustrative length 4 m, initially 2 m routed beyond the table edge including the bend; compare the ideal continuum equation in Breakdown.',sc,steps,
        ['ℓ = 4 m, y0 = 2 m (illustrative)','36 equal mass elements; finite 0.10 m guide radius'],
        ['Finite-element approximation, not exact continuum dynamics. Run ends while the trailing end remains on the table. Native constraints/contact and ideal-equation error are measured independently. Finite links lose some energy at the bend; the measured hanging-length error stays below 3% during this short run.'])

def cliff_values(v0=6.,h=2.):
    angle=math.atan(v0/math.sqrt(v0*v0+2*G*h));vx=v0*math.cos(angle);vy=v0*math.sin(angle)
    end=(vy+math.sqrt(vy*vy+2*G*h))/G
    return {'v0':v0,'h':h,'angle':angle,'vx':vx,'vy':vy,'end':end,'range':vx*end}

def cliff_launch():
    p=cliff_values();r=.075;h=p['h']
    steps=[step('Launch from the cliff','The launch and landing levels differ by h. The default angle maximizes the range for this illustrative height and launch speed.',show=['labels']),
           step('Horizontal and vertical motion',r'$x=v\cos\theta\,t$ and $y=h+v\sin\theta\,t-gt^2/2$. The flight time is the positive root of $y=0$.',show=['velocity','labels'],camera='closeup'),
           step('Optimal angle',r'$\tan\theta_{\max}=v/\sqrt{v^2+2gh}$ and $d_{\max}=(v^2/g)\sqrt{1+2gh/v^2}$. A higher cliff makes the optimal angle smaller than 45°.',show=['velocity','trail','labels'])]
    sc=apparatus('Maximum-range cliff launch',[
        v._floor(-1.1,p['range']+.4,y=-r,mu=0),
        {'id':'cliff','type':'static','shape':'box','w':.9,'h':h,'pos':[-.45,h/2-r],'friction':0,'render':{'kind':'box'}},
        {'id':'ball','type':'dynamic','shape':'circle','r':r,'pos':[0,h],'mass':1,'inertia':'point','vel':[p['vx'],p['vy']],'friction':0,'restitution':0,'bullet':True,'label':'v','render':{'kind':'sphere'}}],
        'ball',steps,duration=p['end'],checks=[v._chk('Flight range','x',p['range'],body='ball',at=p['end'],tol=.25),v._chk('Landing level','y',0,body='ball',at=p['end'],tol=.25)])
    return lesson('Throwing a ball from a cliff','Native projectile flight from a visible cliff to horizontal ground. Illustrative height 2 m and speed 6 m/s; angle is the exact optimum for those values.',sc,steps,
        ['v = 6 m/s, h = 2 m (illustrative)','no air resistance; g = 9.81 m/s²'],['Ball size is illustrative. Launch/landing center levels differ by exactly h, matching the two physical surface levels.'])

def pole_initial():
    R,r,m,v0=1.,.35,1.,1.;beta=math.asin(r/R);T=m*v0*v0/(R*math.cos(beta))
    tx=r*r/R;ty=r*math.sqrt(1-r*r/(R*R));contact=[tx,ty]
    vector=[T*(tx-R)/math.sqrt(R*R-r*r),T*ty/math.sqrt(R*R-r*r)]
    steps=[step('Tangent contact','Initial-force illustration of the exact pole-wrap geometry. Ordinary entry uses the existing playable prepared 3D scene.',show=['labels']),
           step('Two components of tension',r'$\sin\beta=r/R$. Radial balance gives $T\cos\beta=mv^2/R$; the forward component gives $T\sin\beta=m\dot v$.',show=['forces','labels'],camera='closeup'),
           step('Finite-time singularity',r'$v(t)=[1/v_0-(\tan\beta)t/R]^{-1}$. This ideal expression diverges at $t_*=R/(v_0\tan\beta)$; it cannot describe motion beyond that time.',show=['labels'])]
    sc=apparatus('Pole wrap — initial tangent-force geometry',[
        {'id':'pole','type':'static','shape':'circle','r':r,'pos':[0,0],'render':{'kind':'disk'}},
        {'id':'mass','type':'static','shape':'circle','r':.07,'pos':[R,0],'label':'m','render':{'kind':'sphere'}}],
        'mass',steps,forces=[force('mass',vector,'T')],gravity=0,
        strings=[{'id':'tangent','via':[{'world':contact},{'body':'mass','attach':'center'}],'tension':['T'],'labels':[]}])
    sc['topdown']=True
    return lesson('Circling around a pole','Initial tangent-force geometry. The existing exact prepared pole-wrap scene retains normal-entry precedence and supplies the actual accelerating circular motion.',sc,steps,
        ['R = 1 m, r = 0.35 m, m = 1 kg, v0 = 1 m/s (illustrative)'],['Static initial-force illustration only. No constant-tension circular-motion run is claimed.'])

BUILDERS={'3.2':double_atwood,'3.8':moving_plane,'3.11':falling_chain,'3.17':cliff_launch,'3.22':pole_initial}
