import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OpeningTree } from '../src/content/study/opening-tree.js';
import { StudyController } from '../src/content/study/study-controller.js';
import { replay } from '../src/content/chess/game-state.js';

const tree = OpeningTree.build(JSON.parse(readFileSync(new URL('./fixtures/eco-sample.json', import.meta.url))));
const r = tree.search('alien')[0];
const target = { eco: r.eco, name: r.name, moves: r.sanMoves, fen: r.fen, color: 'w', mode: 'show' };

function pos(moves, userColor = 'w') {
  const g = replay(moves);
  assert.ok(g.ok);
  return { sanHistory: g.sanHistory, fen: g.fen, turn: g.fen.split(' ')[1], userColor, synced: true };
}

const BEYOND = ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nf6', 'Ng5', 'h6', 'Nxf7', 'Kxf7', 'Nf3']; // book exhausted

function setup(overrides = {}) {
  const calls = { request: [], cancel: 0 };
  const requests = [];
  const timers = [];
  const updates = [];
  const c = new StudyController({
    tree, notes: {},
    requestEngine: (fen) => { calls.request.push(fen); return new Promise((res, rej) => requests.push({ res, rej })); },
    cancelEngine: () => { calls.cancel++; },
    onUpdate: (v) => updates.push(v),
    setTimeoutFn: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1; },
    clearTimeoutFn: (id) => { if (timers[id]) timers[id].cleared = true; },
    ...overrides
  });
  return { c, calls, requests, timers, updates };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const engineResult = { uci: 'g1f3', scoreText: '+0.3', depth: 12 };

// Find a position where the tracker asks for the engine.
function engineHistory() {
  const { c } = setup();
  c.setTarget(target);
  for (const h of [BEYOND, BEYOND.slice(0, 12), ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nf6', 'Ng5', 'h6', 'Nxf7', 'Kxf7']]) {
    c.setPosition(pos(h));
    if (c.view.status && c.view.status.nextMove && c.view.status.nextMove.source === 'engine-needed') return h;
  }
  throw new Error('no engine-needed history found');
}

test('book move is explained', () => {
  const { c } = setup();
  c.setTarget(target);
  c.setPosition(pos([]));
  assert.equal(c.view.move.san, 'e4');
  assert.ok(['notes', 'book'].includes(c.view.move.source));
  assert.ok(c.view.move.explanation.text.length > 0);
  assert.equal(c.view.revealed, true);
});

test('setTarget(null) clears view', () => {
  const { c } = setup();
  c.setTarget(target);
  c.setPosition(pos([]));
  c.setTarget(null);
  assert.equal(c.view.target, null);
  assert.equal(c.view.status, null);
  assert.equal(c.view.move, null);
});

test('engine-needed requests once and caches', async () => {
  const h = engineHistory();
  const { c, calls, requests } = setup();
  c.setTarget(target);
  c.setPosition(pos(h));
  assert.equal(c.view.engineState, 'pending');
  assert.equal(calls.request.length, 1);
  requests[0].res(engineResult);
  await tick();
  assert.equal(c.view.engineState, 'idle');
  assert.equal(c.view.move.source, 'engine');
  assert.equal(c.view.move.uci, 'g1f3');
  c.setPosition(pos(h));
  assert.equal(calls.request.length, 1);
  assert.equal(c.view.move.source, 'engine');
});

test('stale engine result is discarded', async () => {
  const h = engineHistory();
  const { c, calls, requests } = setup();
  c.setTarget(target);
  c.setPosition(pos(h));
  c.setPosition(pos([]));
  assert.equal(calls.cancel, 1);
  requests[0].res(engineResult);
  await tick();
  assert.equal(c.view.move.source !== 'engine', true);
  assert.equal(c.view.move.san, 'e4');
});

test('timeout marks engine unavailable', () => {
  const h = engineHistory();
  const { c, timers, updates, calls } = setup();
  c.setTarget(target);
  c.setPosition(pos(h));
  assert.equal(timers[0].ms, 8000);
  const n = updates.length;
  timers[0].fn();
  assert.equal(c.view.engineState, 'unavailable');
  assert.equal(c.view.move, null);
  assert.ok(updates.length > n);
  assert.equal(calls.cancel, 1);
});

test('try mode hides until revealHint', () => {
  const { c } = setup();
  c.setTarget({ ...target, mode: 'try' });
  c.setPosition(pos([]));
  assert.equal(c.view.revealed, false);
  c.revealHint();
  assert.equal(c.view.revealed, true);
  c.setPosition(pos(['e4', 'c6']));
  assert.equal(c.view.revealed, false);
});

test('blocked clears guidance and cancels', () => {
  const h = engineHistory();
  const { c, calls } = setup();
  c.setTarget(target);
  c.setPosition(pos(h));
  c.setBlocked(true);
  assert.equal(c.view.blocked, true);
  assert.equal(c.view.move, null);
  assert.equal(c.view.predictedUci, null);
  assert.equal(calls.cancel, 1);
});

test('you-deviated shows book move explanation', () => {
  const { c } = setup();
  c.setTarget({ ...target, mode: 'try' });
  c.setPosition(pos(['d4']));
  assert.equal(c.view.status.state, 'you-deviated');
  assert.equal(c.view.move.san, 'e4');
  assert.equal(c.view.move.uci, 'e2e4');
  assert.equal(c.view.revealed, true);
  assert.ok(c.view.move.explanation.text.length > 0);
});

// ---- regression tests (fix round 1) ----
const H1 = ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nf6', 'Ng5', 'h6', 'Nxf7', 'Kxf7'];
const H2 = [...H1, 'Nf3', 'e5'];
const needsEngine = (c, h) => { c.setPosition(pos(h)); return c.view.engineState === 'pending'; };

test('engine histories are distinct engine-needed positions', () => {
  const { c } = setup();
  c.setTarget(target);
  assert.ok(needsEngine(c, H1));
  assert.ok(needsEngine(c, H2));
});

test('blocked then engine-needed position: no guidance, no request', () => {
  const { c, calls } = setup();
  c.setTarget(target);
  c.setBlocked(true);
  c.setPosition(pos(H1));
  assert.equal(c.view.move, null);
  assert.equal(c.view.predictedUci, null);
  assert.equal(calls.request.length, 0);
});

test('timers are cleared on resolve, new position, block and target reset', async () => {
  let s = setup();
  s.c.setTarget(target); s.c.setPosition(pos(H1));
  s.requests[0].res(engineResult);
  await tick();
  assert.equal(s.timers[0].cleared, true);

  s = setup();
  s.c.setTarget(target); s.c.setPosition(pos(H1)); s.c.setPosition(pos([]));
  assert.equal(s.timers[0].cleared, true);

  s = setup();
  s.c.setTarget(target); s.c.setPosition(pos(H1)); s.c.setBlocked(true);
  assert.equal(s.timers[0].cleared, true);

  s = setup();
  s.c.setTarget(target); s.c.setPosition(pos(H1)); s.c.setTarget(null);
  assert.equal(s.timers[0].cleared, true);
  assert.equal(s.calls.cancel, 1);
});

test('stale timeout callback does not affect a newer request', () => {
  const { c, timers } = setup();
  c.setTarget(target);
  c.setPosition(pos(H1));
  c.setPosition(pos(H2));
  assert.equal(c.view.engineState, 'pending');
  timers[0].fn();
  assert.equal(c.view.engineState, 'pending');
});

test('overlapping requests: only the current one applies', async () => {
  const { c, requests, calls } = setup();
  c.setTarget(target);
  c.setPosition(pos(H1));
  c.setPosition(pos(H2));
  assert.equal(calls.request.length, 2);
  requests[0].res({ uci: 'g1f3', scoreText: 'A', depth: 1 });
  await tick();
  assert.equal(c.view.engineState, 'pending');
  assert.equal(c.view.move, null);
  const bUci = 'h2h3';
  requests[1].res({ uci: bUci, scoreText: 'B', depth: 2 });
  await tick();
  assert.equal(c.view.move.uci, bUci);
  assert.equal(c.view.engineState, 'idle');
});

test('invalid engine result or rejected request marks unavailable', async () => {
  let s = setup();
  s.c.setTarget(target); s.c.setPosition(pos(H1));
  s.requests[0].res({ uci: 'a1a8', scoreText: 'x', depth: 1 });
  await tick();
  assert.equal(s.c.view.engineState, 'unavailable');

  s = setup();
  s.c.setTarget(target); s.c.setPosition(pos(H1));
  s.requests[0].rej(new Error('boom'));
  await tick();
  assert.equal(s.c.view.engineState, 'unavailable');
});

test('stale result is not cached', async () => {
  const { c, requests, calls } = setup();
  c.setTarget(target);
  c.setPosition(pos(H1));
  c.setPosition(pos([]));
  requests[0].res(engineResult);
  await tick();
  c.setPosition(pos(H1));
  assert.equal(calls.request.length, 2);
});

test('setMode / revealHint while pending do not cancel the request', async () => {
  const { c, requests, calls } = setup();
  c.setTarget(target);
  c.setPosition(pos(H1));
  c.setMode('try');
  c.revealHint();
  assert.equal(calls.cancel, 0);
  assert.equal(c.view.engineState, 'pending');
  requests[0].res(engineResult);
  await tick();
  assert.equal(c.view.move.source, 'engine');
  assert.equal(c.view.revealed, true);
});

test('fulfilment-path exception does not become unhandled rejection', async () => {
  let throwNow = false;
  const { c, requests } = setup({ onUpdate: () => { if (throwNow) throw new Error('ui'); } });
  c.setTarget(target);
  c.setPosition(pos(H1));
  throwNow = true;
  requests[0].res(engineResult);
  await tick(); // an unhandled rejection would fail the test run
});
