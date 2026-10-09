import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OpeningTree } from '../src/content/study/opening-tree.js';
import { replay } from '../src/content/chess/game-state.js';

const tree = OpeningTree.build(JSON.parse(readFileSync(new URL('./fixtures/eco-sample.json', import.meta.url))));

test('skips broken entries', () => {
  assert.equal(tree.skipped, 1);
  assert.equal(tree.size, 12);
});

test('search alien finds B15', () => {
  const r = tree.search('alien');
  assert.equal(r[0].eco, 'B15');
  assert.equal(r[0].name, 'Caro-Kann Defense: Alien Gambit');
  assert.equal(r[0].sanMoves.at(-1), 'Nxf7');
});

test('search multi-token and eco', () => {
  assert.equal(tree.search('caro alien')[0].eco, 'B15');
  assert.ok(tree.search('B15').every(r => r.eco === 'B15'));
  assert.deepEqual(tree.search('zzz'), []);
});

test('search ranks exact eco, then name prefix, then shorter line', () => {
  const r = tree.search('caro-kann');
  assert.equal(r[0].name, 'Caro-Kann Defense');
  assert.equal(r[0].sanMoves.length, 2);
  assert.equal(tree.search('caro', 3).length, 3);
});

test('search results carry normalized fen', () => {
  const r = tree.search('french')[0];
  assert.equal(r.fen, replay(['e4', 'e6']).fens.at(-1));
  assert.equal(r.fen.split(' ').length, 4);
});

test('transposition by fen', () => {
  const fen = replay(['d4', 'c6', 'e4', 'd5']).fen;
  assert.ok(tree.nodeForFen(fen));
});

test('deepestNamed after deviation', () => {
  assert.equal(tree.deepestNamed(['e4', 'c6', 'd4', 'd5', 'Nc3', 'e6']).eco.startsWith('B1'), true);
  assert.equal(tree.deepestNamed(['e4', 'e6']).name, 'French Defense');
  assert.equal(tree.deepestNamed(['a3']), null);
});

test('bookContinuations ordered by subtree size', () => {
  const kids = tree.bookContinuations(tree.nodeForMoves(['e4']));
  assert.equal(kids[0].san, 'c6');
});

test('nodeForMoves and lineFor', () => {
  assert.equal(tree.nodeForMoves([]).ply, 0);
  assert.equal(tree.nodeForMoves(['e4', 'c6']).ply, 2);
  assert.equal(tree.nodeForMoves(['e4', 'a6']), null);
  assert.deepEqual(tree.lineFor('C00', 'French Defense'), ['e4', 'e6']);
  assert.equal(tree.lineFor('C00', 'nope'), null);
});
