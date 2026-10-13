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
  // Nxf7 has three rule phrases (Controls, Attacks, Gives up); with a note that is four.
  const fen = replay(['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nf6','Ng5','h6']).fen;
  const notes = { [normalizeFen(fen)]: { moves: { Nxf7: 'Alien sac.' } } };
  const engine = { scoreText: '+0.40', depth: 12 };
  assert.equal(explain({ fen, san: 'Nxf7' }).phrases.length, 3);
  const r = explain({ fen, san: 'Nxf7', notes, engine });
  assert.equal(r.source, 'notes');
  assert.equal(r.phrases.length, 4);
  assert.deepEqual(r.phrases.slice(0, 3), ['Alien sac.', 'Controls e5.', 'Attacks the queen on d8.']);
  assert.equal(r.phrases[3], '+0.40 at depth 12.');
});
test('notes SAN keys match after canonicalizing the san argument', () => {
  const fen = replay(['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nf6','Ng5','h6']).fen;
  const notes = { [normalizeFen(fen)]: { moves: { Nxf7: 'Alien sac.' } } };
  assert.equal(explain({ fen, san: 'Ng5xf7', notes }).phrases[0], 'Alien sac.');
});
test('sacrifice with check: Gives up and Gives check, no Attacks the king', () => {
  const fen = replay(['e4','e5','Nf3','d6','Bc4','Bg4','Nc3','g6']).fen;
  const r = explain({ fen, san: 'Bxf7+' });
  assert.ok(r.phrases.includes('Gives up a bishop for a pawn.'));
  assert.ok(r.phrases.includes('Gives check.'));
  assert.ok(!r.phrases.some((p) => p.includes('king')));
});
test('e4 opens the bishop on f1', () => {
  assert.ok(explain({ fen: START_FEN, san: 'e4' }).phrases.includes('Opens the bishop on f1.'));
});
test('Ng5 attacks the under-defended pawn on f7', () => {
  const r = explain({ fen: replay(['e4','e5','Nf3','Nc6','Bc4','Nf6']).fen, san: 'Ng5' });
  assert.ok(r.phrases.includes('Attacks the pawn on f7.'));
});
test('threat is null when the mover is in check', () => {
  const fen = replay(['e4','e5','Nf3','d6','Bc4','Bg4','Nc3','g6','Bxf7+']).fen;
  assert.equal(explain({ fen, san: 'Kxf7' }).threat, null);
});

// Fix round 1 regressions.
test('recaptured promotion gives up a pawn, not a queen', () => {
  const r = explain({ fen: '3rk3/1P6/8/8/8/8/8/6K1 w - - 0 1', san: 'b8=Q' });
  assert.ok(r.phrases.includes('Leaves the queen on b8 en prise.'));
  assert.ok(!r.phrases.some((p) => /Gives up/.test(p)));
});
test('threat ignores captures met by an x-ray recapture', () => {
  // Qxf4 is met by Bc1xf4 through the vacated e3. Black's real threat is Qxc1+ (undefended bishop).
  assert.equal(explain({ fen: '4k3/8/8/8/5N2/4q3/8/2B4K w - - 0 1', san: 'Kh2' }).threat, 'Black threatens Qxc1+.');
  // With Kc2 defending c1 there is no winning capture at all.
  assert.equal(explain({ fen: '4k3/8/8/8/5N2/4q3/2K5/2B5 w - - 0 1', san: 'Kb1' }).threat, null);
});
test('threat fallback never reports a losing checking capture', () => {
  const fen = replay(['e4','e5','Nf3','Nc6','Bc4','Bc5']).fen;
  assert.doesNotMatch(explain({ fen, san: 'O-O' }).threat ?? '', /Bxf2\+/);
});
test('Opens needs at least two new squares (Nf3 opens nothing)', () => {
  assert.ok(!explain({ fen: START_FEN, san: 'Nf3' }).phrases.some((p) => p.startsWith('Opens')));
});

// Final review fixes (R21, M6).
test('non-capture that loses material reads en prise (1.d4 d5 2.c4)', () => {
  const r = explain({ fen: replay(['d4', 'd5']).fen, san: 'c4' });
  assert.ok(r.text.includes('Leaves the pawn on c4 en prise.'));
  assert.ok(!r.text.includes('Gives up'));
});
test('a losing capture still reads Gives up (Alien Gambit 6.Nxf7)', () => {
  const fen = replay(['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nf6','Ng5','h6']).fen;
  const r = explain({ fen, san: 'Nxf7' });
  assert.ok(r.phrases.includes('Gives up a knight for a pawn.'));
  assert.ok(!r.text.includes('en prise'));
});
test('three or more center squares are joined with commas and a final and', () => {
  // On an open board, a queen on d3 reaches d4, d5 and e4 (not e5).
  const r = explain({ fen: '4k3/8/8/8/8/8/8/3QK3 w - - 0 1', san: 'Qd3' });
  assert.ok(r.phrases.includes('Controls d4, d5 and e4.'), r.phrases.join(' | '));
});
