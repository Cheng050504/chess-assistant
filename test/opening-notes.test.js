import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OpeningTree } from '../src/content/study/opening-tree.js';
import { normalizeFen, sanToUci, START_FEN } from '../src/content/chess/game-state.js';
import { Chess } from '../src/vendor/chess.js';

const readJson = name => JSON.parse(readFileSync(new URL('../public/' + name, import.meta.url), 'utf8'));
const entries = ['A', 'B', 'C', 'D', 'E'].flatMap(l => Object.values(readJson(`eco${l}.json`)));
const tree = OpeningTree.build(entries);
const notes = readJson('opening-notes.json');
const start = normalizeFen(START_FEN);

function after(key, san) {
  const chess = new Chess(key + ' 0 1');
  chess.move(san);
  return normalizeFen(chess.fen());
}

// Valid keys: start position, ECO tree nodes, or positions reached by the notes' own moves.
function validKeys() {
  const valid = new Set([start]);
  for (const key of Object.keys(notes)) if (tree.nodeForFen(key)) valid.add(key);
  let grew = true;
  while (grew) {
    grew = false;
    for (const key of valid) {
      for (const san of Object.keys(notes[key]?.moves || {})) {
        const next = after(key, san);
        if (!valid.has(next)) { valid.add(next); grew = true; }
      }
    }
  }
  return valid;
}

test('every note key is a known position', () => {
  const valid = validKeys();
  for (const key of Object.keys(notes)) assert.ok(valid.has(key), `unknown key ${key}`);
});

test('every SAN is legal in its position', () => {
  for (const [key, entry] of Object.entries(notes)) {
    for (const san of Object.keys(entry.moves)) {
      assert.notEqual(sanToUci(key + ' 0 1', san), null, `${san} illegal in ${key}`);
    }
  }
});

test('every note is at most 200 characters', () => {
  for (const entry of Object.values(notes)) {
    for (const text of [...Object.values(entry.moves), entry.plan, ...(entry.traps || [])]) {
      if (text !== undefined) assert.ok(text.length <= 200, text);
    }
  }
});

test('every study SAN is legal and documented in its entry', () => {
  let n = 0;
  for (const [key, entry] of Object.entries(notes)) {
    if (entry.study === undefined) continue;
    n++;
    assert.equal(typeof entry.study, 'string', `study in ${key}`);
    assert.notEqual(sanToUci(key + ' 0 1', entry.study), null, `study ${entry.study} illegal in ${key}`);
    assert.ok(Object.hasOwn(entry.moves || {}, entry.study), `study ${entry.study} missing from moves in ${key}`);
  }
  assert.ok(n >= 2);
});
