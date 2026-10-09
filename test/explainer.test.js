import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../src/content/study/explainer.js';
import { replay, normalizeFen, START_FEN } from '../src/content/chess/game-state.js';

test('Nf3 develops and controls center', () => {
  const r = explain({ fen: START_FEN, san: 'Nf3' });
  assert.equal(r.source, 'book');
  assert.ok(r.phrases.includes('Develops the knight.'));
  assert.ok(r.phrases.includes('Controls d4 and e5.'));
});
test('Nxf7 in the Alien Gambit is a sacrifice', () => {
  const fen = replay(['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nf6','Ng5','h6']).fen;
  assert.ok(explain({ fen, san: 'Nxf7' }).phrases.includes('Gives up a knight for a pawn.'));
});
test('notes take priority', () => {
  const fen = replay(['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nf6']).fen;
  const notes = { [normalizeFen(fen)]: { moves: { Ng5: 'Alien note.' }, plan: 'Plan.' } };
  const r = explain({ fen, san: 'Ng5', notes });
  assert.equal(r.source, 'notes'); assert.equal(r.phrases[0], 'Alien note.'); assert.equal(r.nextObjective, 'Plan.');
});
test('detects opponent threat', () => {
  // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4?  White to move; does Black threaten Nxf3+?
  const fen = replay(['e4','e5','Nf3','Nc6','Bc4','Nd4']).fen;
  assert.match(explain({ fen, san: 'Nxd4' }).threat ?? '', /Black threatens Nxf3\+/);
});
test('engine suffix and source', () => {
  const r = explain({ fen: START_FEN, san: 'e4', engine: { scoreText: '+0.30', depth: 16 } });
  assert.equal(r.source, 'engine'); assert.match(r.text, /\+0\.30 at depth 16\./);
});
test('no trap text without notes', () => assert.doesNotMatch(explain({ fen: START_FEN, san: 'e4' }).text, /trap/i));

// Ruling R9 cases beyond the brief.
test('castling move says Castles.', () => {
  const fen = replay(['e4','e5','Nf3','Nc6','Bc4','Bc5']).fen;
  const r = explain({ fen, san: 'O-O' });
  assert.ok(r.phrases.includes('Castles.'));
  assert.equal(r.text, r.phrases.join(' '));
});
test('Castle next. when castling becomes available', () => {
  const fen = replay(['e4','e5','Nf3','Nc6']).fen;
  assert.equal(explain({ fen, san: 'Bc4' }).nextObjective, 'Castle next.');
});
test('Develop your remaining minor pieces. when castling is not yet possible', () => {
  assert.equal(explain({ fen: START_FEN, san: 'e4' }).nextObjective, 'Develop your remaining minor pieces.');
});
test('Connect your rooks. after castling with minors developed', () => {
  const fen = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1';
  // c1 bishop still home -> develop; move it first
  const fen2 = 'r1bqk2r/pppp1ppp/2n2n2/2b1p1B1/2B1P3/2NP1N2/PPP2PPP/R2QK2R w KQkq - 0 1';
  assert.equal(explain({ fen, san: 'O-O' }).nextObjective, 'Develop your remaining minor pieces.');
  assert.equal(explain({ fen: fen2, san: 'O-O' }).nextObjective, 'Connect your rooks.');
});
test('even capture says Captures a pawn. not Gives up', () => {
  const fen = replay(['e4','d5']).fen;
  const r = explain({ fen, san: 'exd5' });
  assert.ok(r.phrases.includes('Captures a pawn.'));
  assert.ok(!r.phrases.some((p) => p.startsWith('Gives up')));
});
test('sacrifice emits only the Gives up phrase', () => {
  const fen = replay(['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nf6','Ng5','h6']).fen;
  assert.ok(!explain({ fen, san: 'Nxf7' }).phrases.some((p) => p.startsWith('Captures')));
});
test('a defended pawn push is not called a sacrifice', () => {
  const fen = replay(['e4','e5','Nf3','Nc6']).fen;
  assert.ok(!explain({ fen, san: 'd4' }).phrases.some((p) => p.startsWith('Gives up')));
});
test('phrases cap at 3, engine suffix appended after the cap', () => {
  const fen = replay(['e4','e5','Nf3','Nc6']).fen;
  const notes = { [normalizeFen(fen)]: { moves: { Bc4: 'Italian.' } } };
  const engine = { scoreText: '+0.40', depth: 12 };
  const r = explain({ fen, san: 'Bc4', notes, engine });
  assert.equal(r.source, 'notes');
  assert.equal(r.phrases.length, 4);
  assert.deepEqual(r.phrases.slice(0, 3), ['Italian.', 'Develops the bishop.', 'Controls d5.']);
  assert.equal(r.phrases[3], '+0.40 at depth 12.');
});
test('notes SAN keys match after canonicalizing the san argument', () => {
  const fen = replay(['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nf6','Ng5','h6']).fen;
  const notes = { [normalizeFen(fen)]: { moves: { Nxf7: 'Alien sac.' } } };
  assert.equal(explain({ fen, san: 'Ng5xf7', notes }).phrases[0], 'Alien sac.');
});
test('attacks an under-defended piece, gives check, opens a line', () => {
  const fen = replay(['e4','e5','Nf3','d6','Bc4','Bg4','Nc3','g6']).fen;
  const r = explain({ fen, san: 'Bxf7+' });
  assert.ok(r.phrases.includes('Gives up a bishop for a pawn.'));
  assert.ok(r.phrases.includes('Gives check.'));
  const r2 = explain({ fen: START_FEN, san: 'e4' });
  assert.ok(r2.phrases.includes('Opens the bishop on f1.'));
  assert.ok(!r.phrases.some((p) => p.includes('king')));
  const r4 = explain({ fen: replay(['e4','e5','Nf3','Nc6','Bc4','Nf6']).fen, san: 'Ng5' });
  assert.ok(r4.phrases.includes('Attacks the pawn on f7.'));
});
test('threat is null when the mover is in check', () => {
  const fen = replay(['e4','e5','Nf3','d6','Bc4','Bg4','Nc3','g6','Bxf7+']).fen;
  assert.equal(explain({ fen, san: 'Kxf7' }).threat, null);
});
