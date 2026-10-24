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
