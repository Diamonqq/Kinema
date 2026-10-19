/* Analytic uniform circular motion. No generated geometry or integration drift. */
import { esc } from './md.js';

export function circleQuantities(m, r, omega, theta) {
  const x = r * Math.cos(theta), y = r * Math.sin(theta);
  return { x, y, vx: -omega * y, vy: omega * x, speed: Math.abs(omega) * r,
    px: -m * omega * y, py: m * omega * x, Lz: m * r * r * omega };
}
const fmt = x => Number(x.toPrecision(4)).toString();
const names = { radius: 'Radius', velocity: 'Velocity', momentum: 'Momentum', angular_velocity: 'Angular velocity', angular_momentum: 'Angular momentum', overview: 'All vectors' };

export class CircleVisual {
  constructor(host, spec) {
    this.host = host; this.spec = spec; this.state = { ...spec.state }; this.dead = false;
    this.assisted = false; this.compact = host.getBoundingClientRect().width < 550;
    this.playing = !spec.fixed_position && spec.scenario === 'example' && !matchMedia('(prefers-reduced-motion: reduce)').matches && spec.state.focus === 'radius';
    this.visible = true; this.last = null; this.locked = false;
    this.mount(); this.render();
    this.resizeObserver = new ResizeObserver(entries => {
      const compact = entries[0].contentRect.width < 550;
      if (compact !== this.compact) { this.compact = compact; this.render(); }
    });
    this.resizeObserver.observe(host);
    this.observer = new IntersectionObserver(entries => { this.visible = entries[0].isIntersecting; this.last = null; if (this.visible) this.animate(); });
    this.observer.observe(host); this.animate();
  }
  mount() {
    this.host.innerHTML = `<div class="orbit-stage"><div class="orbit-caption"><span>Top view · xy plane</span><span class="orbit-mode"></span></div>
      <svg class="orbit-svg" viewBox="0 0 640 480" role="img" aria-label="A ball moving in a horizontal circle, viewed from above"><defs>
      <radialGradient id="ball-surface" cx="30%" cy="25%"><stop stop-color="#d2f1e9"/><stop offset=".4" stop-color="#80c4b9"/><stop offset="1" stop-color="#345c58"/></radialGradient>
      <marker id="orbit-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="context-stroke" stroke-width="1.8"/></marker></defs>
      <circle class="orbit-path" cx="320" cy="230" fill="none" stroke="#41474d" stroke-width="1.2"/>
      <path class="orbit-trail" fill="none" stroke="#80c4b9" stroke-opacity=".25" stroke-width="2"/>
      <line class="orbit-radius" x1="320" y1="230" stroke="#69737b" stroke-width="1.5"/>
      <circle cx="320" cy="230" r="3" fill="#7e8891"/><text x="310" y="251" class="orbit-origin">O</text>
      <text class="orbit-radius-label">r</text><path class="orbit-velocity" fill="none" stroke="#86cec0" stroke-width="2.4" marker-end="url(#orbit-arrow)"/>
      <text class="orbit-vector-label">v</text><path class="orbit-right-angle" fill="none" stroke="#606c72" stroke-width="1"/>
      <g class="orbit-normal"><circle cx="320" cy="230" r="13" fill="var(--bg)" stroke="#b6a3d5" stroke-width="1.5"/><path class="orbit-normal-mark" stroke="#b6a3d5" stroke-width="2"/><circle class="orbit-normal-dot" cx="320" cy="230" r="3" fill="#b6a3d5"/><text x="341" y="225">L</text><text class="orbit-normal-direction" x="341" y="244">out of screen</text></g>
      <circle class="orbit-ball-halo" r="23" fill="#80c4b9" opacity=".05"/>
      <circle class="orbit-ball" r="12" fill="url(#ball-surface)" stroke="#a3d5c9" stroke-opacity=".45" tabindex="0" role="slider" aria-label="Ball position in degrees. Use arrow keys or drag." aria-valuemin="0" aria-valuemax="360"/>
      <circle class="orbit-hit" r="28" fill="transparent" aria-hidden="true"/>
      <text class="orbit-mass-label">${specMass(this.spec)} kg</text>
      <g class="orbit-axes" transform="translate(56 403)" stroke="#515b62" stroke-width="1" fill="none"><path d="M0 0H32M0 0V-32" marker-end="url(#orbit-arrow)"/><text x="40" y="4">x</text><text x="-3" y="-42">y</text><text x="-8" y="26">+z toward you</text></g>
      </svg><div class="orbit-readout" aria-live="off"></div></div>
      <div class="orbit-controls"><button class="orbit-play" aria-label="Pause motion"></button><span class="playback-note">¼× playback</span><span class="orbit-spacer"></span><label class="sr-only" for="orbit-focus">Show a quantity</label><select id="orbit-focus">${Object.entries(names).map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select><button class="orbit-reset" title="Restore the problem's values">Reset</button>${this.spec.can_explore ? '<button class="orbit-explore">Explore</button>' : ''}</div>
      <div class="orbit-experiments" hidden><label>Radius <output data-radius></output><input aria-label="Radius in metres" type="range" min="0.1" max="0.8" step="0.05" data-input="radius"></label><label>Angular velocity <output data-omega></output><input aria-label="Angular velocity in radians per second" type="range" min="-8" max="8" step="0.5" data-input="omega"></label><p>Change a value, then ask your tutor what changes. Reset returns to the problem.</p></div>`;
    this.svg = this.host.querySelector('svg');
    this.host.querySelector('.orbit-play').onclick = () => { if (this.locked) return; this.playing = !this.playing; this.last = null; this.render(); this.animate(); };
    this.host.querySelector('select').onchange = e => { this.focus(e.target.value); };
    this.host.querySelector('.orbit-reset').onclick = () => { if (this.locked) return; Object.assign(this.state, this.spec.givens); this.playing = false; this.render(); };
    this.host.querySelector('.orbit-explore')?.addEventListener('click', () => { const el = this.host.querySelector('.orbit-experiments'); el.hidden = !el.hidden; });
    this.host.querySelectorAll('[data-input]').forEach(input => input.oninput = () => { if (this.locked) return; this.state[input.dataset.input] = +input.value; this.playing = false; this.render(); });
    const ball = this.host.querySelector('.orbit-ball');
    ball.onkeydown = e => { if (this.locked || !['ArrowLeft','ArrowRight','Home'].includes(e.key)) return; e.preventDefault();
      this.playing = false; this.state.theta = e.key === 'Home' ? this.spec.givens.theta : this.state.theta + (e.key === 'ArrowRight' ? -1 : 1) * Math.PI / 36; this.render(); };
    let dragging = false;
    const move = e => {
      if (!dragging || this.locked) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(this.svg.getScreenCTM().inverse());
      this.state.theta = Math.atan2(230 - p.y, p.x - 320); this.render();
    };
    for (const target of [ball, this.host.querySelector('.orbit-hit')]) {
      target.onpointerdown = e => { if (this.locked) return; dragging = true; this.playing = false; target.setPointerCapture(e.pointerId); move(e); };
      target.onpointermove = move;
      target.onpointerup = target.onpointercancel = () => { dragging = false; };
    }
  }
  render() {
    const s = this.state, q = circleQuantities(s.mass, s.radius, s.omega, s.theta);
    const radius = s.radius * 130 / this.spec.givens.radius, c = Math.cos(s.theta), sn = Math.sin(s.theta), bx = 320 + radius * c, by = 230 - radius * sn;
    const sign = Math.sign(s.omega), tx = -sn * sign, ty = -c * sign, ex = bx + tx * 76, ey = by + ty * 76;
    const set = (sel, props) => { const el = this.host.querySelector(sel); for (const [k,v] of Object.entries(props)) el.setAttribute(k, v); return el; };
    this.svg.setAttribute('viewBox', this.compact ? '80 -10 480 480' : '0 0 640 480');
    set('.orbit-path', { r: radius });
    set('.orbit-radius', { x2: bx, y2: by, stroke: s.focus === 'radius' ? '#9ebdb8' : '#525d65' });
    set('.orbit-radius-label', { x: 320 + radius * c * .55 + sn * 14, y: 230 - radius * sn * .55 + c * 14 });
    set('.orbit-ball', { cx: bx, cy: by, 'aria-valuenow': Math.round(((s.theta * 180 / Math.PI) % 360 + 360) % 360) });
    set('.orbit-ball-halo', { cx: bx, cy: by });
    set('.orbit-hit', { cx: bx, cy: by });
    const labelSide = radius > 180 ? -1 : 1;
    set('.orbit-mass-label', { x: bx + c * 30 * labelSide, y: by - sn * 30 * labelSide + 5, 'text-anchor': c * labelSide < -.3 ? 'end' : c * labelSide > .3 ? 'start' : 'middle' });
    const showTangent = ['velocity','momentum','angular_momentum','overview'].includes(s.focus) && sign !== 0;
    set('.orbit-velocity', { d: `M${bx} ${by}L${ex} ${ey}`, opacity: showTangent ? 1 : 0, stroke: s.focus === 'momentum' ? '#d1af8c' : '#86cec0' });
    const label = set('.orbit-vector-label', { x: ex + tx * 16, y: ey + ty * 16 + 5, opacity: showTangent ? 1 : 0 }); label.textContent = s.focus === 'momentum' ? 'p' : 'v';
    set('.orbit-right-angle', { d: `M${bx-c*13} ${by+sn*13}l${tx*13} ${ty*13}l${c*13} ${-sn*13}`, opacity: showTangent ? .9 : 0 });
    const normal = ['angular_velocity','angular_momentum','overview'].includes(s.focus) && sign !== 0;
    set('.orbit-normal', { opacity: normal ? 1 : 0 });
    this.host.querySelector('.orbit-normal text').textContent = s.focus === 'angular_velocity' ? 'ω' : 'L';
    set('.orbit-normal-dot', { opacity: sign > 0 ? 1 : 0 });
    set('.orbit-normal-mark', { d: sign < 0 ? 'M315 225l10 10M315 235l10 -10' : '' });
    this.host.querySelector('.orbit-normal-direction').textContent = sign < 0 ? 'into the screen' : 'out of the screen';
    const points = Array.from({ length: 20 }, (_,i) => { const a = s.theta - sign * (20-i) * .025; return `${320+radius*Math.cos(a)} ${230-radius*Math.sin(a)}`; });
    set('.orbit-trail', { d: 'M'+points.join('L'), opacity: sign ? 1 : 0 });
    const exploring = Math.abs(s.radius-this.spec.givens.radius)>1e-9 || Math.abs(s.omega-this.spec.givens.omega)>1e-9 ||
      (this.spec.fixed_position && Math.abs(Math.atan2(Math.sin(s.theta-this.spec.givens.theta),Math.cos(s.theta-this.spec.givens.theta)))>1e-7);
    this.host.querySelector('.orbit-mode').textContent = exploring ? 'Exploring · changed from the problem' : this.spec.scenario === 'turn' ? 'Your turn' : '';
    const value = s.focus === 'radius' ? [`r = ${fmt(s.radius)}`, 'm', 'Distance from the center'] :
      s.focus === 'velocity' ? [`v = ${fmt(q.speed)}`, 'm/s', 'Tangent to the circle'] :
      s.focus === 'momentum' ? [`p = ${fmt(s.mass*q.speed)}`, 'kg·m/s', 'Mass × velocity'] :
      s.focus === 'angular_velocity' ? [`ωz = ${fmt(s.omega)}`, 'rad/s', s.omega > 0 ? 'Counterclockwise → +z' : s.omega < 0 ? 'Clockwise → −z' : 'No rotation'] :
      [`Lz = ${fmt(q.Lz)}`, 'kg·m²/s', q.Lz === 0 ? 'No rotation' : q.Lz > 0 ? 'Counterclockwise → +z' : 'Clockwise → −z'];
    const hideResult = !this.spec.show_results && s.focus !== 'radius';
    this.host.querySelector('.orbit-readout').innerHTML = `<span>${hideResult ? esc(names[s.focus]) : esc(value[0]) + ` <small>${value[1]}</small>`}</span><small>${hideResult ? 'Use the motion to reason it out' : esc(value[2])}</small>`;
    // Keep the click target stable between pointer-down and pointer-up while animating.
    if (this.renderedPlaying !== this.playing) {
      this.host.querySelector('.orbit-play').innerHTML = this.playing ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10M13 5v10"/></svg>' : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4l9 6-9 6z"/></svg>';
      this.host.querySelector('.orbit-play').setAttribute('aria-label', this.playing ? 'Pause motion' : 'Play motion');
      this.renderedPlaying = this.playing;
    }
    this.host.querySelector('select').value = s.focus;
    this.host.querySelectorAll('[data-input]').forEach(x => { x.value = s[x.dataset.input]; });
    const ro = this.host.querySelector('[data-radius]'), wo = this.host.querySelector('[data-omega]');
    if(ro) ro.textContent = fmt(s.radius)+' m'; if(wo) wo.textContent = fmt(s.omega)+' rad/s';
    this.host.dataset.theta = s.theta; this.host.dataset.focus = s.focus;
  }
  animate() {
    if (this.frame || this.dead || !this.playing || !this.visible) return;
    this.frame = requestAnimationFrame(now => {
      this.frame = null;
      if (this.dead || !this.visible || !this.playing) return;
      if (this.last != null) this.state.theta = (this.state.theta + this.state.omega * Math.min((now-this.last)/1000,.1) * .25) % (2*Math.PI);
      this.last = now; this.render(); this.animate();
    });
  }
  focus(focus) { if (!names[focus] || this.locked) return; if (!this.spec.show_results && focus !== 'radius') this.assisted = true; this.state.focus = focus; this.playing = false; this.render(); }
  snapshot() { this.playing = false; this.render(); return { scenario:this.spec.scenario, radius:this.state.radius, omega:this.state.omega, theta:this.state.theta, focus:this.state.focus, playing:false, used_visual_help:this.assisted }; }
  sync(spec, reset=false) {
    if (reset) { this.state = {...spec.state}; this.playing = false; }
    this.spec = spec; this.render();
  }
  lock(value) { this.locked = !!value; this.host.querySelectorAll('button,input,select').forEach(b=>b.disabled=this.locked); if (value) { this.playing=false; this.render(); } }
  dispose() { this.dead=true; cancelAnimationFrame(this.frame); this.observer?.disconnect(); this.resizeObserver?.disconnect(); }
}
function specMass(spec) { return fmt(spec.givens.mass); }
