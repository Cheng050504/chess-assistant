import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OpeningTree } from '../src/content/study/opening-tree.js';
import { replay, sanToUci } from '../src/content/chess/game-state.js';
import { pickBookMove } from '../src/content/coach/counter-picker.js';

const tree = OpeningTree.build(JSON.parse(readFileSync(new URL('./fixtures/eco-sample.json', import.meta.url))));

test('picks the engine-ordered book move', () => {
  const sanHistory = ['e4'];
  const { fen } = replay(sanHistory);
  const engineLines = [{ uci: 'g7g6' }, { uci: 'e7e6' }, { uci: 'c7c6' }];
  const bookUcis = tree.bookContinuations(tree.nodeForFen(fen)).map((c) => sanToUci(fen, c.san));
  const expected = engineLines.map((l) => l.uci).find((u) => bookUcis.includes(u));
  assert.ok(expected);
  const r = pickBookMove({ fen, sanHistory, tree, engineLines });
  assert.equal(r.uci, expected);
  assert.equal(r.uci, 'e7e6');
  assert.notEqual(r.uci, 'c7c6');
});

test('no intersection returns null', () => {
  const { fen } = replay(['e4']);
  assert.equal(pickBookMove({ fen, sanHistory: ['e4'], tree, engineLines: [{ uci: 'a7a6' }] }), null);
});

test('not in tree returns null', () => {
  const sanHistory = ['a3', 'h6'];
  const { fen } = replay(sanHistory);
  assert.equal(pickBookMove({ fen, sanHistory, tree, engineLines: [{ uci: 'e7e5' }] }), null);
});

test('no tree returns null', () => {
  const { fen } = replay(['e4']);
  assert.equal(pickBookMove({ fen, sanHistory: ['e4'], tree: null, engineLines: [{ uci: 'c7c6' }] }), null);
});

test('opening name after the move', () => {
  const sanHistory = ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nf6', 'Ng5', 'h6'];
  const { fen } = replay(sanHistory);
  const r = pickBookMove({ fen, sanHistory, tree, engineLines: [{ uci: 'g5f7' }] });
  assert.equal(r.san, 'Nxf7');
  assert.equal(r.openingName, 'Caro-Kann Defense: Alien Gambit');
});
