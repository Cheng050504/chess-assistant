import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateRecent, defaultStudyColor } from '../src/content/study/study-recent.js';

const t = (eco, name, extra = {}) => ({ eco, name, moves: ['e4'], fen: 'x', color: 'w', mode: 'show', ...extra });

test('updateRecent puts the new target first', () => {
  const out = updateRecent([t('B10', 'Caro-Kann')], t('C20', 'King Pawn'));
  assert.deepEqual(out.map(r => r.eco), ['C20', 'B10']);
});

test('updateRecent dedupes by eco|name and keeps the newest copy', () => {
  const old = [t('C20', 'King Pawn'), t('B10', 'Caro-Kann', { color: 'w' })];
  const out = updateRecent(old, t('B10', 'Caro-Kann', { color: 'b' }));
  assert.equal(out.length, 2);
  assert.equal(out[0].eco, 'B10');
  assert.equal(out[0].color, 'b');
  assert.equal(out[1].eco, 'C20');
});

test('updateRecent does not merge same name with different eco', () => {
  const out = updateRecent([t('B10', 'X')], t('B11', 'X'));
  assert.equal(out.length, 2);
});

test('updateRecent caps the list at 10 by default', () => {
  const old = Array.from({ length: 10 }, (_, i) => t('A' + String(i).padStart(2, '0'), 'n' + i));
  const out = updateRecent(old, t('E99', 'new'));
  assert.equal(out.length, 10);
  assert.equal(out[0].eco, 'E99');
  assert.equal(out[9].eco, 'A08');
});

test('updateRecent tolerates a missing or invalid list and does not mutate input', () => {
  assert.deepEqual(updateRecent(undefined, t('B10', 'C')).length, 1);
  assert.deepEqual(updateRecent('junk', t('B10', 'C')).length, 1);
  const old = [t('B10', 'C')];
  updateRecent(old, t('C20', 'D'));
  assert.equal(old.length, 1);
});

test('defaultStudyColor is the color of the last move', () => {
  assert.equal(defaultStudyColor(['e4']), 'w');
  assert.equal(defaultStudyColor(['e4', 'c6']), 'b');
  assert.equal(defaultStudyColor(['e4', 'c6', 'd4']), 'w');
  assert.equal(defaultStudyColor([]), 'b');
  assert.equal(defaultStudyColor(undefined), 'b');
});
