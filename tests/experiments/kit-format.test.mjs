import test from 'node:test';
import assert from 'node:assert/strict';
import {num,texNum,withUnit} from '../../static/js/experiments/kit/format.js';

test('num keeps three significant figures with a typeset minus', () => {
  assert.equal(num(9.81), '9.81');
  assert.equal(num(1), '1.00');
  assert.equal(num(-0.25), '−0.250');
  assert.equal(num(12345), '12345');
  assert.equal(num(0), '0');
  assert.equal(num(-1e-14), '0');
});

test('num writes powers of ten instead of e-notation', () => {
  assert.equal(num(-1.108e-4), '−1.11×10⁻⁴');
  assert.equal(num(6.67e10), '6.67×10¹⁰');
  assert.equal(num(2e30), '2.00×10³⁰');
  assert.ok(!/e[+-]?\d/.test(num(3.2e-7)));
});

test('texNum gives KaTeX-ready powers of ten', () => {
  assert.equal(texNum(-1.108e-4), '-1.11\\times10^{-4}');
  assert.equal(texNum(9.81), '9.81');
  assert.equal(texNum(0), '0');
});

test('withUnit joins value and unit', () => {
  assert.equal(withUnit(-0.631, 'N'), '−0.631 N');
  assert.equal(withUnit(4, ''), '4.00');
});

test('niceTicks picks round steps and includes zero in range', async () => {
  const {niceTicks} = await import('../../static/js/experiments/kit/format.js');
  assert.deepEqual(niceTicks(-0.37, 1.9), {step: 0.5, ticks: [0, 0.5, 1, 1.5]});
  assert.deepEqual(niceTicks(-3, 3, 4).ticks, [-2, 0, 2]);
  assert.deepEqual(niceTicks(0, 1e-4, 4).ticks, [0, 2e-5, 4e-5, 6e-5, 8e-5, 1e-4]);
  assert.ok(niceTicks(2, 2).ticks.length >= 1);
  assert.deepEqual(niceTicks(NaN, 1).ticks, []);
});
