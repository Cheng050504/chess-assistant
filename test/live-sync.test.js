import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMoves } from '../src/content/chess/move-extract.js';

const n = (text, classes = ['node', 'main-line-ply'], figurine = null) => ({ text, classes, figurine });
test('text-only chess.com nodes', () => assert.deepEqual(extractMoves([n('e4'), n('c6'), n('d4')]), ['e4', 'c6', 'd4']));
test('figurine prefix', () => assert.deepEqual(extractMoves([n('f3', undefined, 'N')]), ['Nf3']));
test('figurine promotion suffix', () => assert.deepEqual(extractMoves([n('e8=', undefined, 'Q')]), ['e8=Q']));
test('castling untouched', () => assert.deepEqual(extractMoves([n('O-O')]), ['O-O']));
test('extractMoves ignores non-mainline nodes', () =>
    assert.deepEqual(extractMoves([n('e4'), n('d5', ['node', 'variation']), n('e5')]), ['e4', 'e5']));
test('lichess kwdb nodes', () => assert.deepEqual(extractMoves([n('e4', []), n('c6', [])]), ['e4', 'c6']));
test('skips numbers and empties', () => assert.deepEqual(extractMoves([n('1.', []), n('', []), n('...', []), n('e4', [])]), ['e4']));
test('empty list', () => assert.deepEqual(extractMoves([]), []));
