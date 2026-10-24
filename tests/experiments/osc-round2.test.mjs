import test from 'node:test';
import assert from 'node:assert/strict';
import {decomposition,sineModel,view as pendulum} from '../../static/js/experiments/pendulum/view.js';
import {model} from '../../static/js/experiments/pendulum/model.js';
import {forceLaw,forceLawLines} from '../../static/js/experiments/motion-generator/view.js';
import {linePlot} from '../../static/js/experiments/motion-generator/view-tools.js';

test('pendulum: every breakdown number follows the chosen sine model', () => {
  for (const linear of ['exact', 'linear', 'cubic']) {
    const params = {...model.params.reduce((a, p) => ({...a, [p.key]: p.value}), {}), linear, theta0: 1};
    const inst = model.create(params), sample = inst.sample(), d = decomposition(params, sample);
    const I = params.mass * params.length ** 2;
    assert.ok(Math.abs(d.torque - I * sample.alpha) < 1e-9, linear);
    assert.ok(Math.abs(d.tangential * params.length - d.torque) < 1e-9, linear);
    assert.equal(d.sine, sineModel(linear, 1));
  }
  const base = model.params.reduce((a, p) => ({...a, [p.key]: p.value}), {});
  assert.equal(base.linear, 'exact');
  const frame = linear => { const params = {...base, linear}, inst = model.create(params); return {params, sample: inst.sample(), t: 0}; };
  assert.ok(!pendulum.equations(frame('cubic')).join(' ').includes('\sin'));
  assert.ok(pendulum.equations(frame('exact')).join(' ').includes('\sin'));
  assert.equal(pendulum.key(frame('cubic')), 'Model: sin \u03b8 \u2248 \u03b8 \u2212 \u03b8\u00b3/6');
  assert.equal(pendulum.key(frame('exact')), 'Rigid rod \u00b7 exact sine torque');
});

test('motion generator: law caption uses subscripts, typeset minus and wraps', () => {
  const p = {spring: 1, cubic: 0, constantRestoring: 2, gravity: 0, dimensions: '1d', linearDrag: 0.3, quadraticDrag: 0, inverseSquare: 0, magnetic: 0, forceX: 1, ramp: 0, drive: 1};
  const law = forceLaw(p);
  assert.ok(law.startsWith('F_{net,x} = '));
  assert.ok(law.includes('\u2212s sgn(x)') && !law.includes('-'));
  assert.ok(forceLawLines(p, 1000).length === 1 && forceLawLines(p, 200).length > 1);
  assert.equal(forceLawLines(p, 200).join(' ').replace(/\s+/g, ' ').trim(), law);
});

function fakeStage(w = 400, h = 220) {
  const texts = [], lines = [];
  const ctx = {measureText: t => ({width: String(t).length * 5}), save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}};
  return {w, h, ctx, labels: [], texts, lines, resize() {}, begin() {}, line: (...a) => lines.push(a), text(t, x, y) { texts.push(String(t)); }, circle() {}};
}
test('linePlot: round ticks with zero, not padded extremes', () => {
  const s = fakeStage(), points = Array.from({length: 50}, (_, i) => ({x: i * .1 - 2.5, y: .7 * Math.sin(i * .3)}));
  linePlot(s, {points, xlabel: 'x / m', ylabel: 'y / m'});
  assert.ok(s.texts.includes('0'), 'zero tick labeled');
  assert.ok(!s.texts.some(t => /^−?0\.868$/.test(t)));
  const numeric = s.texts.filter(t => /^[−0-9.]+$/.test(t));
  assert.ok(numeric.length >= 5);
  for (const t of numeric) assert.ok(t.replace('−', '').replace('.', '').length <= 3, t);
});

// Round 3: every substituted number in a force or torque equation carries its unit.
async function labFrame(id, values) {
  const {model: m} = await import('../../static/js/experiments/' + id + '/model.js'), {view} = await import('../../static/js/experiments/' + id + '/view.js');
  const params = Object.fromEntries(m.params.map(p => [p.key, values?.[p.key] ?? p.value])), instance = m.create(params);
  return {view, frame: {params, instance, t: 0, sample: instance.sample(), geometry: instance.geometry?.(), samples: [], breakdown: false, closeup: ''}};
}
const bareProduct = /\)\s*\(\s*-?[0-9.]+\s*\)/;

test('substituted equations show units in every factor', async () => {
  const pend = await labFrame('pendulum');
  const pl = pend.view.equations(pend.frame).join('\n');
  assert.ok(pl.includes(String.raw`-(1.00\,\mathrm{kg})(9.81\,\mathrm{m/s^2})\sin(1.00\,\mathrm{rad})`));
  assert.ok(pl.includes(String.raw`-(1.00\,\mathrm{kg})(9.81\,\mathrm{m/s^2})(1.00\,\mathrm{m})`)&&pl.includes(String.raw`\sin(1.00\,\mathrm{rad})`));
  assert.ok(pl.includes(String.raw`\cos(1.00\,\mathrm{rad})`));
  const mg = await labFrame('motion-generator', {spring: 1, x0: 1});
  const ml = mg.view.equations(mg.frame).join('\n');
  assert.ok(ml.includes(String.raw`-(1.00\,\mathrm{N/m})(1.00\,\mathrm{m})`));
  const an = await labFrame('anharmonic', {k: 1, quartic: 1, x0: 1});
  const al = an.view.equations(an.frame).join('\n');
  assert.ok(al.includes(String.raw`=-(1.00\,\mathrm{N/m})(1.00\,\mathrm{m})`)&&al.includes(String.raw`-(1.00\,\mathrm{N/m^3})(1.00\,\mathrm{m})^3`));
  for (const text of [pl, ml, al]) assert.ok(!bareProduct.test(text), text);
  const co = await labFrame('coupled-oscillators');
  assert.ok(co.view.closeupEquation(co.frame).join('\n').includes(String.raw`\mathrm{N/m}`));
});
