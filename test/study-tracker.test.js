import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OpeningTree } from '../src/content/study/opening-tree.js';
import { evaluate } from '../src/content/study/study-tracker.js';
import { replay, legalMoves } from '../src/content/chess/game-state.js';

const tree = OpeningTree.build(JSON.parse(readFileSync(new URL('./fixtures/eco-sample.json', import.meta.url))));
const r = tree.search('alien')[0];
const target = { eco: r.eco, name: r.name, moves: r.sanMoves, fen: r.fen, color: 'w', mode: 'show' };

function pos(moves, userColor = 'w', synced = true) {
  const g = replay(moves);
  assert.ok(g.ok, 'test history must be legal');
  return { sanHistory: g.sanHistory, fen: g.fen, turn: g.fen.split(' ')[1], userColor, synced };
}
const ev = (moves, userColor, synced) => evaluate({ target, position: pos(moves, userColor, synced), tree });

const LINE = ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nf6', 'Ng5', 'h6', 'Nxf7'];

test('empty history: on-track, nextMove e4', () => {
  const s = ev([]);
  assert.equal(s.state, 'on-track');
  assert.deepEqual(s.nextMove, { san: 'e4', uci: 'e2e4', source: 'book' });
  assert.equal(s.message, 'On the Caro-Kann Defense: Alien Gambit line — your move.');
  assert.equal(s.predictedMove, null);
});

test('after 1.e4: opponent to move, predictedMove c6, awaiting', () => {
  const s = ev(['e4']);
  assert.equal(s.state, 'on-track');
  assert.equal(s.nextMove, null);
  assert.deepEqual(s.predictedMove, { san: 'c6', uci: 'c7c6' });
  assert.deepEqual(s.awaiting, ['1...c6', '2...d5', '3...dxe4', '4...Nf6', '5...h6']);
  assert.equal(s.message, 'Waiting for Black. The line needs 1...c6, 2...d5, 3...dxe4, 4...Nf6, 5...h6.');
});

test('after 1.e4 c6: nextMove d4', () => {
  const s = ev(['e4', 'c6']);
  assert.equal(s.state, 'on-track');
  assert.deepEqual(s.nextMove, { san: 'd4', uci: 'd2d4', source: 'book' });
});

test('full line: reached', () => {
  const s = ev(LINE);
  assert.equal(s.state, 'reached');
  assert.equal(s.message, "You're in the Caro-Kann Defense: Alien Gambit.");
  assert.equal(s.nextMove, null);
  assert.equal(s.predictedMove, null);
  assert.equal(s.userMovesPastTarget, 0);
  const t = ev([...LINE, 'Kxf7']);
  assert.equal(t.state, 'reached');
  assert.deepEqual(t.nextMove, { san: null, uci: null, source: 'engine-needed' });
  assert.equal(t.userMovesPastTarget, 0);
});

test('reached then continues: after the target plus 2 user moves, userMovesPastTarget === 2', () => {
  const s = ev([...LINE, 'Kxf7', 'Bc4+', 'e6', 'Nf3']);
  assert.equal(s.state, 'reached');
  assert.equal(s.userMovesPastTarget, 2);
  assert.equal(s.message, "You're in the Caro-Kann Defense: Alien Gambit.");
});

test('opponent-deviated on 3...e6', () => {
  const s = ev(['e4', 'c6', 'd4', 'd5', 'Nc3', 'e6']);
  assert.equal(s.state, 'opponent-deviated');
  assert.ok(s.newOpening.eco.startsWith('B1'));
  assert.match(s.message, /can't be reached/);
  assert.equal(s.message,
    "3...e6: now the Caro-Kann Defense (B15). Caro-Kann Defense: Alien Gambit can't be reached this game.");
  assert.equal(s.bookMove, 'dxe4');
  assert.deepEqual(s.nextMove, { san: null, uci: null, source: 'engine-needed' });
});

test('opponent-deviated with no named opening leaves the book', () => {
  const s = ev(['e4', 'a6']);
  assert.equal(s.state, 'opponent-deviated');
  assert.equal(s.newOpening, null);
  assert.equal(s.message, '1...a6 leaves the book.');
});

test('opponent-deviated names the new opening', () => {
  const s = ev(['e4', 'e6']);
  assert.equal(s.state, 'opponent-deviated');
  assert.deepEqual(s.newOpening, { eco: 'C00', name: 'French Defense' });
  assert.equal(s.message, "1...e6: now the French Defense (C00). Caro-Kann Defense: Alien Gambit can't be reached this game.");
});

test('after a deviation, book children of the current position guide the user', () => {
  const camp = tree.search('campomanes')[0];
  const t = { eco: camp.eco, name: camp.name, moves: camp.sanMoves, fen: camp.fen, color: 'w', mode: 'show' };
  const s = evaluate({ target: t, position: pos(['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4']), tree });
  assert.equal(s.state, 'opponent-deviated');
  assert.equal(s.bookMove, 'Nf6');
  assert.deepEqual(s.nextMove, { san: 'Nxe4', uci: 'c3e4', source: 'book' });
});

test('after a deviation with the opponent to move, predictedMove is the first book child', () => {
  const ex = tree.search('exchange')[0];
  const t = { eco: ex.eco, name: ex.name, moves: ex.sanMoves, fen: ex.fen, color: 'w', mode: 'show' };
  const s = evaluate({ target: t, position: pos(['e4', 'c6', 'd4', 'd5', 'Nc3']), tree });
  assert.equal(s.state, 'you-deviated');
  assert.equal(s.bookMove, 'exd5');
  assert.equal(s.nextMove, null);
  assert.deepEqual(s.predictedMove, { san: 'Nf6', uci: 'g8f6' });
});

test('you-deviated on 5.Nxf6+', () => {
  const s = ev(['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nf6', 'Nxf6+']);
  assert.equal(s.state, 'you-deviated');
  assert.equal(s.bookMove, 'Ng5');
  assert.equal(s.message, 'You left the line. The book move was Ng5.');
  assert.equal(s.nextMove, null);
});

test('deviation persists for later moves', () => {
  const s = ev(['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nf6', 'Nxf6+', 'exf6']);
  assert.equal(s.state, 'you-deviated');
  assert.equal(s.bookMove, 'Ng5');
  assert.equal(s.userMovesPastTarget, 1);
  assert.equal(s.nextMove.source, 'engine-needed');
});

test('wrong-color when userColor b', () => {
  const s = ev(['e4'], 'b');
  assert.equal(s.state, 'wrong-color');
  assert.equal(s.message, "Caro-Kann Defense: Alien Gambit is a White opening. You're Black this game.");
  assert.equal(s.nextMove, null);
});

test('syncing when synced false', () => {
  const s = ev(['e4'], 'b', false);
  assert.equal(s.state, 'syncing');
  assert.equal(s.message, 'Syncing with board…');
});

test('transposition re-entry: 1.d4 c6 2.e4 d5 → on-track, nextMove Nc3', () => {
  const s = ev(['d4', 'c6', 'e4', 'd5']);
  assert.equal(s.state, 'on-track');
  assert.deepEqual(s.nextMove, { san: 'Nc3', uci: 'b1c3', source: 'book' });
});

test('new game resets to on-track', () => {
  assert.equal(ev(['e4', 'e6']).state, 'opponent-deviated');
  const s = ev([]);
  assert.equal(s.state, 'on-track');
  assert.equal(s.nextMove.san, 'e4');
});

test('engine cap: userMovesPastTarget >= 10 → nextMove null, message Study line complete.', () => {
  const moves = [...LINE];
  let fen = replay(moves).fen;
  for (let i = 0; i < 20; i++) {
    const m = legalMoves(fen)[0];
    moves.push(m.san);
    fen = replay(moves).fen;
  }
  const s = ev(moves);
  assert.equal(s.state, 'reached');
  assert.ok(s.userMovesPastTarget >= 10);
  assert.equal(s.nextMove, null);
  assert.equal(s.message, 'Study line complete.');
  // One more ply puts the user to move: still capped.
  moves.push(legalMoves(fen)[0].san);
  const t = ev(moves);
  assert.equal(t.nextMove, null);
  assert.equal(t.message, 'Study line complete.');
});
