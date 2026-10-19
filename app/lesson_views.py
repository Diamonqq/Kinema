"""Reviewed presentation for the saved multi-topic Morin preparation lesson.

Read-time only: the original generated lesson, records and progress stay intact.
The explicit step signature prevents attaching these drawings to unrelated work.
"""
import math

TITLES = ['L need not follow ω', 'PD01: symmetry axes', 'The diagonal trap', 'PD02: uniform plate',
          'Gyroscope rule', 'Steering 1: handlebar push', 'Steering 2: lean right',
          '9.54: wheel geometry', '9.54: where ω points', '9.54: L about the pivot',
          '9.54: torque direction', 'Link to your part (g)']


def presentation(lesson):
    if [s.get('title') for s in lesson.get('steps', [])] != TITLES:
        return None
    if lesson.get('visualization', {}).get('kind') != 'rigid3d':
        return None
    descriptors = [
        ('rectangle', 'directions', 'Why L can tilt', 'Two components of the same rotation can have different moments of inertia.'),
        ('rectangle', 'symmetry', 'Four masses · symmetry', 'Opposite signs of xy cancel. The centre axes are principal axes.'),
        ('rectangle', 'diagonal', 'The diagonal test', 'Change the spin direction, then compare a rectangle with a square.'),
        ('rectangle', 'plate', 'Uniform rectangular plate', 'Spreading the mass changes the moments, but keeps the symmetry axes.'),
        ('vectors', 'rule', 'How torque turns L', 'Torque sets the change in angular momentum: ΔL = τ Δt.'),
        ('vectors', 'lean', 'Why the wheel leans left', 'Front view: the bike’s left axle end gains a downward component.'),
        ('vectors', 'steer', 'Why the wheel steers right', 'Top view: L turns toward the front; the rolling direction turns right.'),
        ('native', 'geometry', 'Rolling wheel · geometry', 'Identify the ground pivot, axle and wheel before showing any vectors.'),
        ('native', 'omega', 'Where ω points', 'The instantaneous rotation axis joins the ground pivot to the wheel’s contact point.'),
        ('native', 'momentum', 'L about the pivot', 'Compare only ω and L. Their directions differ because the principal moments differ.'),
        ('native', 'torque', 'How L changes', 'The torque arrow shows the instantaneous change of L as the wheel circles.'),
        ('native', 'forces', 'Torque and ground contact', 'Two supports act here. This model does not determine their separate reaction forces.'),
    ]
    steps = [dict(step=i, kind=k, mode=m, title=t, caption=c) for i,(k,m,t,c) in enumerate(descriptors)]
    steps[0]['body'] = (r'$\vec\omega$ shows the spin direction; $\vec L$ is angular momentum. '
        r'Take four equal corner masses on a light frame with $a=2b$. About its centre, $I_y=4I_x$.' '\n\n'
        r'For a spin between $x$ and $y$, $L_x=I_x\omega_x$ and $L_y=I_y\omega_y$. '
        r'The $y$ component is multiplied by four, so $\vec L$ tilts away from $\vec\omega$.' '\n\n'
        r'Now point the spin along $x$ in the visual. Only one component remains: '
        r'$\vec L$ and $\vec\omega$ line up. That is a **principal axis**.')
    steps[0]['result'] = r'\vec L=\mathbf I\vec\omega'
    # Do not refer to a green axis that is absent from this lesson's visual.
    steps[3]['body'] = lesson['steps'][3]['body'].replace(' Compare these three facts with whatever axis is shown in green.', '')
    return {'steps': steps, 'source':'reviewed-morin-prep'}


def diagram_context(lesson, payload):
    p = presentation(lesson)
    if not p or not isinstance(payload, dict):
        return None
    step = payload.get('step')
    if not isinstance(step, int) or isinstance(step, bool) or not 0 <= step < 7:
        return None
    desc = p['steps'][step]
    out = {**desc, 'illustrative':True}
    def bounded(key, default, low, high):
        v=payload.get(key, default)
        return min(high,max(low,float(v))) if isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) else default
    if desc['kind']=='rectangle':
        a,b = (1.,1.) if payload.get('square') is True else (2.,1.)
        angle = bounded('angle', math.degrees(math.atan(b/a)) if desc['mode']=='diagonal' else 35., 0., 90.)
        wx,wy = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        # Common positive factors cancel for the direction; no invented physical units.
        lx,ly = b*b*wx, a*a*wy
        out.update(a_over_b=a/b,spin_angle_deg=angle,L_angle_deg=math.degrees(math.atan2(ly,lx)),
                   inertia_ratio_Iy_Ix=a*a/(b*b),note='Schematic directions about the centre. Independent arrow scales. Illustrative a/b; not homework givens.')
    else:
        out.update(change_fraction=bounded('change',.2,0,.5),
                   note='Short-time vector addition ΔL=τΔt; fast-spinning wheel approximation for steering. Arrows are schematic, not force magnitudes.')
    return out
