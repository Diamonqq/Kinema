"""Small, explicit visual contracts. Numbers come from authored course givens, never an LLM."""
import math

FOCI = ('radius', 'velocity', 'momentum', 'angular_velocity', 'angular_momentum', 'overview')
SCENES = {
    'ch9:1': {'example': (2, .5, 4, .65), 'turn': (3, .2, 5, .65)},
    'ch9:2': {'example': (2, .5, 4, 0), 'turn': (1, .2, -5, math.pi / 2)},
}


def descriptor(lid, rung, phase):
    key = rung.get('progress_key', f"{lid}:{rung['n']}")
    if key not in SCENES:
        return None
    mode = 'turn' if phase in ('turn', 'review') else 'example'
    m, radius, omega, theta = SCENES[key][mode]
    return {'kind': 'circular_motion', 'key': key, 'scenario': mode,
            'givens': {'mass': m, 'radius': radius, 'omega': omega, 'theta': theta},
            'can_explore': mode == 'example', 'show_results': phase != 'turn',
            'fixed_position': key == 'ch9:2',
            'view': 'Top view of the xy plane, looking from +z; +x right and +y up. The center is the origin.'}


def snapshot(spec, raw=None):
    """Validate inputs and recompute all physics. Never trust client-supplied results."""
    if not spec:
        return None
    raw = raw if isinstance(raw, dict) and raw.get('scenario') == spec['scenario'] else {}
    given = spec['givens']
    def num(key, low, high):
        value = raw.get(key, given.get(key, 0))
        if type(value) not in (int, float) or not math.isfinite(value):
            value = given.get(key, 0)
        return max(low, min(high, value))
    radius = num('radius', .1, .8) if spec['can_explore'] else given['radius']
    omega = num('omega', -8, 8) if spec['can_explore'] else given['omega']
    theta = num('theta', -1e6, 1e6) % math.tau
    mass = given['mass']
    x, y = radius * math.cos(theta), radius * math.sin(theta)
    return {'kind': spec['kind'], 'scenario': spec['scenario'], 'mass': mass, 'radius': radius, 'omega': omega,
            'theta': theta, 'focus': raw.get('focus') if raw.get('focus') in FOCI else 'radius',
            'playing': raw.get('playing') is True, 'playback_rate': .25,
            'used_visual_help': raw.get('used_visual_help') is True,
            'exploring': abs(radius - given['radius']) > 1e-9 or abs(omega - given['omega']) > 1e-9 or
                         (spec['fixed_position'] and abs(math.remainder(theta - given['theta'], math.tau)) > 1e-8),
            'computed': {'position_m': [x, y, 0], 'velocity_m_s': [-omega * y, omega * x, 0],
                         'speed_m_s': abs(omega) * radius, 'momentum_kg_m_s': [-mass * omega * y, mass * omega * x, 0],
                         'angular_momentum_kg_m2_s': [0, 0, mass * radius * radius * omega]},
            'view': spec['view'], 'arrow_lengths': 'Schematic direction arrows; compare numeric quantities, not unlike arrow lengths.'}


def step_focus(spec, step):
    if not spec or not step:
        return 'radius'
    if spec['key'] == 'ch9:2':
        return 'angular_velocity' if step == 1 else 'angular_momentum' if step in (3, 4) else 'velocity'
    return 'velocity' if step == 1 else 'momentum' if step == 2 else 'angular_momentum'
