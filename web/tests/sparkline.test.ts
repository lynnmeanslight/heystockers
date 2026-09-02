import assert from 'node:assert/strict';
import test from 'node:test';
import { sparklinePoints } from '../lib/sparkline.ts';

test('sparklines need at least two positive points', () => {
  assert.equal(sparklinePoints([]), '');
  assert.equal(sparklinePoints([10]), '');
  assert.equal(sparklinePoints([0, -3]), '');
});

test('sparklines span the viewbox from oldest to newest', () => {
  const points = sparklinePoints([10, 20, 15]).split(' ');
  assert.equal(points.length, 3);
  assert.equal(points[0], '2.0,20.0');
  assert.equal(points[1], '36.0,2.0');
  assert.equal(points[2], '70.0,11.0');
});

test('flat series stay inside the viewbox instead of dividing by zero', () => {
  for (const coordinate of sparklinePoints([5, 5, 5]).split(' ')) {
    const [x, y] = coordinate.split(',').map(Number);
    assert.ok(x >= 0 && x <= 72 && y >= 0 && y <= 22);
  }
});
