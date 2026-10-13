import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samePosition } from '../src/content/study/study-view.js';

test('samePosition compares piece placement and side to move only', () => {
  const a = 'rnbq1rk1/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w - - 6 5';
  const b = 'rnbq1rk1/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w KQkq - 0 1';
  assert.equal(samePosition(a, b), true);
  assert.equal(samePosition(a, a.replace(' w ', ' b ')), false);
  assert.equal(samePosition(a, null), false);
  assert.equal(samePosition(undefined, undefined), false);
});
