import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OpeningTree } from '../src/content/study/opening-tree.js';
import { CoachController } from '../src/content/coach/coach-controller.js';
import { replay, sanToUci } from '../src/content/chess/game-state.js';

const tree = OpeningTree.build(JSON.parse(readFileSync(new URL('./fixtures/eco-sample.json', import.meta.url))));
const r = tree.search('alien')[0];
const target = { eco: r.eco, name: r.name, moves: r.sanMoves, fen: r.fen, color: 'w' };

function pos(moves, userColor = 'w') {
  const g = replay(moves);
  assert.ok(g.ok);
  return { sanHistory: g.sanHistory, fen: g.fen, turn: g.fen.split(' ')[1], userColor, synced: true };
}

function setup(overrides = {}) {
  const calls = { request: [], cancel: 0 };
  const requests = [];
  const timers = [];
  const updates = [];
  const c = new CoachController({
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
const tick = () => new Promise((res) => setTimeout(res, 0));
const OUT_OF_BOOK = ['a3', 'h6'];
const outLines = [
  { uci: 'e2e4', scoreText: '+0.4', depth: 14 },
  { uci: 'd2d4', scoreText: '+0.3', depth: 14 },
  { uci: 'g1f3', scoreText: '+0.2', depth: 14 },
];

test('rule 1 study move shown immediately', () => {
  const { c, calls } = setup();
  c.setTarget(target);
  c.setPosition(pos(['e4', 'c6']));
  assert.equal(c.view.card.kind, 'move');
  assert.equal(c.view.card.move.source, 'study');
  assert.equal(c.view.card.move.san, 'd4');
  assert.equal(c.view.card.move.uci, 'd2d4');
  assert.ok(c.view.card.move.explanation.text.length > 0);
  assert.equal(c.view.card.move.scoreText, null);
  assert.equal(calls.request.length, 1);
  assert.match(c.view.studyMessage, /Alien Gambit/);
});

test('rule 1 keeps study move and fills evaluation when lines arrive', async () => {
  const { c, requests } = setup();
  c.setTarget(target);
  c.setPosition(pos(['e4', 'c6']));
  requests[0].res([
    { uci: 'b1c3', scoreText: '+0.5', depth: 15 },
    { uci: 'd2d4', scoreText: '+0.4', depth: 15 },
    { uci: 'g1f3', scoreText: '+0.3', depth: 15 },
  ]);
  await tick();
  const card = c.view.card;
  assert.equal(card.kind, 'move');
  assert.equal(card.move.source, 'study');
  assert.equal(card.move.uci, 'd2d4');
  assert.equal(card.move.scoreText, '+0.4');
  assert.equal(card.move.depth, 15);
  assert.deepEqual(card.alternatives.map((a) => a.uci), ['b1c3', 'g1f3']);
  assert.deepEqual(card.alternatives.map((a) => a.san), ['Nc3', 'Nf3']);
});

test('rule 2 book move from engine lines', async () => {
  const { c, requests } = setup();
  const p = pos(['e4'], 'b');
  c.setPosition(p);
  assert.equal(c.view.card.kind, 'thinking');
  assert.equal(c.view.card.move, null);
  const bookUcis = tree.bookContinuations(tree.nodeForFen(p.fen)).map((x) => sanToUci(p.fen, x.san));
  assert.ok(!bookUcis.includes('g7g6'));
  assert.ok(bookUcis.includes('e7e6'));
  requests[0].res([
    { uci: 'g7g6', scoreText: '+0.5', depth: 12 },
    { uci: 'e7e6', scoreText: '+0.3', depth: 12 },
    { uci: 'c7c6', scoreText: '+0.3', depth: 12 },
  ]);
  await tick();
  assert.equal(c.view.card.kind, 'move');
  assert.equal(c.view.card.move.source, 'book');
  assert.equal(c.view.card.move.uci, 'e7e6');
  assert.equal(c.view.card.move.san, 'e6');
  assert.equal(c.view.card.move.scoreText, '+0.3');
  assert.equal(c.view.studyMessage, null);
});

test('rule 3 engine move', async () => {
  const { c, requests } = setup();
  c.setPosition(pos(OUT_OF_BOOK));
  requests[0].res(outLines);
  await tick();
  const m = c.view.card.move;
  assert.equal(c.view.card.kind, 'move');
  assert.equal(m.source, 'engine');
  assert.equal(m.uci, outLines[0].uci);
  assert.equal(m.san, 'e4');
  assert.equal(m.scoreText, '+0.4');
  assert.equal(m.depth, 14);
  assert.ok(!m.explanation.text.includes('+0.4')); // R6: the score shows only in the card's score line
  assert.ok(m.explanation.text.length > 0);
});

test('engine results are cached by position', async () => {
  const { c, calls, requests } = setup();
  c.setPosition(pos(OUT_OF_BOOK));
  requests[0].res(outLines);
  await tick();
  c.setPosition(pos(OUT_OF_BOOK));
  assert.equal(calls.request.length, 1);
  assert.equal(c.view.card.move.source, 'engine');
});

test('alternatives exclude chosen and max 2', async () => {
  const { c, requests } = setup();
  c.setPosition(pos(OUT_OF_BOOK));
  requests[0].res([...outLines, { uci: 'c2c4', scoreText: '+0.1', depth: 14 }, { uci: 'e2e4', scoreText: '+0.4', depth: 14 }]);
  await tick();
  const alts = c.view.card.alternatives;
  assert.equal(alts.length, 2);
  assert.ok(!alts.some((a) => a.uci === 'e2e4'));
  assert.deepEqual(alts, [{ san: 'd4', uci: 'd2d4' }, { san: 'Nf3', uci: 'g1f3' }]);
});

test("bot's turn: waiting, no request", () => {
  const { c, calls } = setup();
  c.setTarget(target);
  c.setPosition(pos(['e4']));
  assert.equal(c.view.card.kind, 'waiting');
  assert.equal(c.view.card.move, null);
  assert.equal(c.view.predictedUci, 'c7c6');
  assert.equal(calls.request.length, 0);
});

test('stale lines after turn change are ignored', async () => {
  const { c, calls, requests } = setup();
  c.setTarget(target);
  c.setPosition(pos(['e4', 'c6']));
  assert.equal(calls.request.length, 1);
  c.setPosition(pos(['e4', 'c6', 'd4']));
  assert.equal(calls.cancel, 1);
  requests[0].res([{ uci: 'd2d4', scoreText: '+0.4', depth: 15 }]);
  await tick();
  assert.equal(c.view.card.kind, 'waiting');
  assert.equal(c.view.card.move, null);
  // A stale result is never cached: returning to the old position asks again.
  c.setPosition(pos(['e4', 'c6']));
  assert.equal(calls.request.length, 2);
});

test('game over: no request, Game over card', () => {
  const { c, calls } = setup();
  c.setPosition(pos(['f3', 'e5', 'g4', 'Qh4#']));
  assert.equal(c.view.card.kind, 'gameover');
  assert.equal(c.view.card.move, null);
  assert.equal(calls.request.length, 0);
});

test('wrong color falls through to book/engine', async () => {
  const { c, calls, requests } = setup();
  c.setTarget(target);
  c.setPosition(pos(['e4'], 'b'));
  assert.match(c.view.studyMessage, /is a White opening/);
  assert.equal(c.view.card.kind, 'thinking');
  assert.equal(calls.request.length, 1);
  requests[0].res([{ uci: 'e7e6', scoreText: '+0.3', depth: 12 }, { uci: 'g7g6', scoreText: '+0.5', depth: 12 }]);
  await tick();
  assert.ok(['book', 'engine'].includes(c.view.card.move.source));
  assert.equal(c.view.card.move.source, 'book');
});

test('illegal engine uci → unavailable', async () => {
  const { c, calls, requests } = setup();
  c.setPosition(pos(OUT_OF_BOOK));
  requests[0].res([{ uci: 'e2e5', scoreText: '+9', depth: 3 }]);
  await tick();
  assert.equal(c.view.card.kind, 'unavailable');
  assert.equal(c.view.card.move, null);
  // Not cached: the next visit retries.
  c.setPosition(pos(['a3']));
  c.setPosition(pos(OUT_OF_BOOK));
  assert.equal(calls.request.length, 2);
});

test('engine rejection → unavailable', async () => {
  const { c, requests } = setup();
  c.setPosition(pos(OUT_OF_BOOK));
  requests[0].rej(new Error('boom'));
  await tick();
  assert.equal(c.view.card.kind, 'unavailable');
});

test('no tree: engine-only', async () => {
  const { c, requests } = setup({ tree: null });
  c.setTarget(target);
  c.setPosition(pos(['e4'], 'b'));
  assert.equal(c.view.studyMessage, null);
  assert.equal(c.view.openingName, null);
  requests[0].res([{ uci: 'c7c6', scoreText: '+0.3', depth: 12 }]);
  await tick();
  assert.equal(c.view.card.move.source, 'engine');
  assert.equal(c.view.card.move.uci, 'c7c6');
});

test('setTree recomputes the view', async () => {
  const { c, calls, requests } = setup({ tree: null });
  c.setTarget(target);
  c.setPosition(pos(['e4', 'c6']));
  assert.equal(c.view.card.kind, 'thinking');
  c.setTree(tree);
  assert.equal(c.view.card.kind, 'move');
  assert.equal(c.view.card.move.source, 'study');
  assert.equal(c.view.openingName, 'Caro-Kann Defense');
  // The pending request for the same position is kept, not restarted.
  assert.equal(calls.request.length, 1);
  requests[0].res([{ uci: 'd2d4', scoreText: '+0.4', depth: 15 }]);
  await tick();
  assert.equal(c.view.card.move.scoreText, '+0.4');
});

test('timeout → unavailable, study move kept', () => {
  const s = setup();
  s.c.setTarget(target);
  s.c.setPosition(pos(['e4', 'c6']));
  assert.equal(s.timers[0].ms, 30000);
  s.timers[0].fn();
  assert.equal(s.c.view.card.kind, 'move');
  assert.equal(s.c.view.card.move.source, 'study');
  assert.equal(s.c.view.card.move.san, 'd4');
  assert.equal(s.calls.cancel, 1);

  const t = setup();
  t.c.setPosition(pos(OUT_OF_BOOK));
  const n = t.updates.length;
  t.timers[0].fn();
  assert.equal(t.c.view.card.kind, 'unavailable');
  assert.equal(t.c.view.card.move, null);
  assert.ok(t.updates.length > n);
  assert.equal(t.calls.cancel, 1);
});

test('engine loading shows loading on a thinking card only', () => {
  const { c } = setup();
  c.setPosition(pos(OUT_OF_BOOK));
  c.setEngineLoading(true);
  assert.equal(c.view.card.kind, 'loading');
  c.setEngineLoading(false);
  assert.equal(c.view.card.kind, 'thinking');
  c.setTarget(target);
  c.setPosition(pos(['e4', 'c6']));
  c.setEngineLoading(true);
  assert.equal(c.view.card.kind, 'move');
});

test('syncing when not synced', () => {
  const { c, calls } = setup();
  c.setPosition({ ...pos(['e4']), synced: false });
  assert.equal(c.view.card.kind, 'syncing');
  assert.equal(calls.request.length, 0);
});

test('blocked: no request, blocked view', () => {
  const { c, calls } = setup();
  c.setPosition(pos(OUT_OF_BOOK));
  assert.equal(calls.request.length, 1);
  c.setBlocked(true);
  assert.equal(c.view.blocked, true);
  assert.equal(c.view.card.kind, 'idle');
  assert.equal(c.view.card.move, null);
  assert.equal(c.view.predictedUci, null);
  assert.equal(calls.cancel, 1);
  c.setPosition(pos(['a3', 'h6', 'e4', 'e5']));
  assert.equal(calls.request.length, 1);
  assert.equal(c.view.card.kind, 'idle');
});

test('no position: idle view', () => {
  const { c } = setup();
  assert.equal(c.view.card.kind, 'idle');
  assert.equal(c.view.blocked, false);
  assert.deepEqual(c.view.card.alternatives, []);
});
