/**
 * Negative controls for tests/helpers/contrast-math.mjs (Stage B).
 * Pure math, no browser: proves the gate's decision logic fails closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCssColor,
  compositeOver,
  resolveBackground,
  ratio,
  isLargeText,
} from '../../tests/helpers/contrast-math.mjs';

test('intentionally low-contrast text fails the 4.5 threshold', () => {
  const r = ratio([136, 136, 136], [255, 255, 255]); // #888 on white
  assert.ok(r < 4.5, `expected a failing ratio, got ${r}`);
  assert.ok(r > 3, '...but not absurdly low (sanity of the math)');
});

test('alpha compositing blends the whole stack, not the first opaque guess', () => {
  // rgba(0,0,0,0.5) over white must composite to mid-grey (~3.95:1),
  // which a "first non-transparent ancestor is opaque" shortcut would
  // misreport if the ancestor itself were translucent.
  const bg = resolveBackground([[0, 0, 0, 0.5], [255, 255, 255, 1]]);
  assert.deepEqual(bg.color.map(Math.round), [128, 128, 128]);
  const r = ratio([255, 255, 255], bg.color);
  assert.ok(r > 3.5 && r < 4.5, `composited ratio ${r} must sit near 3.95`);
  // Two translucent layers over a base: order matters, both apply.
  const two = resolveBackground([[255, 0, 0, 0.5], [0, 0, 255, 0.5], [255, 255, 255, 1]]);
  assert.ok(!two.manual, 'resolvable stack must not be MANUAL_REVIEW');
  assert.ok(two.color[0] > two.color[2], 'red layer must dominate the blend');
});

test('a stack with no opaque base is MANUAL_REVIEW, never a ratio', () => {
  const r = resolveBackground([[0, 0, 0, 0.5], [255, 255, 255, 0.9]]);
  assert.ok(r.manual, 'must refuse to invent a ratio without a base');
  assert.equal(resolveBackground([]).manual, 'empty background stack');
  assert.ok(resolveBackground([null]).manual, 'unparsable layer must refuse');
});

test('unparsable colors fail loudly at the call site', () => {
  assert.equal(parseCssColor(null), null);
  assert.equal(parseCssColor('currentcolor'), null);
  assert.deepEqual(parseCssColor('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(parseCssColor('rgba(10, 20, 30, 0.5)'), [10, 20, 30, 0.5]);
});

test('large-text boundary follows WCAG sizes', () => {
  assert.equal(isLargeText(24, '400'), true);
  assert.equal(isLargeText(19, '700'), true);
  assert.equal(isLargeText(19, '400'), false);
  assert.equal(isLargeText(16, '700'), false);
});

test('compositeOver clamps alpha and blends endpoints', () => {
  assert.deepEqual(compositeOver([0, 0, 0, 1], [255, 255, 255]), [0, 0, 0]);
  assert.deepEqual(compositeOver([0, 0, 0, 0], [255, 255, 255]), [255, 255, 255]);
});
