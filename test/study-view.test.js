import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSuppressMoves, samePosition } from '../src/content/study/study-view.js';

const target = { eco: 'B10', name: 'Caro-Kann' };
const move = { san: 'c6', uci: 'c7c6' };
const v = (extra) => ({ blocked: false, target, mode: 'try', revealed: false, move: null, engineState: 'idle', ...extra });

test('suppresses in Try mode while a move is hidden', () => {
  assert.equal(shouldSuppressMoves(v({ move })), true);
});

test('suppresses in Try mode while the engine move is pending', () => {
  assert.equal(shouldSuppressMoves(v({ engineState: 'pending' })), true);
});

test('does not suppress when there is nothing to reveal (wrong color, complete, syncing, bot turn)', () => {
  assert.equal(shouldSuppressMoves(v({})), false);
  assert.equal(shouldSuppressMoves(v({ engineState: 'unavailable' })), false);
});

test('does not suppress once revealed, in Show mode, without target, or when blocked', () => {
  assert.equal(shouldSuppressMoves(v({ move, revealed: true })), false);
  assert.equal(shouldSuppressMoves(v({ move, mode: 'show' })), false);
  assert.equal(shouldSuppressMoves(v({ move, target: null })), false);
  assert.equal(shouldSuppressMoves(v({ move, blocked: true })), false);
  assert.equal(shouldSuppressMoves(null), false);
});

test('samePosition compares piece placement and side to move only', () => {
  const a = 'rnbq1rk1/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w - - 6 5';
  const b = 'rnbq1rk1/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w KQkq - 0 1';
  assert.equal(samePosition(a, b), true);
  assert.equal(samePosition(a, a.replace(' w ', ' b ')), false);
  assert.equal(samePosition(a, null), false);
  assert.equal(samePosition(undefined, undefined), false);
});
