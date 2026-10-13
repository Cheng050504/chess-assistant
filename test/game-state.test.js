import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay, parseMoveText, sanToUci, uciToSan, START_FEN } from '../src/content/chess/game-state.js';

const ALIEN = ['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nf6','Ng5','h6','Nxf7'];
test('replay valid line', () => {
  const r = replay(ALIEN);
  assert.equal(r.ok, true);
  assert.equal(r.badIndex, -1);
  assert.equal(r.fen, 'rnbqkb1r/pp2pNp1/2p2n1p/8/3P4/8/PPP2PPP/R1BQKBNR b KQkq - 0 6');
  assert.equal(r.fens.length, 11);
  assert.equal(r.fens[10], 'rnbqkb1r/pp2pNp1/2p2n1p/8/3P4/8/PPP2PPP/R1BQKBNR b KQkq -');
});
test('replay stops at illegal move', () => {
  const r = replay(['e4','e5','Ke3']);
  assert.equal(r.ok, false); assert.equal(r.badIndex, 2); assert.deepEqual(r.sanHistory, ['e4','e5']);
});
test('replay accepts annotations and missing check marks', () => {
  assert.equal(replay(['e4','f5','Qh5']).ok, true);
  assert.equal(replay(['e4!','e5?!']).ok, true);
});
test('parseMoveText', () => assert.deepEqual(parseMoveText('1. e4 c6 2. d4 d5 3...Nf6 1-0'), ['e4','c6','d4','d5','Nf6']));
test('san/uci round trip', () => {
  assert.equal(sanToUci(START_FEN, 'Nf3'), 'g1f3');
  assert.equal(uciToSan(START_FEN, 'e2e4'), 'e4');
  assert.equal(sanToUci(START_FEN, 'Nf6'), null);
});
test('transposition gives same key', () => {
  assert.equal(replay(['d4','c6','e4','d5']).fens.at(-1), replay(['e4','c6','d4','d5']).fens.at(-1));
});
