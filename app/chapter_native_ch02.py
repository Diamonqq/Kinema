"""Exact chapter 2 apparatus. Statics are explicitly analytic 3D illustrations.

Every pose and force uses the existing bounded mechanics schema; no custom solver
or renderer. Rope/chain sampling is geometric, not a claim of a continuum run.
"""
from __future__ import annotations
import math
from . import tutor, visual_library_recipes as v

G=9.81

def step(title,body,**kw):
    return tutor._step(title,body,at=kw.pop('at',0),camera=kw.pop('camera','side'),**kw)

def rod(bid,a,b,*,thickness=.035,label='',static=True,mass=1,prop=None):
    dx,dy=b[0]-a[0],b[1]-a[1]
    return {'id':bid,'type':'static' if static else 'dynamic','shape':'box','w':math.hypot(dx,dy),'h':thickness,
            'pos':[(a[0]+b[0])/2,(a[1]+b[1])/2],'angle_deg':math.degrees(math.atan2(dy,dx)),
            'mass':mass,'inertia':'rod','friction':0,'restitution':0,'label':label,
            'render':{'kind':'rod',**({'prop':prop} if prop else {})}}

def force(bid,vec,label,offset=(0,0)):
    return {'body':bid,'F':list(vec),'offset':list(offset),'from':0,'to':None,'label':label}

def apparatus(title,bodies,focus,steps,*,forces=(),joints=(),strings=(),duration=.1,checks=(),gravity=G,nocollide=()):
    return v._scene(
        title,steps,bodies=bodies,focus=focus,duration=duration,forces=forces,joints=joints,strings=strings,
        checks=checks,gravity=gravity,nocollide=nocollide,camera='side')

def lesson(title,description,scene,steps,givens,assumptions,answers=()):
    if not answers:
        relation={'Hanging rope':r'T(y)=\rho gy',
                  'Hanging chain':r'y=a\cosh((x-x_0)/a)+C',
                  'Block on a plane':r'f_x=-N_x=mg\sin\theta\cos\theta',
                  'Supporting a ladder':r'F=MgL\sin\theta/(2\ell)',
                  'The spool':r'\cos\theta=r/R',
                  "Double Atwood's machine":r'2a_1+a_2+a_3=0',
                  'Falling chain':r'y(t)=y_0\cosh(\sqrt{g/\ell}\,t)',
                  'Throwing a ball from a cliff':r'\tan\theta_{\max}=v/\sqrt{v^2+2gh}',
                  'Circling around a pole':r'v(t)=[1/v_0-(\tan\beta)t/R]^{-1}'}[title]
        answers=[v._ans('Source-specific relation',relation)]
    return tutor._lesson('Mechanics · exact chapter apparatus',title,description,givens,list(answers),steps,
        'mechanics',scene,description,assumptions,plan='Identify the stated constraints, then open Breakdown for one idea at a time.')

def hanging_rope():
    L,rho,n=3.,.4,18
    ds=L/n;focus='rope09';bodies=[]
    for i in range(n):bodies.append(rod(f'rope{i:02}',[0,i*ds],[0,(i+1)*ds],thickness=.035,label='rope' if i==9 else ''))
    bodies.extend([rod('ceiling',[-.45,L+.10],[.45,L+.10],thickness=.16),rod('hook',[0,L],[0,L+.1],thickness=.045)])
    low,high=9*ds,10*ds
    forces=[force(focus,[0,rho*G*high],'T above',[0,ds/2]),force(focus,[0,-rho*G*low],'T below',[0,-ds/2]),force(focus,[0,-rho*G*ds],'weight')]
    steps=[step('Full rope','Static equilibrium illustration: the ceiling carries the rope; the lower end is free.',show=['labels']),
           step('Cut at height y',r'Measure $y$ upward from the free end. The portion below the cut has mass $\rho y$. Its weight is supported by $T(y)=\rho gy$.',show=['forces','labels'],camera='closeup'),
           step('A short element',r'On the highlighted element, $T_{\rm above}-T_{\rm below}=\rho g\,\Delta y$. The free-end tension is zero; the ceiling tension is $\rho gL$.',show=['forces','labels'])]
    scene=apparatus('Hanging rope — analytic equilibrium',bodies,focus,steps,forces=forces)
    return lesson('Hanging rope','Static equilibrium: a uniform rope hangs from a visible ceiling hook. Illustrative L = 3 m and density = 0.4 kg/m.',scene,steps,
        ['L = 3 m (illustrative)','ρ = 0.4 kg/m (illustrative)','y is measured upward from the free end'],
        ['Analytic static force illustration; the 18 straight pieces sample one continuous rope. Play does not represent a dynamics experiment.'])

def catenary_parameters(d=3.,rise=.6,length=4.,rho=.35):
    if not length>math.hypot(d,rise):raise ValueError('A hanging chain needs slack beyond its support separation')
    target=math.sqrt(length*length-rise*rise)
    lo,hi=d/100,100*d
    for _ in range(100):
        a=(lo+hi)/2
        if 2*a*math.sinh(d/(2*a))>target:lo=a
        else:hi=a
    a=(lo+hi)/2;x0=d/2-a*math.atanh(rise/length)
    return {'d':d,'rise':rise,'length':length,'rho':rho,'a':a,'x0':x0,'H':rho*G*a,'left_y':1.5}

def chain_sample(p,x):return p['left_y']+p['a']*(math.cosh((x-p['x0'])/p['a'])-math.cosh(-p['x0']/p['a']))

def chain_piece(p,x1,x2):
    a,x0=p['a'],p['x0'];u1,u2=(x1-x0)/a,(x2-x0)/a
    length=a*(math.sinh(u2)-math.sinh(u1))
    # Integral x ds = a[x sinh(u)-a cosh(u)] between endpoints.
    cmx=a*((x2*math.sinh(u2)-a*math.cosh(u2))-(x1*math.sinh(u1)-a*math.cosh(u1)))/length
    return {'length':length,'cmx':cmx,'left':[-p['H'],-p['H']*math.sinh(u1)],'right':[p['H'],p['H']*math.sinh(u2)],'weight':p['rho']*G*length}

def hanging_chain():
    p=catenary_parameters();n=24;pts=[[p['d']*i/n,chain_sample(p,p['d']*i/n)] for i in range(n+1)]
    bodies=[rod(f'chain{i:02}',pts[i],pts[i+1],thickness=.035,label='chain' if i==12 else '') for i in range(n)]
    for key,pt in [('left',pts[0]),('right',pts[-1])]:
        bodies.extend([rod(key+'_wall',[pt[0]+(-.12 if key=='left' else .12),pt[1]-.5],[pt[0]+(-.12 if key=='left' else .12),pt[1]+.5],thickness=.10),
                       rod(key+'_hook',[pt[0]+(-.12 if key=='left' else .12),pt[1]],pt,thickness=.035)])
    idx=12;focus='chain12';A,B=pts[idx],pts[idx+1];mid=[(A[0]+B[0])/2,(A[1]+B[1])/2];q=chain_piece(p,A[0],B[0])
    forces=[force(focus,q['left'],'T left',[A[0]-mid[0],A[1]-mid[1]]),force(focus,q['right'],'T right',[B[0]-mid[0],B[1]-mid[1]]),force(focus,[0,-q['weight']],'weight',[q['cmx']-mid[0],0])]
    steps=[step('Unequal support heights','Static equilibrium: a flexible chain hangs from two wall hooks of unequal height. The lowest point is not midway between them.',show=['labels']),
           step('One short piece',r'Horizontal tension $H$ is constant. The vertical tension change equals the weight of this piece: $dT_y=\rho g\,ds$.',show=['forces','labels'],camera='closeup'),
           step('Shape and length',r'Write $a=H/(\rho g)$. Then $y=a\cosh((x-x_0)/a)+C$. The support distance $d$, rise $\lambda$, and length $\ell$ fix $2a\sinh(d/(2a))=\sqrt{\ell^2-\lambda^2}$.',show=['labels'])]
    scene=apparatus('Catenary — analytic equilibrium',bodies,focus,steps,forces=forces)
    return lesson('Hanging chain','Static catenary with unequal support heights. Illustrative separation 3 m, rise 0.6 m, length 4 m; all use one scale.',scene,steps,
        ['d = 3 m, λ = 0.6 m, ℓ = 4 m (illustrative)','uniform density 0.35 kg/m (illustrative)'],
        ['Exact catenary sampled by 24 short 3D chords; analytic endpoint tensions and continuum mass for the highlighted interval. No invented chain dynamics.'])

def block_on_plane():
    angle,m,L,mu=30.,2.,3.,1.2;th=math.radians(angle);w,h=L*math.cos(th),L*math.sin(th)
    bw,bh,s=.56,.40,1.45
    # Slope rises to the right, matching the printed FBD: normal left, friction right.
    cx=s*math.cos(th)-bh/2*math.sin(th);cy=s*math.sin(th)+bh/2*math.cos(th)
    steps=[step('Rest on a rough incline','The block remains at rest. Both surfaces use enough static friction; no friction force is added by hand.',show=['labels']),
           step('Resolve the weight',r'$f=mg\sin\theta$ up the plane and $N=mg\cos\theta$ perpendicular to it.',show=['forces','labels'],camera='closeup'),
           step('Horizontal components',r'$f_x=mg\sin\theta\cos\theta$ and $N_x=-mg\sin\theta\cos\theta$. They cancel. Their magnitudes peak at $\theta=45^\circ$, at $mg/2$.',show=['forces','labels'])]
    scene=apparatus('Resting block on an incline',[
        {'id':'ramp','type':'static','shape':'polygon','pos':[0,0],'points':[[0,0],[w,0],[w,h]],'friction':mu,'render':{'kind':'slab','prop':'ramp'}},
        {'id':'block','type':'dynamic','shape':'box','w':bw,'h':bh,'mass':m,'inertia':'plate','pos':[cx,cy],'angle_deg':angle,'friction':mu,'restitution':0,'label':'m','render':{'kind':'box','prop':'block'}}],
        'block',steps,duration=.6,checks=[v._chk('Remains at rest','speed',0,body='block',at=.4,tol=1)])
    return lesson('Block on a plane','A rough incline holds a block at rest. Illustrative 30° slope and 2 kg block; normal and friction come from the native contact solver.',scene,steps,
        ['θ = 30° and m = 2 kg (illustrative)','µ = 1.2, greater than tan θ; static equilibrium'],['The plane is fixed; the block has no external holding force.'])

def supporting_ladder():
    L,M,ell,th=3.,2.,.9,math.radians(55)
    s=ell/math.tan(th);P=[s*math.cos(th),s*math.sin(th)];C=[L/2*math.cos(th),L/2*math.sin(th)]
    Q=[P[0]+ell*math.sin(th),0];F=M*G*L*math.sin(th)/(2*ell)
    fv=[-F*math.sin(th),F*math.cos(th)];pivot=[-fv[0],M*G-fv[1]]
    b=rod('ladder',[0,0],[L*math.cos(th),L*math.sin(th)],thickness=.10,label='ladder',prop='ladder')
    bodies=[v._floor(-.2,max(Q[0],L*math.cos(th))+.25),b,rod('brace',P,Q,thickness=.045,label='massless stick'),
        {'id':'pinA','type':'static','shape':'circle','r':.055,'pos':[0,0],'render':{'kind':'disk'}},
        {'id':'pinB','type':'static','shape':'circle','r':.055,'pos':Q,'render':{'kind':'disk'}}]
    forces=[force('ladder',fv,'F stick',[P[0]-C[0],P[1]-C[1]]),force('ladder',pivot,'pivot',[-C[0],-C[1]]),force('ladder',[0,-M*G],'weight')]
    steps=[step('Two ground pivots','Static equilibrium: the short massless brace is perpendicular to the ladder. Both ground attachment points are visible.',show=['labels']),
           step('Torque about the ladder foot',r'The brace force points along the brace. Its lever arm is $s=\ell/\tan\theta$. Balance $Fs=Mg(L/2)\cos\theta$.',show=['forces','labels'],camera='closeup'),
           step('Brace force',r'$F=MgL\sin\theta/(2\ell)$. This is the brace force, not the ground pivot reaction; the two are different vectors.',show=['forces','labels'])]
    return lesson('Supporting a ladder','Static source-matched ladder and perpendicular massless brace. The exact prepared 3D ladder scene retains precedence on ordinary entry.',apparatus('Supported ladder — analytic equilibrium',bodies,'ladder',steps,forces=forces),steps,
        ['L = 3 m, M = 2 kg, ℓ = 0.9 m, θ = 55° (illustrative)'],['Ideal thin uniform ladder; massless two-force brace; analytic static force illustration.'])

def spool():
    R,r,M,mu=.5,.25,2.,.5;th=math.acos(r/R);limit=mu*M*G/(math.cos(th)+mu*math.sin(th));T=.65*limit
    tx,ty=T*math.cos(th),T*math.sin(th);offset=[r*math.sin(th),-r*math.cos(th)]
    contact=[offset[0],R+offset[1]];end=[contact[0]+.7*math.cos(th),contact[1]+.7*math.sin(th)]
    bodies=[v._floor(-.8,1.2,mu=mu),{'id':'spool','type':'static','shape':'circle','r':R,'pos':[0,R],'mass':M,'label':'spool','render':{'kind':'disk','prop':'spool','inner':r}}]
    forces=[force('spool',[tx,ty],'T',offset),force('spool',[-tx,0],'friction',[0,-R]),force('spool',[0,M*G-ty],'normal',[0,-R]),force('spool',[0,-M*G],'weight')]
    steps=[step('Static pulling geometry','The pull line passes through the ground contact point. Static equilibrium is possible with sufficient friction.',show=['labels']),
           step('Balance force and torque',r'$f=T\cos\theta$, $Tr=fR$, hence $\cos\theta=r/R$. Vertical balance gives $N=Mg-T\sin\theta$.',show=['forces','labels'],camera='closeup'),
           step('Static friction limit',r'$T_{\max}=\mu Mg/(\cos\theta+\mu\sin\theta)$. Its smallest possible value is $\mu Mg/\sqrt{1+\mu^2}$ at $r=R/\sqrt{1+\mu^2}$.',show=['forces','labels'])]
    sc=apparatus('Spool — analytic static balance',bodies,'spool',steps,forces=forces,strings=[{'id':'thread','via':[{'world':contact},{'world':end}],'tension':['T'],'labels':[]}])
    return lesson('The spool','Static spool balance below the slipping threshold. The source-matched prepared spool scene retains precedence, including its tension exploration.',sc,steps,
        ['R = 0.5 m, r = 0.25 m, M = 2 kg, µ = 0.5 (illustrative)','θ = arccos(r/R); T is 65% of its static limit'],['Analytic static force illustration; no claim that an arbitrary pull angle remains motionless.'])

BUILDERS={'2.1':hanging_rope,'2.2':block_on_plane,'2.8':hanging_chain,'2.15':supporting_ladder,'2.17':spool}
