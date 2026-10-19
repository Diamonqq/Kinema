"""Exact energy/momentum apparatus. Native contact runs, plus an honest 3D proof pose."""
from __future__ import annotations
import math
from . import visual_library_recipes as v
from .chapter_native_ch04 import G,step,lesson

def sphere_release_values(R=1.2,r=.035,theta0=.04,v0=.02):
    effective=R+r;c=(2*math.cos(theta0)+v0*v0/(G*effective))/3
    return {'R':R,'r':r,'effective':effective,'theta0':theta0,'v0':v0,'cos_leave':c,'angle':math.acos(c)}

def leaving_sphere():
    p=sphere_release_values();R,r,a,w=p['R'],p['r'],p['theta0'],p['v0'];re=R+r
    bodies=[{'id':'sphere','type':'static','shape':'circle','r':R,'pos':[0,R],'friction':0,'render':{'kind':'sphere'}},
            v._floor(-1.8,3.,y=0,mu=0),
            {'id':'slider','shape':'circle','r':r,'mass':.1,'inertia':'point','pos':[re*math.sin(a),R+re*math.cos(a)],
             'vel':[w*math.cos(a),-w*math.sin(a)],'friction':0,'restitution':0,'bullet':True,'label':'m','render':{'kind':'sphere','gauge_k':3.}}]
    steps=[step('A small sliding mass','The small mass receives a tiny tangent kick near the top. Both surfaces are frictionless: it slides without any rolling-energy term.',show=['labels']),
           step('Two equations for the same speed',r'Energy gives $v^2=2gR(1-\cos\theta)$ in the point-mass, tiny-kick limit. Radial balance is $mg\cos\theta-N=mv^2/R$.',show=['forces','labels'],camera='closeup'),
           step('Contact ends at zero normal force',r'Set $N=0$: $\cos\theta=2/3$, or about $48.2^\circ$. The native run uses the actual small display radius and stated kick; its independent contact check uses those finite values, then compares their limit with 2/3.',show=['velocity','trail','labels'])]
    sc=v._scene('Frictionless sliding off a sphere',steps,bodies=bodies,duration=2.1,focus='slider',gravity=G,camera='side')
    return lesson('Leaving the sphere','A small mass slides over a fixed frictionless sphere and then flies freely. Illustrative R=1.2 m, display mass radius 0.035 m, initial angle 0.04 rad and tangent kick 0.02 m/s.',sc,steps,r'\cos\theta_{\rm leave}=2/3',
        assumptions=['Frictionless sliding, not rolling. The native point-inertia body has no spin energy or tangential contact friction.','Finite display radius changes the center path to R+r. The stated small initial angle/kick are included in the independent leaving-angle expectation.'])

def shell_pair(R=1.2,P=(.45,.10,0.),direction=(.84,.22,0.),solid_angle=.003):
    norm=math.sqrt(sum(x*x for x in direction));u=[x/norm for x in direction];pu=sum(a*b for a,b in zip(P,u))
    root=math.sqrt(pu*pu+R*R-sum(x*x for x in P));a=root-pu;b=root+pu;cosine=root/R
    A=[P[i]+a*u[i] for i in range(3)];B=[P[i]-b*u[i] for i in range(3)]
    # For surface density sigma=1, patch masses are dA; G and test mass factor out.
    areaA=a*a*solid_angle/cosine;areaB=b*b*solid_angle/cosine
    return {'R':R,'P':list(P),'u':u,'a':a,'b':b,'A':A,'B':B,'cosine':cosine,'areaA':areaA,'areaB':areaB,'scaled_forceA':areaA/(a*a),'scaled_forceB':areaB/(b*b)}

def shell_cancellation():
    p=shell_pair();R=p['R'];P=p['P'];u=p['u'];a=p['a'];b=p['b']
    # Thin octagonal meridian outline, explicitly a section of the shell boundary.
    # Native ring primitives have fixed thick tubes; slim cylinders preserve visibility.
    parts=[]
    for i in range(8):
        a0=2*math.pi*i/8;a1=2*math.pi*(i+1)/8
        q0=[R*math.cos(a0),R*math.sin(a0),0.];q1=[R*math.cos(a1),R*math.sin(a1),0.]
        delta=[q1[j]-q0[j] for j in range(3)];length=math.sqrt(sum(z*z for z in delta))
        parts.append(v._part('shell_outline_'+str(i),'cylinder',1e-5,[(q0[j]+q1[j])/2 for j in range(3)],axis=[z/length for z in delta],radius=.006,length=length,color='steel'))
    parts += [v._part('coneA','cone',1e-6,p['A'],axis=[-x for x in u],radius=a*.075,length=a,color='blue'),
              v._part('coneB','cone',1e-6,p['B'],axis=u,radius=b*.075,length=b,color='sand'),
              v._part('P','sphere',1.,P,radius=.035,color='blue')]
    refs=[{'kind':'origin','label':name,'point':point,'direction':None,'frame':'body','length':None} for name,point in [('P',P),('A',p['A']),('B',p['B'])]]
    refs += [{'kind':'coordinate','label':'equal F_A','point':P,'direction':u,'frame':'body','length':.45},
             {'kind':'coordinate','label':'equal F_B','point':P,'direction':[-x for x in u],'frame':'body','length':.45}]
    steps=[step('Pair opposite thin cones','P is inside the spherical shell, away from its center. A slim polygonal meridian marks a section of the spherical shell. Both opposite cones meet at P.',show=['labels']),
           step('The same obliquity factor',r'The chord meets the sphere at equal angles at its two ends. For equal solid angle $d\Omega$, $dA_A=a^2d\Omega/\cos\eta$ and $dA_B=b^2d\Omega/\cos\eta$. Hence $dA_A/dA_B=a^2/b^2$.',show=['references','labels'],camera='closeup'),
           step('Area growth cancels inverse square',r'For uniform surface density, $dF_A=Gm\sigma\,dA_A/a^2$ and $dF_B=Gm\sigma\,dA_B/b^2$. They are equal and opposite. Pairing all directions gives zero total field everywhere inside.',show=['references','labels'])]
    sc=v._r3('Paired thin cones inside a spherical shell',parts,[0,0,1],v._motion('static',pivot=P,support='none'),duration=0.,show=['labels'],references=refs,gravity=0)
    sc['motion']['pivot_world']=P
    return lesson('Zero force inside a sphere','Static 3D proof geometry: opposite thin cones from an off-center point meet a spherical shell. The thin polygon marks a meridian section of the shell; it is not a ring mass distribution.',sc,steps,r'dA_A/a^2=dA_B/b^2\;\Rightarrow\;d\mathbf F_A+d\mathbf F_B=0',kind='rigid3d',
        assumptions=['Analytic shell-theorem illustration, not a native gravitational-field solver. Cone and meridian part masses are display bookkeeping and do not supply the gravitational force.','Equal arrows are authored teaching references, not native force measurements. The area, distance and obliquity cancellation is independently checked numerically.','Thin cones are infinitesimal: their drawn opening is enlarged for visibility.'])

def snowball_values(m=.2,M=20.,speed=4.):
    vf=m*speed/(M+m);K0=.5*m*speed*speed;Kf=.5*(M+m)*vf*vf
    return {'m':m,'M':M,'speed':speed,'vf':vf,'momentum':m*speed,'K0':K0,'Kf':Kf,'internal':K0-Kf}

def snowball():
    p=snowball_values()
    bodies=[v._floor(-1.3,1.,y=0,mu=0),
            {'id':'earth_wall','shape':'box','w':.28,'h':1.4,'mass':p['M'],'inertia':'plate','pos':[0,.7],'friction':0,'restitution':0,'label':'wall + Earth','render':{'kind':'box'}},
            {'id':'snow','shape':'circle','r':.09,'mass':p['m'],'inertia':'point','pos':[-1.,.7],'vel':[p['speed'],0],'friction':0,'restitution':0,'bullet':True,'label':'snowball','render':{'kind':'sphere'}}]
    joints=[{'id':bid+'_rail','type':'slider','a':'world','b':bid,'anchor':[0,.7],'axis':[1,0]} for bid in ('earth_wall','snow')]
    steps=[step('Include the Earth in the system','The wall and Earth form the heavy target. The demonstration uses an exaggerated finite target mass so its small recoil can be measured; actual Earth recoil is far smaller.',show=['labels']),
           step('Momentum is transferred',r'For a central inelastic impact, $V=mv/(M+m)$. The target receives nearly all the initial momentum when $M\gg m$. The native target is free horizontally; it is not falsely pinned while claiming momentum conservation.',show=['velocity','labels'],camera='closeup'),
           step('Where kinetic energy goes',r'$K_f/K_i=m/(M+m)$. Nearly all initial kinetic energy becomes internal energy: deformation, heating and melting, with sound also possible. The contact model dissipates this energy; it does not simulate temperature or melting.',show=['energy','labels'])]
    sc=v._scene('Snowball transfers momentum to a heavy target',steps,bodies=bodies,joints=joints,duration=1.35,focus='snow',gravity=G,camera='side')
    return lesson('Snowball','A perfectly inelastic central impact on a heavy wall/Earth surrogate. Illustrative snowball 0.2 kg, target 20 kg, incoming speed 4 m/s; native contact transfers momentum and dissipates kinetic energy.',sc,steps,r'V=mv/(M+m),\quad K_f/K_i=m/(M+m)',
        assumptions=['The finite mass ratio is 100 for visible/measurable recoil, not the real mass of the Earth. Horizontal external force is zero; rails carry only vertical support.','Rigid zero-restitution contact models inelastic kinetic-energy loss, not snow deformation, heat flow or melting. No claim that a static wall absorbs momentum without its Earth support.'])

def billiards():
    raw=v.billiard_right_angle();raw['title']='Right angle in billiards'
    raw['visualization']['caption']='Native elastic, frictionless collision of equal balls, one initially at rest. The 30 degree line-of-centers example illustrates the general vector proof.'
    raw['steps'].append(step('The degenerate limits',r'The dot-product conclusion is $\mathbf v_1\cdot\mathbf v_2=0$. A 90 degree angle is defined only when both speeds are nonzero; a head-on hit stops the incoming ball, while a miss leaves the other stationary.',show=['velocity','trail','labels'],camera='top'))
    return raw

def ball_stack():
    h,R,r,gap=.6,.22,.07,.002;m1,m2=1.,.001
    bodies=[v._floor(-.65,.65,y=0,mu=0),
            {'id':'basketball','shape':'circle','r':R,'mass':m1,'inertia':'point','pos':[0,h+R],'friction':0,'restitution':1,'bullet':True,'label':'basketball','render':{'kind':'sphere'}},
            {'id':'tennis','shape':'circle','r':r,'mass':m2,'inertia':'point','pos':[0,h+2*R+gap+r],'friction':0,'restitution':1,'bullet':True,'label':'tennis ball','render':{'kind':'sphere'}}]
    steps=[step('A light ball above a heavy ball','Both balls start from rest with a small gap. The native fallback demonstrates part (a) with finite mass ratio 1000; ordinary entry retains the existing same-ID prepared scene.',show=['labels']),
           step('Two elastic impacts',r'Just before the floor bounce, both speeds approach $v=\sqrt{2gh}$. After the heavy ball rebounds, the light ball approaches at relative speed about 2v and leaves with upward speed about 3v.',show=['velocity','labels'],camera='closeup'),
           step('The ideal stack result',r'In the successive large-mass-ratio limit, $v_n=(2^n-1)v$ and $H=\ell+(2^n-1)^2h$. Thus six balls exceed 1 km from h=1 m; twelve reach the ideal Earth escape-speed threshold. This two-ball native fallback does not animate that n-ball extrapolation.',show=['energy','labels'])]
    sc=v._scene('Heavy and light ball elastic bounce',steps,bodies=bodies,duration=1.6,focus='tennis',gravity=G,camera='side')
    return lesson('Basketball and tennis ball','Two real native elastic contacts: the heavy ball with the floor, then the light ball with the heavy ball. Existing exact Daily scene keeps precedence; this is the finite-ratio two-ball fallback.',sc,steps,r'H=d+9h;\quad H_n=\ell+(2^n-1)^2h',
        assumptions=['Native finite-radius, finite-gap, mass-ratio-1000 demonstration of part (a). Source instantaneous, infinite-ratio formula is its limiting comparison, not asserted exact for this run.','Part (b) is explained analytically; no n-ball dynamical run, atmospheric flight or real escape trajectory is claimed.'])

BUILDERS={'5.3':leaving_sphere,'5.10':shell_cancellation,'5.14':snowball,'5.19':billiards,'5.23':ball_stack}
