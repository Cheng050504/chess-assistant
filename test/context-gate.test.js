import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl, ContextGate } from '../src/content/context/context-gate.js';

const cases = [
  ['https://www.chess.com/play/computer', 'training'],
  ['https://www.chess.com/play/computer/discover', 'training'],
  ['https://www.chess.com/game/computer/123456', 'training'],
  ['https://www.chess.com/analysis', 'training'],
  ['https://www.chess.com/analysis/game/live/999?tab=analysis', 'training'],
  ['https://lichess.org/analysis', 'training'],
  ['https://lichess.org/analysis/standard/rnbqkbnr', 'training'],
  ['https://www.chess.com/play/online', 'blocked'],
  ['https://www.chess.com/game/live/123', 'blocked'],
  ['https://www.chess.com/game/daily/123', 'blocked'],
  ['https://www.chess.com/game/123', 'blocked'],
  ['https://www.chess.com/play/computerx', 'blocked'],
  ['https://www.chess.com/home', 'blocked'],
  ['https://lichess.org/abcd1234', 'blocked'],
  ['https://evil.com/play/computer', 'blocked'],
  ['not a url', 'blocked'],
];
for (const [url, want] of cases) {
  test(`classifyUrl ${url}`, () => assert.equal(classifyUrl(url), want));
}

test('watch() reports changes only on verdict change', () => {
  let url = 'https://www.chess.com/play/computer';
  const seen = [];
  const gate = new ContextGate({ getUrl: () => url, onChange: v => seen.push(v), setIntervalFn: () => 1, clearIntervalFn: () => {} });
  gate.start();
  gate.check();
  url = 'https://www.chess.com/play/online';
  gate.check();
  assert.deepEqual(seen, ['training', 'blocked']);
  assert.equal(gate.verdict, 'blocked');
});
