"""Independently authored chapter practice. No textbook statements are used here.

Reference slots preserve familiar chapter navigation, not the original setups or
difficulty. Variants are identified by a common family; they are not represented
as 635 distinct physical models. Exact book questions belong to the local import.
"""
from __future__ import annotations
import copy
from functools import lru_cache
import hashlib
import json
import math

# (original chapter numbering slots, first exercise); bibliographic index only.
SLOTS = ((18,8),(38,20),(71,25),(35,13),(96,32),(47,25),(21,8),
         (77,26),(57,31),(32,16),(68,29),(40,20),(11,5),(24,12))
G = 9.81


def _case(title, question, hint, equation, reason, answer, unit='', **facts):
    return {'title':title,'statement_md':question,'hint':hint,'equation':equation,
            'reason':reason,'answer':float(answer),'unit':unit,'facts':facts}


def _families(ch, v):
    # Every repeated family has a distinct, reproducible parameter variant.
    a, b = 2 + v, 3 + v
    m, k, t, u = float(a), float(18+3*v), float(1+v/5), float(4+v)
    beta = .20 + .015*v
    gamma = 1/math.sqrt(1-beta**2)
    if ch == 1:
        return [
            _case('A useful clock scale',rf'A hanging instrument has length $L={a}$ m in gravity $g={G}$ m/s². Assume its time scale is $τ=C L^p g^q$. Find $p,q$ from dimensions, then evaluate the scale $τ/C$.','Match the powers of length and time independently.',r'p=\tfrac12,\quad q=-\tfrac12,\quad \tau/C=\sqrt{L/g}', 'Length contributes L; gravity contributes L/T². A time must have one power of T and no residual length.',math.sqrt(a/G),'s',L=a,g=G),
            _case('A small change in area',rf'A circular sensor expands from radius $R={a}$ cm to $R+δ R$, with $δ R/R={b/1000:.3f}$. Find the first-order fractional area increase.','Differentiate the area before inserting the small ratio.',r'\delta A/A\simeq 2\delta R/R','The exact ratio is (1+ε)²−1=2ε+ε²; first order drops the squared term.',2*b/1000,'',epsilon=b/1000),
            _case('One Euler step',rf'A velocity follows $\dot v=-λ v$ with $λ={a/10:.1f}$ s⁻¹ and $v(0)={u}$ m/s. Use one explicit Euler step of $h=0.02$ s. What is the approximate new velocity?','Use the derivative at the beginning of the step.',r'v_1=v_0+h(-\lambda v_0)=v_0(1-\lambda h)','Euler adds the current slope times the step; it is a numerical approximation, not the exact exponential.',u*(1-a*.1*.02),'m/s',rate=a*.1,v0=u,h=.02),
            _case('Checking a square-root estimate',rf'Approximate $\sqrt{{1+ε}}$ to first order for $ε={a/100:.2f}$. What is the approximation?','Expand about ε=0.',r'\sqrt{1+\epsilon}\simeq1+\epsilon/2','The derivative of the square root at 1 is 1/2; the neglected leading correction is −ε²/8.',1+a/200,'',epsilon=a/100),
            _case('Uncertainty in a pendulum clock',rf'A time scale obeys $T=C\sqrt{{L/g}}$. The length has a small fractional uncertainty of ${a}$%, while $g$ and $C$ are exact. What is the first-order fractional uncertainty of $T$ in percent?','Use a logarithmic derivative.',r'|\delta T|/T\simeq\tfrac12|\delta L|/L','The exponent 1/2 halves the fractional length uncertainty.',a/2,'%',percent=a),
            _case('Reading a terminal-speed scale',rf'A resistive force has magnitude $bv$, where $b={a}$ kg/s. A ${b}$ kg object moves downward in gravity. Find the speed at which this force balances its weight.','Check both the force balance and the dimensions of b.',r'bv_*=mg,\qquad v_*=mg/b','The balancing speed has units (kg·m/s²)/(kg/s)=m/s.',b*G/a,'m/s',mass=b,drag=a,g=G),
            _case('An exact relaxation check',rf'A temperature difference obeys $\dot x=-x/τ$, with $x(0)={a}$ K and $τ={b}$ s. Find $x$ at $t={b}$ s.','Separate variables and check the initial value.',r'x(t)=x_0e^{-t/\tau},\qquad x(\tau)=x_0/e','The negative sign makes the difference decay; one time constant leaves 1/e of the starting value.',a/math.e,'K',x0=a,tau=b),
            _case('Choosing dimensionless variables',rf'A spring obeys $m\ddot x+kx=0$, with $m={m}$ kg and $k={k}$ N/m. Let $s=t/t_0$. Choose $t_0$ so the equation becomes $d^2x/ds^2+x=0$.','Each time derivative supplies a factor 1/t₀.',r'mx_{ss}/t_0^2+kx=0,\qquad t_0=\sqrt{m/k}','Set the two coefficients equal; this t₀ is the inverse angular frequency, not the full period.',math.sqrt(m/k),'s',m=m,k=k),
        ]
    if ch == 2:
        angle=25+v
        rad=math.radians(angle)
        return [
            _case('Two cables above a sign',rf'A ${m}$ kg sign is supported by two identical cables, each ${angle}$° above horizontal. Find the tension in either cable.','The horizontal components cancel; add the vertical components.',r'2T\sin\theta=mg,\qquad T=\frac{mg}{2\sin\theta}','Both cables lift the sign; neither cable alone carries the entire vertical load.',m*G/(2*math.sin(rad)),'N',m=m,g=G,theta=rad),
            _case('A light display shelf',rf'A massless horizontal shelf of length $L={a}$ m is hinged on its left. A ${b}$ kg load rests at $L/3$. A vertical cable at the right holds the shelf. Find the cable tension.','Take torques about the hinge.',r'TL=mgL/3,\qquad T=mg/3','The hinge force has no moment about the hinge; the load lever arm is one third of the cable lever arm.',b*G/3,'N',m=b,g=G,L=a),
            _case('Grip on a quiet incline',rf'A block rests on a plane at ${angle}$°. There are no other applied forces. What is the minimum coefficient of static friction that can hold it?','Find the needed friction and compare it with μₛN.',r'f=mg\sin\theta,\quad N=mg\cos\theta,\quad\mu_{s,\min}=\tan\theta','The mass cancels because both the required friction and the normal force scale with weight.',math.tan(rad),'',theta=rad),
            _case('Balancing a horizontal mobile',rf'A weight of ${a}$ N hangs ${b}$ cm left of a pivot. A second weight hangs ${a+1}$ cm right. What right-hand weight makes the net torque zero?','Opposite torque magnitudes must agree.',r'W_Ld_L=W_Rd_R,\qquad W_R=W_Ld_L/d_R','Both distances may be in centimeters because they appear as a ratio.',a*b/(a+1),'N',W=a,dL=b,dR=a+1),
            _case('A crane cable at an angle',rf'A uniform horizontal boom of weight ${20*a}$ N and length ${b}$ m is hinged at one end. A cable attached at its far end makes ${angle}$° above the boom. Find its tension.','The boom weight acts at its midpoint; only the cable vertical component makes torque.',r'TL\sin\theta=W L/2,\qquad T=W/(2\sin\theta)','The horizontal component passes along the boom and makes no torque about the hinge.',20*a/(2*math.sin(rad)),'N',W=20*a,theta=rad,L=b),
            _case('Three forces at one ring',rf'A small ring has forces $\mathbf F_1=({a},{b})$ N and $\mathbf F_2=(-{b},{a})$ N. Find the magnitude of the third force needed for equilibrium.','First cancel the vector sum component by component.',r'\mathbf F_3=-\mathbf F_1-\mathbf F_2,\qquad |\mathbf F_3|=\sqrt{(b-a)^2+(a+b)^2}','Equilibrium means zero resultant, not equal magnitudes of all three forces.',math.hypot(b-a,a+b),'N',a=a,b=b),
            _case('A hand on a uniform beam',rf'A uniform beam of length ${b}$ m and weight ${10*a}$ N is pinned at its left end. A hand pushes straight up at one quarter of its length. Find the force needed to hold it horizontal.','Compare the hand lever arm with the center-of-mass lever arm.',r'F(L/4)=W(L/2),\qquad F=2W','The short hand lever arm requires a force larger than the weight; the hinge supplies the remaining force balance.',20*a,'N',W=10*a,L=b),
            _case('A tilted pulling force',rf'A ${m}$ kg crate remains at rest on a rough horizontal floor while a rope pulls with ${5*a}$ N at ${angle}$° above horizontal. Find the normal force.','The rope lifts part of the weight.',r'N+T\sin\theta-mg=0,\qquad N=mg-T\sin\theta','The normal force follows vertical equilibrium and must remain positive; these givens keep contact.',m*G-5*a*math.sin(rad),'N',m=m,g=G,T=5*a,theta=rad),
        ]
    if ch == 3:
        angle=20+v
        theta=math.radians(angle)
        mu=.08+.003*v
        return [
            _case('A sensor sled on a ramp',rf'A sled slides down a straight ${angle}$° ramp. The kinetic friction coefficient is ${mu:.3f}$. Find its acceleration along the ramp. Use $g={G}$ m/s².','Choose downhill positive; friction acts uphill.',r'a=g(\sin\theta-\mu_k\cos\theta)','Resolve gravity parallel and perpendicular to the ramp before substituting the friction law.',G*(math.sin(theta)-mu*math.cos(theta)),'m/s²',theta=theta,mu=mu,g=G),
            _case('A droplet with linear drag',rf'A ${m}$ kg test body is released from rest downward. The drag coefficient is ${b}$ kg/s. Find its downward speed after ${t}$ s, assuming linear drag and constant gravity.','Write m dv/dt=mg−bv and apply v(0)=0.',r'v(t)=\frac{mg}{b}(1-e^{-bt/m})','The speed starts at zero and approaches mg/b without crossing it.',m*G/b*(1-math.exp(-b*t/m)),'m/s',m=m,b=b,t=t,g=G),
            _case('Stopping on a rough floor',rf'A puck starts at ${u}$ m/s on a horizontal surface with kinetic friction coefficient ${mu:.3f}$. How far does it travel before stopping?','The acceleration is constant and opposite the velocity.',r'0=u^2-2\mu_k g d,\qquad d=u^2/(2\mu_k g)','Use the constant-acceleration relation only until the puck reaches zero speed.',u*u/(2*mu*G),'m',u=u,mu=mu,g=G),
            _case('A smooth banked bend',rf'A frictionless banked track has radius ${20*a}$ m and bank angle ${angle}$°. Find the speed at which a vehicle needs no friction.','The normal force supplies both vertical support and horizontal centripetal force.',r'N\cos\theta=mg,\quad N\sin\theta=mv^2/R,\quad v=\sqrt{Rg\tan\theta}','Divide the horizontal balance by the vertical balance to eliminate N.',math.sqrt(20*a*G*math.tan(theta)),'m/s',R=20*a,theta=theta,g=G),
            _case('A steadily increasing push',rf'A ${m}$ kg cart starts from rest. A horizontal force $F(t)=At$ acts for ${t}$ s, with $A={b}$ N/s. Find its final speed. Ignore resistance.','Acceleration is time dependent; integrate rather than using one final force for the whole interval.',r'v(t)=\int_0^t\frac{At\prime}{m}\,dt\prime=\frac{At^2}{2m}','The mean force during the interval is half the final force.',b*t*t/(2*m),'m/s',m=m,A=b,t=t),
            _case('A scale in an accelerating lift',rf'A ${10*a}$ kg passenger stands on a scale in a lift accelerating upward at ${a/5:.1f}$ m/s². What force does the scale read?','The scale reads the normal force, not mg alone.',r'N-mg=ma,\qquad N=m(g+a)','Upward acceleration requires the supporting force to exceed weight.',10*a*(G+a/5),'N',m=10*a,acc=a/5,g=G),
            _case('Two carts pulled together',rf'Carts of masses ${a}$ kg and ${b}$ kg are connected by a light horizontal cord on a frictionless track. A force of ${6*a}$ N pulls the ${b}$ kg cart. Find the cord tension.','Find the common acceleration from the two-cart system, then isolate the unpulled cart.',r'a=F/(m_1+m_2),\qquad T=m_1a','The internal cord force cancels for the whole system but accelerates the first cart.',a*6*a/(a+b),'N',m1=a,m2=b,F=6*a),
            _case('Speed on a vertical loop',rf'A small bead travels inside a smooth vertical circle of radius ${a}$ m. At the top its speed is ${u+12}$ m/s. Find the inward normal force per unit bead mass there.','At the top, gravity and the inward normal point toward the center.',r'N+mg=mv^2/R,\qquad N/m=v^2/R-g','A positive value means the chosen speed is enough to maintain the stated contact.',(u+12)**2/a-G,'N/kg',v=u+12,R=a,g=G),
        ]
    if ch == 4:
        omega=math.sqrt(k/m)
        return [
            _case('A quiet spring clock',rf'A ${m}$ kg glider is attached to a spring of stiffness ${k}$ N/m. Find its small-oscillation period on a frictionless track.','The restoring force is −kx.',r'\omega=\sqrt{k/m},\qquad T=2\pi\sqrt{m/k}','The period is 2π divided by angular frequency.',2*math.pi/omega,'s',m=m,k=k),
            _case('A kick at equilibrium',rf'A ${m}$ kg spring oscillator with stiffness ${k}$ N/m receives speed ${u}$ m/s while at equilibrium. Find the subsequent amplitude.','Compare kinetic energy at equilibrium with spring energy at a turning point.',r'\tfrac12mu^2=\tfrac12kA^2,\qquad A=u\sqrt{m/k}','No energy is lost in the stated ideal oscillator.',u/omega,'m',m=m,k=k,u=u),
            _case('When the envelope halves',rf'An underdamped oscillator has amplitude envelope $A(t)=A_0e^{{-γt}}$, with $γ={a/20:.2f}$ s⁻¹. When does the envelope reach half its initial value?','Apply the condition to the envelope, not to an instantaneous zero crossing.',r'e^{-\gamma t}=1/2,\qquad t=\ln2/\gamma','The envelope changes slowly even while the displacement crosses zero every half-cycle.',math.log(2)/(a/20),'s',decay=a/20),
            _case('Two springs beside each other',rf'A ${m}$ kg platform is attached to two parallel springs of stiffness ${k}$ and ${k+9}$ N/m. Find the angular frequency along their common direction.','Both springs have the same displacement and their restoring forces add.',r'k_{\rm eff}=k_1+k_2,\qquad\omega=\sqrt{(k_1+k_2)/m}','Parallel springs stiffen the support.',math.sqrt((2*k+9)/m),'rad/s',m=m,k1=k,k2=k+9),
            _case('Two springs end to end',rf'Two massless springs of stiffness ${k}$ and ${2*k}$ N/m are in series and hold a ${m}$ kg mass. Find the angular frequency. Ignore gravity shifts of equilibrium.','The same force stretches both springs; the extensions add.',r'k_{\rm eff}=\frac{k_1k_2}{k_1+k_2},\qquad\omega=\sqrt{k_{\rm eff}/m}','Series springs are softer than either individual spring.',math.sqrt((2*k/3)/m),'rad/s',m=m,k1=k,k2=2*k),
            _case('A vertical spring at rest',rf'A spring of stiffness ${k}$ N/m supports a ${m}$ kg mass vertically. Find its static extension from the unstretched length.','Set the net force to zero at equilibrium.',r'kx_0=mg,\qquad x_0=mg/k','Gravity shifts the equilibrium; subsequent small oscillations about it still have ω²=k/m.',m*G/k,'m',m=m,k=k,g=G),
            _case('A position one quarter-cycle later',rf'An oscillator has $x(t)=A\cos(ωt)$ with $A={a/10:.1f}$ m and $ω={b}$ rad/s. Find its velocity at $t=\pi/(2ω)$.','Differentiate x before evaluating the phase.',r'v=-A\omega\sin(\omega t),\qquad v(\pi/(2\omega))=-A\omega','The glider crosses equilibrium toward negative x at this phase.',-a*b/10,'m/s',A=a/10,omega=b),
            _case('A driven spring away from resonance',rf'A mass ${m}$ kg on a spring of stiffness ${k}$ N/m feels $F_0\cos(Ωt)$ with $F_0={a}$ N and $Ω=\tfrac12\sqrt{{k/m}}$. With no damping, find the amplitude of the steady particular solution.','Try a cosine at the driving frequency; do not include the freely chosen transient.',r'A=\frac{F_0}{|k-m\Omega^2|}=\frac{4F_0}{3k}','The driving frequency is below resonance, so the displacement is in phase with the force.',4*a/(3*k),'m',F=a,k=k,m=m,drive=omega/2),
        ]
    if ch == 5:
        return [
            _case('A launch powered by a spring',rf'A spring of stiffness ${k}$ N/m is compressed ${a/10:.1f}$ m and launches a ${m}$ kg cart horizontally. Find its speed when the spring reaches its natural length. Ignore all losses.','The initial spring energy becomes cart kinetic energy.',r'\tfrac12kx_0^2=\tfrac12mv^2,\qquad v=x_0\sqrt{k/m}','Use the initial compression, not the final zero compression, for the available energy.',a/10*math.sqrt(k/m),'m/s',k=k,m=m,x=a/10),
            _case('Work from a rising force',rf'A one-dimensional force is $F(x)=Ax$, where $A={b}$ N/m. A cart moves from $x=0$ to $x={a}$ m. Find the work done by this force.','Work is the area under F(x).',r'W=\int_0^L Ax\,dx=\tfrac12AL^2','Using the final force times the full distance would double the work.',b*a*a/2,'J',A=b,L=a),
            _case('Finding the stable well',rf'A particle has potential $U(x)=C(x^2-d^2)^2$, with $C={a}$ J/m⁴ and $d={b}$ m. Find the curvature $U\prime\prime$ at the equilibrium $x=d$.','Differentiate twice, then evaluate at d.',r'U\prime=4Cx(x^2-d^2),\qquad U\prime\prime(d)=8Cd^2','The positive curvature confirms that x=d is a stable equilibrium.',8*a*b*b,'J/m²',C=a,d=b),
            _case('An elastic bumper',rf'A cart of mass ${a}$ kg moving at ${u}$ m/s collides elastically in one dimension with a stationary cart of mass ${b}$ kg. Find the struck cart velocity afterward.','Use momentum conservation together with kinetic-energy conservation.',r'v_2=\frac{2m_1}{m_1+m_2}u','The stationary cart leaves in the incoming direction; both conservation laws are needed.',2*a*u/(a+b),'m/s',m1=a,m2=b,u=u),
            _case('A pair of carts that latch',rf'A ${a}$ kg cart at ${u}$ m/s sticks to a stationary ${b}$ kg cart. Find the kinetic energy lost.','Momentum is conserved; kinetic energy is not.',r'v=\frac{m_1u}{m_1+m_2},\quad\Delta K=\frac12\frac{m_1m_2}{m_1+m_2}u^2','The missing kinetic energy goes into deformation and internal energy.',a*b*u*u/(2*(a+b)),'J',m1=a,m2=b,u=u),
            _case('A two-piece separation',rf'A device initially at rest separates into pieces of ${a}$ and ${b}$ kg. The ${a}$ kg piece moves right at ${u}$ m/s. Find the signed velocity of the other piece, taking right as positive.','The initial total momentum is zero.',r'm_1u+m_2v_2=0,\qquad v_2=-m_1u/m_2','The minus sign records motion opposite to the first piece.',-a*u/b,'m/s',m1=a,m2=b,u=u),
            _case('Following the center of mass',rf'Two masses ${a}$ and ${b}$ kg lie at $x=0$ and $x={a+2}$ m. Find the center-of-mass coordinate.','Weight positions by their masses.',r'x_{\rm cm}=\frac{m_1x_1+m_2x_2}{m_1+m_2}','The result lies between the two positions and is closer to the heavier mass.',b*(a+2)/(a+b),'m',m1=a,m2=b,L=a+2),
            _case('Coasting upward',rf'A cart starts up a smooth ramp with speed ${u}$ m/s. What maximum vertical height does it gain before stopping?','The ramp angle affects distance along the ramp, not the energy needed for a given height.',r'\tfrac12mu^2=mgh,\qquad h=u^2/(2g)','Mass cancels; all initial kinetic energy becomes gravitational potential energy.',u*u/(2*G),'m',u=u,g=G),
        ]
    if ch == 6:
        R=a/2
        w=4+v/4
        return [
            _case('A generalized coordinate on a ramp',rf'A ${m}$ kg bead moves down a smooth ramp at ${25+v}$°. Use distance $q$ downhill as the coordinate and derive its acceleration from $L=\tfrac12m\dot q^2+mgq\sinθ$.','Apply the Euler–Lagrange equation directly to q.',r'\frac{d}{dt}(m\dot q)-mg\sin\theta=0,\qquad\ddot q=g\sin\theta','The positive potential contribution to L reflects a decreasing gravitational potential downhill.',G*math.sin(math.radians(25+v)),'m/s²',theta=math.radians(25+v),g=G),
            _case('A pendulum near its bottom',rf'A pendulum has length ${R}$ m. From $L=\tfrac12m\ell^2\dotθ^2+mg\ell\cosθ$, find the small-angle angular frequency.','Differentiate with respect to θ and θ-dot before linearizing.',r'\ddot\theta+(g/\ell)\sin\theta=0,\qquad\omega_0=\sqrt{g/\ell}','The approximation sinθ≈θ is applied after deriving the nonlinear equation.',math.sqrt(G/R),'rad/s',L=R,g=G),
            _case('A cyclic polar angle',rf'A ${m}$ kg particle moves in a central potential. At one moment $r={R}$ m and $\dotφ={w}$ rad/s. Find the conserved momentum conjugate to $φ$.','The potential is independent of φ, so ∂L/∂φ=0.',r'p_\phi=\frac{\partial L}{\partial\dot\phi}=mr^2\dot\phi','The conserved conjugate momentum is angular momentum about the center.',m*R*R*w,'kg·m²/s',m=m,R=R,w=w),
            _case('A cart with one stretching coordinate',rf'Two rigidly connected carts of masses ${a}$ and ${b}$ kg move together on a frictionless track. A spring of stiffness ${k}$ N/m acts along their shared coordinate $q$. Find the oscillation angular frequency from their Lagrangian.','Both carts have speed q-dot, so both masses contribute to the kinetic term.',r'L=\tfrac12(m_1+m_2)\dot q^2-\tfrac12kq^2,\qquad\omega=\sqrt{k/(m_1+m_2)}','The effective mass is the sum because the constraint makes both velocities identical.',math.sqrt(k/(a+b)),'rad/s',m1=a,m2=b,k=k),
            _case('A rotating hoop equilibrium',rf'A bead slides on a vertical circular hoop of radius ${R}$ m. The hoop rotates about its vertical diameter at ${w}$ rad/s. Let $θ$ be measured from the downward vertical. Find the non-bottom equilibrium angle in degrees. Use $ω^2R>g$.','Set θ-dot and θ-double-dot to zero after deriving the θ equation.',r'\ddot\theta=\sin\theta(\omega^2\cos\theta-g/R),\qquad\cos\theta=g/(R\omega^2)','The bottom is another stationary point; the requested off-bottom branch exists under the stated inequality.',math.degrees(math.acos(G/(R*w*w))),'°',R=R,w=w,g=G),
            _case('A prescribed circular guide',rf'A ${m}$ kg bead moves on a horizontal circle of fixed radius ${R}$ m. Its only tangential potential is $U(φ)=Kφ^2/2$, where $K={k}$ J/rad². Find the small-oscillation angular frequency in $φ$.','The kinetic coefficient of φ-dot squared is mR².',r'mR^2\ddot\phi+K\phi=0,\qquad\omega=\sqrt{K/(mR^2)}','Use the rotational kinetic coefficient; K is an angular stiffness rather than a linear spring stiffness.',math.sqrt(k/(m*R*R)),'rad/s',m=m,R=R,K=k),
            _case('The conserved energy function',rf'A coordinate has $L=A\dot q^2/2-Bq^4$, where $A={a}$ kg and $B={b}$ J/m⁴. At $q={a/10:.1f}$ m and $\dot q={u}$ m/s, find $E=\dot q\,\partial L/\partial\dot q-L$.','Substitute the derivative A q-dot into the definition.',r'E=\tfrac12A\dot q^2+Bq^4','Because the Lagrangian has no explicit time dependence, this energy function is conserved along solutions.',a*u*u/2+b*(a/10)**4,'J',A=a,B=b,q=a/10,u=u),
            _case('A coordinate with a curved height',rf'A ${m}$ kg bead slides without friction on a vertical guide $y=αx^2$, with $α={a/10:.1f}$ m⁻¹. Find the small-oscillation angular frequency near $x=0$.','Near the bottom, y-dot contributes only higher-order terms to the kinetic energy.',r'L\simeq\tfrac12m\dot x^2-mg\alpha x^2,\qquad\omega=\sqrt{2g\alpha}','This is a small-amplitude result; the full kinetic coefficient is m(1+4α²x²).',math.sqrt(2*G*a/10),'rad/s',alpha=a/10,g=G),
        ]
    if ch == 7:
        mu=100+10*v
        r=5+v
        eccentricity=.1+.02*v
        return [
            _case('A circular orbit in scaled units',rf'An inverse-square gravitational field has parameter $μ={mu}$ m³/s². Find the circular speed at radius ${r}$ m.','Set the inward acceleration equal to v²/r.',r'v^2/r=\mu/r^2,\qquad v=\sqrt{\mu/r}','The orbiting mass cancels from the equation of motion.',math.sqrt(mu/r),'m/s',mu=mu,r=r),
            _case('The orbital energy scale',rf'A bound Kepler orbit has semimajor axis ${r}$ m and gravitational parameter $μ={mu}$ m³/s². Find its mechanical energy per unit orbiting mass.','A Kepler orbit energy depends on semimajor axis, not on the current orbital position.',r'\epsilon=-\mu/(2a)','The negative sign distinguishes a bound orbit from escape.',-mu/(2*r),'J/kg',mu=mu,a=r),
            _case('Reading an ellipse from its extremes',rf'An orbit has nearest radius ${r}$ m and farthest radius ${2*r+1}$ m. Find its eccentricity.','Use rₚ=a(1−e) and rₐ=a(1+e).',r'e=(r_a-r_p)/(r_a+r_p)','Subtract and add the two radius equations to eliminate the semimajor axis.',(r+1)/(3*r+1),'',rp=r,ra=2*r+1),
            _case('Escape from a central field',rf'A body starts at radius ${r}$ m in a field with $μ={mu}$ m³/s². Find its minimum escape speed when it coasts to infinity with zero final speed.','Set the total specific energy to zero.',r'\tfrac12v_e^2-\mu/r=0,\qquad v_e=\sqrt{2\mu/r}','The zero of gravitational potential is chosen at infinity.',math.sqrt(2*mu/r),'m/s',mu=mu,r=r),
            _case('Area swept by a radius vector',rf'A particle has specific angular momentum $h={a}$ m²/s in a central force field. What area does its radius vector sweep in ${t}$ s?','Central forces exert zero torque about their center.',r'\frac{dA}{dt}=h/2,\qquad\Delta A=h\Delta t/2','The areal speed is constant even when the ordinary speed changes.',a*t/2,'m²',h=a,t=t),
            _case('A periapsis from the orbit equation',rf'An orbit is $r=p/(1+e\cosφ)$, with $p={r}$ m and $e={eccentricity:.2f}$. Find the minimum radius.','The radius is smallest when the denominator is largest.',r'r_{\min}=p/(1+e)','For e≥0, the maximum denominator occurs at φ=0.',r/(1+eccentricity),'m',p=r,e=eccentricity),
            _case('Kepler period scaling',rf'Two small satellites orbit the same central body. The first period is ${b}$ s; the second orbit semimajor axis is ${a}$ times the first. Find the second period.','For a fixed central body, T² is proportional to a³.',r'T_2=T_1(a_2/a_1)^{3/2}','This relation applies to ellipses as well as circles.',b*a**1.5,'s',T1=b,ratio=a),
            _case('A central harmonic attraction',rf'A particle of mass ${m}$ kg feels $\mathbf F=-k\mathbf r$, where $k={k}$ N/m. Find the period of a circular orbit.','Use kr=mv²/r and v=ωr.',r'\omega^2=k/m,\qquad T=2\pi\sqrt{m/k}','The radius cancels; all circular orbits in this ideal harmonic field have the same period.',2*math.pi*math.sqrt(m/k),'s',m=m,k=k),
        ]
    if ch == 8:
        R=a/10
        theta=math.radians(20+v)
        return [
            _case('A motor starts a solid disk',rf'A uniform solid disk has mass ${m}$ kg and radius ${R}$ m. A constant axle torque ${b}$ N·m acts. Find its angular acceleration.','Use the disk moment of inertia about its symmetry axis.',r'I=\tfrac12mR^2,\qquad\alpha=\tau/I','The torque is about the fixed axle; bearing losses are neglected.',2*b/(m*R*R),'rad/s²',m=m,R=R,torque=b),
            _case('A cylinder rolling down a slope',rf'A uniform solid cylinder rolls without slipping down a ${20+v}$° incline. Find the acceleration of its center.','Combine translation, rotation about the center and a=αR.',r'a=\frac{g\sin\theta}{1+I/(mR^2)}=\frac23g\sin\theta','Static friction supplies the torque; its contact point does no slipping work.',2*G*math.sin(theta)/3,'m/s²',theta=theta,g=G),
            _case('An angular impulse',rf'A rotor has moment of inertia ${a}$ kg·m² and starts at rest. A torque of ${b}$ N·m acts for ${t}$ s. Find its final angular speed.','Angular impulse changes angular momentum.',r'I\Delta\omega=\tau\Delta t,\qquad\omega=\tau\Delta t/I','The fixed-axis moment of inertia is constant throughout the pulse.',b*t/a,'rad/s',I=a,torque=b,t=t),
            _case('Moving a disk axis sideways',rf'A uniform disk of mass ${m}$ kg and radius ${R}$ m rotates about an axis parallel to its symmetry axis but a distance ${R/2}$ m from its center. Find its moment of inertia.','Start with the center-of-mass axis and add md².',r'I=I_{\rm cm}+md^2=\tfrac12mR^2+m(R/2)^2','The parallel-axis theorem applies because the reference axis passes through the center of mass.',.75*m*R*R,'kg·m²',m=m,R=R,d=R/2),
            _case('Two disks come to a shared speed',rf'Two coaxial rotors have moments of inertia ${a}$ and ${b}$ kg·m². The first spins at ${u}$ rad/s; the second is at rest. They couple with no external axial torque. Find their shared final angular speed.','Angular momentum is conserved even though friction dissipates kinetic energy.',r'I_1\omega_1=(I_1+I_2)\omega_f','Internal friction transfers angular momentum between the rotors.',a*u/(a+b),'rad/s',I1=a,I2=b,w=u),
            _case('A hanging disk unwinds',rf'A uniform disk unwinds downward from a light string wrapped around its outer radius. The string remains vertical and does not slip. Find its downward acceleration.','Write mg−T=ma and TR=Iα.',r'a=\frac{g}{1+I/(mR^2)}=\frac23g','Some gravitational energy becomes rotation, so the center accelerates more slowly than free fall.',2*G/3,'m/s²',g=G),
            _case('A rod as a physical pendulum',rf'A uniform thin rod of length ${a}$ m hangs from a frictionless pivot at one end. Find its period for small angular oscillations.','The gravitational lever arm is L/2 and the end-axis inertia is mL²/3.',r'T=2\pi\sqrt{I/(mgd)}=2\pi\sqrt{2L/(3g)}','Linearize the restoring torque only for small angles.',2*math.pi*math.sqrt(2*a/(3*G)),'s',L=a,g=G),
            _case('An off-center hit on a hinged bar',rf'A stationary bar has fixed-pivot moment of inertia ${a}$ kg·m². A tangential impulse of ${b}$ N·s is delivered ${a/2}$ m from the pivot. Find its angular speed immediately after the hit.','Take angular impulse about the pivot; the pivot impulse has no moment there.',r'I\omega=Jd,\qquad\omega=Jd/I','The stated impulse is tangential, so its moment arm is the full distance d.',b/2,'rad/s',I=a,J=b,d=a/2),
        ]
    if ch == 9:
        I1,I2,I3=2.,3.,5.
        w=a/2
        return [
            _case('A three-dimensional torque',rf'A force $\mathbf F=(0,{b},{a})$ N acts at $\mathbf r=({a},0,{b})$ m from an origin. Find the x component of its torque.','Use the determinant for r×F, retaining the sign.',r'\tau_x=r_yF_z-r_zF_y=-b^2','The x component comes from the yz-plane contributions, not from rₓFₓ.',-b*b,'N·m',a=a,b=b),
            _case('A box about its long axis',rf'A uniform rectangular box of mass ${m}$ kg has side lengths ${a}$, ${b}$ and ${a+2}$ m along x,y,z. Find its central moment of inertia about x.','Only distances perpendicular to x contribute.',r'I_x=\frac{m}{12}(L_y^2+L_z^2)','The x side length does not appear in Iₓ.',m*(b*b+(a+2)**2)/12,'kg·m²',m=m,Ly=b,Lz=a+2),
            _case('Fast precession of a supported rotor',rf'A fast-spinning symmetric rotor has mass ${m}$ kg, center of mass ${a/10}$ m from its support, axial inertia ${b}$ kg·m² and axial spin ${20+a}$ rad/s. In the fast-top approximation, find its steady precession angular speed.','Use torque magnitude divided by the large axial angular momentum; the common sinθ cancels.',r'\Omega\simeq\frac{mgd}{I_3\omega_3}','This is the slow-precession fast-spin approximation, not an exact general heavy-top result.',m*G*(a/10)/(b*(20+a)),'rad/s',m=m,d=a/10,I=b,w=20+a,g=G),
            _case('Angular momentum along principal axes',rf'A rigid body has principal moments $(I_1,I_2,I_3)=({a},{b},{a+b})$ kg·m² and angular velocity $(1,2,0)$ rad/s in those axes. Find the magnitude of its angular momentum.','Multiply each angular-velocity component by its corresponding principal moment.',r'\mathbf L=(I_1\omega_1,I_2\omega_2,I_3\omega_3),\qquad |\mathbf L|=\sqrt{a^2+4b^2}','L need not be parallel to ω for unequal principal moments.',math.hypot(a,2*b),'kg·m²/s',I1=a,I2=b),
            _case('A small torque-free wobble',rf'A symmetric torque-free body has $I_1=I_2={a}$ kg·m², $I_3={b}$ kg·m² and body-axis spin $ω_3={w}$ rad/s. Find the magnitude of the body-frame transverse precession angular frequency.','Linearize Euler’s first two equations with constant ω₃.',r'|\Omega_{\rm body}|=\left|\frac{I_3-I_1}{I_1}\omega_3\right|','This is a body-frame wobble frequency, not the space-frame precession rate of the symmetry axis.',abs((b-a)*w/a),'rad/s',I1=a,I3=b,w=w),
            _case('An unstable intermediate-axis spin',rf'A free body has principal moments $(2,3,5)$ kg·m² and nearly pure spin $ω_2={w}$ rad/s. Find the growth rate of a small coupled perturbation in $ω_1,ω_3$.','Linearized Euler equations give a positive second derivative coefficient about the intermediate axis.',r'\lambda=|\omega_2|\sqrt{\frac{(I_3-I_2)(I_2-I_1)}{I_1I_3}}','Because both moment differences are positive, the perturbation has exponentially growing and decaying branches.',w*math.sqrt(.2),'s⁻¹',w=w,I1=I1,I2=I2,I3=I3),
            _case('A directional angular impulse',rf'A rotor initially has angular momentum $(0,0,{10*a})$ kg·m²/s. A short external angular impulse $({b},0,0)$ N·m·s is delivered. Find the angle of the new angular momentum from +z.','Add the angular impulse as a vector before finding its direction.',r'\mathbf L_f=(J_x,0,L_z),\qquad\theta=\tan^{-1}(J_x/L_z)','The impulse tilts L; this statement alone does not determine the instantaneous body orientation.',math.degrees(math.atan(b/(10*a))),'°',J=b,L=10*a),
            _case('Kinetic energy in principal axes',rf'A rigid body has principal moments $(I_1,I_2,I_3)=({a},{b},{a+b})$ kg·m² and body angular velocity $(2,0,1)$ rad/s. Find its rotational kinetic energy.','Sum the separate principal-axis energy terms.',r'T=\tfrac12(I_1\omega_1^2+I_2\omega_2^2+I_3\omega_3^2)','Principal axes remove cross terms from the inertia tensor.',(5*a+b)/2,'J',I1=a,I2=b,I3=a+b),
        ]
    if ch == 10:
        Omega=.2+.02*v
        return [
            _case('A pendulum in an accelerating train',rf'A train accelerates horizontally at ${a}$ m/s². Find the angle a freely hanging pendulum makes from downward vertical once it is at rest relative to the train.','In the train frame, combine gravity with a horizontal inertial force opposite the train acceleration.',r'\tan\theta=a/g','The bob leans backward because the effective gravity tilts opposite the train acceleration.',math.degrees(math.atan(a/G)),'°',a=a,g=G),
            _case('A pendulum in a rising lift',rf'A small pendulum has length ${a}$ m in a lift accelerating upward at ${b/2}$ m/s². Find its small-angle period relative to the lift.','The effective downward gravity magnitude is g+a.',r'T=2\pi\sqrt{\ell/(g+a)}','The increased effective gravity makes the period shorter than in an unaccelerated lift.',2*math.pi*math.sqrt(a/(G+b/2)),'s',L=a,acc=b/2,g=G),
            _case('A spring on a rotating radial rail',rf'A mass ${m}$ kg slides on a horizontal radial rail rotating at ${Omega:.2f}$ rad/s. A spring of stiffness ${k}$ N/m has natural radial length ${a/10}$ m and is attached at the axis. Find the equilibrium radius.','In the rotating frame, balance inward spring force against outward centrifugal force.',r'k(r-\ell_0)=m\Omega^2r,\qquad r=\frac{k\ell_0}{k-m\Omega^2}','The given k exceeds mΩ², so the radial equilibrium is stable.',k*(a/10)/(k-m*Omega**2),'m',m=m,k=k,Omega=Omega,L=a/10),
            _case('A rotating liquid surface',rf'A liquid rotates steadily at ${Omega:.2f}$ rad/s. Find the free-surface height rise from the axis to radius ${a}$ m.','The free surface is perpendicular to effective gravity; integrate dh/dr=Ω²r/g.',r'\Delta h=\Omega^2R^2/(2g)','The resulting surface is a paraboloid, not a tilted plane.',Omega**2*a*a/(2*G),'m',Omega=Omega,R=a,g=G),
            _case('Coriolis direction in a rotating room',rf'A room rotates with $\boldsymbol\Omega=(0,0,{Omega:.2f})$ rad/s. A bead instantaneously moves with room-frame velocity $\mathbf v=({u},0,0)$ m/s. Find the y component of its Coriolis acceleration.','Use −2Ω×v in the rotating frame.',r'\mathbf a_C=-2\boldsymbol\Omega\times\mathbf v,\qquad a_{C,y}=-2\Omega v_x','The minus sign is part of the rotating-frame acceleration formula.',-2*Omega*u,'m/s²',Omega=Omega,u=u),
            _case('Support on a rotating ring',rf'A ${m}$ kg rider is fixed on a horizontal ring of radius ${a}$ m rotating at ${Omega:.2f}$ rad/s. Find the magnitude of the horizontal inward force required.','The rider is at rest in the rotating frame but travels on a circle in the inertial frame.',r'F_r=m\Omega^2R','The inward real force supplies inertial-frame centripetal acceleration.',m*Omega**2*a,'N',m=m,Omega=Omega,R=a),
            _case('An upward-thrown object in a lift',rf'A lift accelerates upward at ${a/5:.1f}$ m/s². Inside, an object is thrown straight up at ${u}$ m/s relative to the lift. How long until it returns to the launch height relative to the lift?','Relative to the lift, the downward acceleration is g+a.',r'y=ut-\tfrac12(g+a)t^2,\qquad t_{\rm return}=2u/(g+a)','Discard the launch-time root t=0; air resistance and changes of lift acceleration are absent.',2*u/(G+a/5),'s',u=u,acc=a/5,g=G),
            _case('A rotation-dependent stiffness',rf'A ${m}$ kg mass moves along a horizontal diameter of a platform rotating at ${Omega:.2f}$ rad/s. A centered spring exerts $-kx$ with $k={k}$ N/m. Find the small-oscillation frequency along the rail; the rail supplies the transverse constraint force.','Project onto the rail; the Coriolis force is transverse and does no work along it.',r'm\ddot x=-(k-m\Omega^2)x,\qquad\omega=\sqrt{k/m-\Omega^2}','Rotation reduces the longitudinal restoring coefficient. The stated parameters keep it positive.',math.sqrt(k/m-Omega**2),'rad/s',m=m,k=k,Omega=Omega),
        ]
    if ch == 11:
        ell=3+v
        return [
            _case('A moving clock interval',rf'A moving clock travels at ${beta:.3f}c$ in the laboratory. It records ${a}$ μs between two ticks at its own location. Find the laboratory time between the ticks.','The clock records proper time.',r'\Delta t=\gamma\Delta\tau,\qquad\gamma=(1-\beta^2)^{-1/2}','The laboratory compares events at different laboratory positions on the moving clock worldline.',gamma*a,'μs',beta=beta,tau=a),
            _case('A ruler moving along its length',rf'A ruler has rest length ${ell}$ m and moves longitudinally at ${beta:.3f}c$. Find its laboratory length measured using simultaneous endpoint positions in the laboratory.','The proper length is measured in the ruler rest frame.',r'L=L_0/\gamma','Simultaneity in the measuring frame is essential to the length definition.',ell/gamma,'m',beta=beta,L0=ell),
            _case('Simultaneity after a boost',rf'Two laboratory events are simultaneous and separated by ${ell}$ light-microseconds along +x. A primed frame moves at ${beta:.3f}c$ along +x. Find $\Delta t\prime$ in μs.','Use the Lorentz time transformation with Δt=0.',r'\Delta t\prime=\gamma(\Delta t-v\Delta x/c^2)=-\gamma\beta\Delta x/c','The event at larger laboratory x occurs earlier in the primed frame.',-gamma*beta*ell,'μs',beta=beta,x=ell),
            _case('Adding collinear speeds',rf'A probe travels at $0.4c$ along +x relative to a ship. The ship travels at ${beta:.3f}c$ along +x relative to a station. Find the probe station-frame speed as a multiple of $c$.','Compose velocities with the Lorentz denominator.',r'u/c=\frac{0.4+\beta}{1+0.4\beta}','The result remains below one for the stated subluminal speeds.',(.4+beta)/(1+.4*beta),'c',beta=beta,relative=.4),
            _case('An invariant timelike interval',rf'Two events have laboratory separations $c\Delta t={ell+4}$ m and $\Delta x={ell}$ m, with no transverse separation. Find $c\Deltaτ$ for an inertial clock that visits both.','Use the timelike Minkowski interval.',r'c\Delta\tau=\sqrt{(c\Delta t)^2-\Delta x^2}','The positive interval confirms that one subluminal inertial worldline can connect the events.',math.sqrt((ell+4)**2-ell**2),'m',ct=ell+4,x=ell),
            _case('A receding light source',rf'A monochromatic source recedes directly from a receiver at ${beta:.3f}c$. Find the received frequency divided by the source rest-frame frequency.','Include both time dilation and the changing distance between successive emitted wavefronts.',r'\frac{f_r}{f_s}=\sqrt{\frac{1-\beta}{1+\beta}}','Recession gives a ratio below one.',math.sqrt((1-beta)/(1+beta)),'',beta=beta),
            _case('An event position after a boost',rf'An event has laboratory coordinates $ct={ell+5}$ m and $x={ell}$ m. A primed frame moves at ${beta:.3f}c$ along +x and shares the origin event. Find $x\prime$.','Transform the event, not a simultaneous length measurement.',r'x\prime=\gamma(x-\beta ct)','A single event has a full spacetime coordinate transformation.',gamma*(ell-beta*(ell+5)),'m',beta=beta,x=ell,ct=ell+5),
            _case('A transverse velocity component',rf'A particle has ship-frame velocity $u_x\prime=0$ and $u_y\prime=0.5c$. The ship moves at ${beta:.3f}c$ along +x relative to a station. Find the station-frame y velocity as a multiple of $c$.','The transverse velocity also changes because the time interval changes.',r'u_y=\frac{u_y\prime}{\gamma(1+vu_x\prime/c^2)}=0.5c/\gamma','Transverse speed is not unchanged under a longitudinal Lorentz boost.',.5/gamma,'c',beta=beta),
        ]
    if ch == 12:
        return [
            _case('Momentum in rest-mass units',rf'A particle of rest mass $m$ moves at ${beta:.3f}c$. Find $p/(mc)$.','Relativistic momentum includes γ.',r'p=\gamma mv,\qquad p/(mc)=\gamma\beta','The familiar mv approximation is the low-speed limit.',gamma*beta,'',beta=beta),
            _case('The kinetic fraction of rest energy',rf'A particle moves at ${beta:.3f}c$. Find its kinetic energy divided by its rest energy.','Subtract rest energy from total energy.',r'K=(\gamma-1)mc^2,\qquad K/(mc^2)=\gamma-1','Total energy is γmc²; kinetic energy excludes the rest-energy contribution.',gamma-1,'',beta=beta),
            _case('Mass of two equal light pulses',rf'Two photons each have energy $E$ and their propagation directions make ${40+2*v}$°. Find the invariant mass of the pair as a multiple of $E/c^2$.','Add the photon momenta as vectors, then use the energy–momentum invariant.',r'M^2c^4=(2E)^2-c^2|\mathbf p_1+\mathbf p_2|^2,\quad Mc^2/E=2\sin(\theta/2)','A pair of nonparallel massless particles can have nonzero total invariant mass.',2*math.sin(math.radians(40+2*v)/2),'E/c²',theta=math.radians(40+2*v)),
            _case('Absorbing a light pulse',rf'A particle initially at rest has rest mass $m$. It absorbs a photon with energy ${a/10:.1f}mc^2$. Find its final invariant mass divided by $m$.','The final object moves; adding photon energy directly to its rest energy would miss its recoil momentum.',r'M^2c^4=(mc^2+E)^2-E^2,\qquad M/m=\sqrt{1+2E/(mc^2)}','Both total energy and total momentum are conserved.',math.sqrt(1+2*a/10),'',ratio=a/10),
            _case('Speed from momentum',rf'A particle has momentum magnitude $p={a/5:.1f}mc$. Find its speed as a multiple of $c$.','Eliminate γ using E²=p²c²+m²c⁴ and v=pc²/E.',r'\beta=\frac{p/(mc)}{\sqrt{1+[p/(mc)]^2}}','The speed remains subluminal for every finite momentum of a massive particle.',(a/5)/math.sqrt(1+(a/5)**2),'c',ratio=a/5),
            _case('Two equal particles latch symmetrically',rf'Two particles each have rest mass $m$ and approach head-on at speeds ${beta:.3f}c$ in their center-of-momentum frame. They stick. Find the final composite rest mass divided by $m$.','The net momentum is zero in the given frame.',r'Mc^2=2\gamma mc^2,\qquad M/m=2\gamma','The initial kinetic energy contributes to the composite internal energy and rest mass.',2*gamma,'',beta=beta),
            _case('Force along a relativistic trajectory',rf'A massive particle moves at ${beta:.3f}c$ along a force $F$. Find its instantaneous acceleration divided by $F/m$, using the rest mass $m$.','Differentiate p=γmv for collinear acceleration.',r'F=m\gamma^3a,\qquad a/(F/m)=\gamma^{-3}','The longitudinal acceleration is smaller than the Newtonian value at the same force.',gamma**-3,'',beta=beta),
            _case('Energy seen from a boosted frame',rf'A particle is at rest with mass $m$ in one frame. Another frame moves at ${beta:.3f}c$ relative to it. Find the observed total energy divided by $mc^2$.','Boost the energy–momentum four-vector of a resting particle.',r'E\prime=\gamma mc^2','The energy exceeds mc² because the particle is moving in the new frame.',gamma,'',beta=beta),
        ]
    if ch == 13:
        eta=.1*a
        return [
            _case('Norm of a four-vector',rf'Use metric signature $(+,-,-,-)$. A four-vector has components $A^μ=({a+5},{a},{b},0)$ in consistent units. Find $A^μ A_μ$.','The spatial terms enter with minus signs.',r'A^\mu A_\mu=(A^0)^2-(A^1)^2-(A^2)^2-(A^3)^2','An invariant can be positive, zero or negative; it is not a Euclidean length squared.',(a+5)**2-a*a-b*b,'',time=a+5,x=a,y=b),
            _case('Adding two rapidities',rf'Two successive collinear boosts each have rapidity ${eta:.1f}$. Find the speed of their combined boost as a multiple of $c$.','Rapidity, rather than ordinary speed, adds for collinear boosts.',r'\eta_{\rm total}=2\eta,\qquad\beta=\tanh(2\eta)','The hyperbolic tangent automatically respects the limiting speed.',math.tanh(2*eta),'c',eta=eta),
            _case('The time component of four-velocity',rf'A particle has ordinary speed ${beta:.3f}c$. Find $U^0/c$ for $U^μ=dx^μ/dτ$.','Laboratory time changes γ times faster than proper time.',r'U^\mu=(\gamma c,\gamma\mathbf v),\qquad U^0/c=\gamma','With signature (+,−,−,−), its squared norm remains c².',gamma,'',beta=beta),
            _case('A Minkowski inner product',rf'With signature $(+,-,-,-)$, take $A^μ=({a+3},{a},0,0)$ and $B^μ=({b+2},0,{b},0)$. Find $A\cdot B$.','Pair matching coordinates, applying the metric signs.',r'A\cdot B=A^0B^0-A^1B^1-A^2B^2-A^3B^3','Here the nonzero spatial components point along different coordinate axes, so their spatial dot product vanishes.',(a+3)*(b+2),'',A0=a+3,B0=b+2),
            _case('A boost of a null four-vector',rf'A light pulse travels along +x with four-momentum proportional to $(1,1,0,0)$. Boost to a frame moving at ${beta:.3f}c$ along +x. Find its new time component divided by the old time component.','Apply the ordinary Lorentz boost to a null four-vector.',r'P\prime^0=\gamma(P^0-\beta P^1),\qquad P\prime^0/P^0=\gamma(1-\beta)','The pulse is redshifted in the frame moving along with its propagation direction.',gamma*(1-beta),'',beta=beta),
            _case('Orthogonality of force and velocity',rf'In one dimension a particle has $U^μ=(γc,γv,0,0)$ and four-force $K^μ$. If $v={beta:.3f}c$ and $K^1={a}$ force units, find $K^0$ from $K\cdot U=0$.','Apply the (+,−,−,−) metric to the orthogonality condition.',r'K^0\gamma c-K^1\gamma v=0,\qquad K^0=\beta K^1','This time component is related to power divided by c, not an additional spatial force.',beta*a,'force units',beta=beta,K1=a),
            _case('Proper acceleration and rapidity',rf'A particle starts at rest and maintains constant proper acceleration $α$. After proper time satisfying $ατ/c={eta:.1f}$, find its laboratory speed as a multiple of $c$.','Constant proper acceleration makes rapidity grow linearly with proper time.',r'\eta=\alpha\tau/c,\qquad\beta=\tanh\eta','Constant proper acceleration is different from constant laboratory acceleration.',math.tanh(eta),'c',eta=eta),
            _case('A spatial component transverse to a boost',rf'A four-vector is $A^μ=({a+5},{a},{b},0)$. A Lorentz boost acts along x at ${beta:.3f}c$. Find $A\prime^2$.','An x boost mixes only the time and x components.',r'A\prime^2=A^2','This statement concerns a four-vector component; transverse ordinary velocity also contains a transformed time denominator.',b,'',y=b,beta=beta),
        ]
    if ch == 14:
        # Scaled source parameters keep calculations readable; c remains explicit.
        compact=.002+.0001*v
        return [
            _case('A weak-field clock comparison',rf'Two stationary clocks differ in gravitational potential by $\DeltaΦ/c^2={a/100000:.7f}$, with the upper clock at higher potential. In the weak-field approximation, find its fractional rate increase over the lower clock.','Use the first-order gravitational time-dilation relation.',r'\frac{\Delta f}{f}\simeq\frac{\Delta\Phi}{c^2}','A stationary clock at higher gravitational potential ticks faster to first order.',a/100000,'',potential=a/100000),
            _case('A clock outside a spherical body',rf'A stationary clock lies outside a nonrotating spherical body at radius $r$, where $r_s/r={compact:.4f}$ and $r_s=2GM/c^2$. Find its rate $dτ/dt$ relative to Schwarzschild coordinate time.','Use the stationary Schwarzschild clock factor.',r'd\tau/dt=\sqrt{1-r_s/r}','The reference coordinate time agrees with a stationary clock arbitrarily far from the body.',math.sqrt(1-compact),'',compact=compact),
            _case('The Schwarzschild length scale',rf'For a spherical gravitating body, $GM/c^2={a}$ km. Find its Schwarzschild radius in km.','Keep the factor of two in the definition.',r'r_s=2GM/c^2','This is a geometric length scale; a physical surface need not lie at this radius.',2*a,'km',GMc2=a),
            _case('Tidal separation along a radius',rf'Two freely falling test particles are separated radially by a small distance $δ r$. At their position $GM/r^3={a/100:.2f}$ s⁻² and $δ r={b}$ m. Find the magnitude of their differential radial acceleration to first order.','Differentiate the inverse-square acceleration with respect to radius.',r'|\delta a_r|\simeq\frac{2GM}{r^3}|\delta r|','The radial separation stretches; the approximation requires separation much smaller than the radius.',2*a/100*b,'m/s²',gradient=a/100,separation=b),
            _case('Weak bending of a light ray',rf'A light ray passes a spherical mass with impact parameter $b$, where $GM/(bc^2)={a/1000000:.7f}$. In the weak-deflection approximation of general relativity, find the deflection angle in radians.','Use the full relativistic weak-field factor, not the Newtonian massive-particle estimate.',r'\delta\theta\simeq4GM/(bc^2)','This approximation applies when GM/(bc²) is much smaller than one.',4*a/1000000,'rad',ratio=a/1000000),
            _case('A small orbital periapsis advance',rf'A weak-field bound orbit has $GM/(ac^2)={a/10000000:.8f}$ and eccentricity $e=0.2$. Find the leading Schwarzschild periapsis advance per orbit.','Use the semimajor axis a and retain the eccentricity correction.',r'\Delta\varpi\simeq\frac{6\pi GM}{ac^2(1-e^2)}','This is a leading weak-field correction, not the Newtonian closed-ellipse result.',6*math.pi*a/10000000/(1-.2**2),'rad/orbit',ratio=a/10000000,e=.2),
            _case('Light climbing a weak gravitational field',rf'A photon travels upward between stationary emitter and receiver through a potential increase $\DeltaΦ/c^2={a/100000:.7f}$. Find the first-order fractional received-frequency change $(f_r-f_e)/f_e$.','A photon climbing to higher potential is gravitationally redshifted.',r'(f_r-f_e)/f_e\simeq-\Delta\Phi/c^2','The negative sign refers to received frequency; it is consistent with the higher clock ticking faster.',-a/100000,'',potential=a/100000),
            _case('An elevator and the equivalence principle',rf'A small laboratory accelerates upward at ${a}$ m/s² in otherwise flat spacetime. Its floor and ceiling are separated by ${b}$ m. Take $c=3.00\times10^8$ m/s. To first order in $ah/c^2$, find the fractional rate increase of a ceiling clock over a floor clock at rest in the laboratory.','Locally an upward-accelerating lab has an effective downward gravitational field.',r'\Delta f/f\simeq ah/c^2','This is the small-height, small-potential limit; it does not assert uniform gravity globally.',a*b/9e16,'',acc=a,h=b,c=3e8),
        ]
    raise ValueError('Choose a chapter from 1 to 14.')


@lru_cache(maxsize=1)
def items():
    result = {}
    for ch,(count, first_exercise) in enumerate(SLOTS, 1):
        for number in range(1,count+1):
            family, variant = (number-1)%8, (number-1)//8
            raw = _families(ch,variant)[family]
            if 'g' in raw['facts'] and '9.81' not in raw['statement_md']:
                raw['statement_md'] += ' Use $g=9.81$ m/s².'
            if not math.isfinite(raw['answer']):
                raise ValueError('Invalid companion answer.')
            pid = rf'k:{ch}.{number}'
            revision = hashlib.sha256(json.dumps(raw,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
            result[pid] = {**raw,'id':pid,'kind':'exercise' if number>=first_exercise else 'problem',
                           'chapter':ch,'number':number,'reference_number':rf'{ch}.{number}',
                           'family':rf'{ch}:{family}','variant':variant+1,'source_revision':revision}
    return result


def item(pid):
    try:
        return copy.deepcopy(items()[pid])
    except (KeyError,TypeError):
        raise ValueError('That Kinema practice question is unavailable.') from None


def _summary(row):
    return {**{k:row[k] for k in ('id','kind','chapter','number','title','reference_number','family','variant')},
            'book_id':'kinema','section_id':None,'stars':1,'visual_available':False,'prepared_solution':True}


def search(chapter=None,kind=None,query='',offset=0,limit=60,prepared=None,visual=None):
    if chapter is not None and chapter not in range(1,15):
        raise ValueError('Choose a chapter from 1 to 14.')
    if kind not in (None,'problem','exercise'):
        raise ValueError('Choose Problems or Exercises.')
    query=str(query).strip().lower()[:160]
    rows=[_summary(r) for r in items().values() if (chapter is None or r['chapter']==chapter)
          and (not kind or r['kind']==kind) and (not query or query in (r['reference_number']+' '+r['title']+' '+r['statement_md']).lower())]
    if prepared is False or visual is True:
        rows=[]
    offset=max(0,int(offset));limit=max(1,min(100,int(limit)))
    return {'items':rows[offset:offset+limit],'total':len(rows),'prepared_total':len(rows),'visual_total':0,
            'offset':offset,'limit':limit,'next_offset':offset+limit if offset+limit<len(rows) else None}


def public_item(pid):
    row=item(pid)
    answer=rf"{row['answer']:.7g}" + ((' '+row['unit']) if row['unit'] else '')
    steps=[{'id':'setup','title':'Choose the relation','body_md':row['reason']+'\n\n$$'+row['equation']+'$$'},
           {'id':'evaluate','title':'Evaluate and check','body_md':'Using the stated values gives **'+answer+'**. Check the sign, units and assumptions in the relation above.'}]
    return {**_summary(row),'label':'Kinema '+row['reference_number'],'book_title':'Kinema practice',
            'statement_md':row['statement_md'],'statement_status':'checked','source_revision':row['source_revision'],
            'pages':[],'images':{'question':[],'figure':[],'setup':[]},'related_questions':[],
            'visual':None,'simulation_id':None,'starter':'Help me set up this problem.','guidance':{
                'topic':row['title'],'method_md':row['hint'],'relations_md':'$$'+row['equation']+'$$\n\n'+row['reason'],
                'source':{'question_id':pid,'content_sha256':row['source_revision'],
                          'policy_revision':'exact-question-150-1','classification':'authored_exact'}},
            'prepared_help':{'available':True,'checked':True,'revision':row['source_revision'],
                             'hints':[{'id':'first','text_md':row['hint']}],'steps':steps}}


def private_context(pid):
    row=item(pid)
    return {'id':pid,'kind':row['kind'],'title':row['title'],'statement':row['statement_md'],'statement_verified':True,
            'solution_origin':'original_kinema_derivation','images':[],'source_images':[],
            'source_revision':row['source_revision'],'related_questions':[],'source_references':[],
            'prepared_help':public_item(pid)['prepared_help'],
            'instruction':'This is an original Kinema companion question. Its reference number is a navigation label. '
                          'Do not fetch, quote or claim the corresponding textbook question or printed solution. '
                          'Teach this exact supplied setup one idea at a time.'}
