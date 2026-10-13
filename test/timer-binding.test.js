import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContextGate } from '../src/content/context/context-gate.js';
import { StudyController } from '../src/content/study/study-controller.js';
import { CoachController } from '../src/content/coach/coach-controller.js';

// Browsers throw "Illegal invocation" when timer functions are called as a method of
// another object (this !== globalThis/undefined). Node does not, so emulate the browser.
function browserLike(fn) {
  return function (...args) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return fn(...args);
  };
}

test('ContextGate calls its timer functions unbound (browser-safe)', () => {
  const gate = new ContextGate({
    getUrl: () => 'https://www.chess.com/play/computer',
    onChange: () => {},
    setIntervalFn: browserLike(() => 1),
    clearIntervalFn: browserLike(() => {}),
  });
  assert.doesNotThrow(() => { gate.start(); gate.stop(); });
});

test('StudyController calls its timer functions unbound (browser-safe)', () => {
  const ctrl = new StudyController({
    tree: { nodeForFen: () => null, nodeForMoves: () => null, deepestNamed: () => null, bookContinuations: () => [] },
    notes: {},
    requestEngine: () => new Promise(() => {}),
    cancelEngine: () => {},
    onUpdate: () => {},
    setTimeoutFn: browserLike(() => 1),
    clearTimeoutFn: browserLike(() => {}),
  });
  // Arm the engine timeout, then cancel it (clears the timeout).
  assert.doesNotThrow(() => {
    ctrl._startEngine('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'k');
    ctrl._cancelPending();
  });
});

test('CoachController calls its timer functions unbound (browser-safe)', () => {
  const ctrl = new CoachController({
    tree: null,
    notes: {},
    requestEngine: () => new Promise(() => {}),
    cancelEngine: () => {},
    onUpdate: () => {},
    setTimeoutFn: browserLike(() => 1),
    clearTimeoutFn: browserLike(() => {}),
  });
  // Arm the engine timeout on the user's turn, then cancel it by blocking.
  assert.doesNotThrow(() => {
    ctrl.setPosition({
      sanHistory: [], fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      turn: 'w', userColor: 'w', synced: true
    });
    ctrl.setBlocked(true);
  });
});
