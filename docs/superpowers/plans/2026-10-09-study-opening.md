# Study Opening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick an opening to study and get move-by-move, explained guidance toward and through it in Chess.com bot games, with all assistance gated to bot/analysis pages.

**Architecture:** Pure-logic modules (context gate, game state, move extraction, opening tree, explainer, study tracker, study controller) are unit-tested under `node --test`. Thin DOM adapters (live sync, study panel, arrows) wire them into the existing content script (`src/content/index.js`) and overlay. chess.js is vendored to fit the project's regex bundler.

**Tech Stack:** Plain ES modules, custom bundler `scripts/build.js`, chess.js 1.4.0 (vendored), Stockfish via the existing `AnalysisService`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-09-study-opening-design.md`

## Global Constraints

- New source modules use only `import { a, b } from './relative.js';` (one line each) and `export class|const|function` at line start. The bundler (`scripts/build.js:62-84`) supports nothing else.
- Pure modules (`context-gate`, `game-state`, `move-extract`, `opening-tree`, `explainer`, `study-tracker`, `study-controller`) must not touch `document`, `window`, `chrome`, or `Logger`, so they import cleanly in Node.
- Tests: Node ≥ 22. Script `"test": "node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON test/"`. `package.json` gets no `"type"` field.
- Position key = `normalizeFen(fen)`, the first four FEN fields joined by spaces.
- Allowed pages (everything else is blocked): `www.chess.com` paths `/play/computer`, `/play/computer/*`, `/game/computer/<id>`, `/analysis`, `/analysis/*`; `lichess.org` paths `/analysis`, `/analysis/*`.
- Blocked copy: `Assistance is off in games against people.`
- Engine timeout: 8000 ms. Engine continuation past the target: at most 10 user moves. Recent list: 10 targets. Search limit: 20.
- Source labels: `book`, `notes`, `engine`. Badge text: `Book`, `Notes`, `Engine`.
- Study UI inserts data/user text only via `textContent` or DOM nodes, never `innerHTML`.
- Guidance never makes, clicks, or submits a move.

## Review Focus

1. **Chess.com navigates without reloads** (e.g. `/play/computer` → `/play/online` in the same tab). The gate must flip within 1 s and kill any in-flight analysis. Pinned by `context-gate.test.js › watch() reports changes` (Task 1) and the manual checklist (Task 12).
2. **Move list shows a variation or the user steps back through moves** (Chess.com `.node` elements that are not `main-line-ply`). Only main-line plies may count. Pinned in Task 3 `extractMoves ignores non-mainline nodes`.
3. **Promotion and castling in figurine notation** (`e8=` + figurine `Q`, `O-O`). Pinned in Task 3.
4. **Game reset or new game in the same tab** (history shrinks to 0). The tracker must return to `on-track` with an empty history, not stay `opponent-deviated`. Pinned in Task 8 `new game resets to on-track`.
5. **Engine result arrives for a position the user already left.** It must not be shown. Pinned in Task 9 `stale engine result is discarded`.

---

### Task 1: Test harness + context gate

**Files:**
- Modify: `package.json` (`scripts.test`)
- Create: `src/content/context/context-gate.js`
- Test: `test/context-gate.test.js`

**Interfaces:**
- Produces: `export function classifyUrl(url: string): 'training' | 'blocked'`
- Produces: `export class ContextGate { constructor({ getUrl: () => string, onChange: (verdict) => void, intervalMs = 1000, setIntervalFn = setInterval, clearIntervalFn = clearInterval }); start(): void; stop(): void; check(): 'training'|'blocked'; get verdict(): 'training'|'blocked' }`. `check()` calls `onChange` only when the verdict differs from the last one. The first check always fires. `start()` runs `check()` immediately and on the interval. History wrapping lives in Task 4's DOM wiring, which calls `check()`.

- [ ] **Step 1: Write the failing tests** in `test/context-gate.test.js`:

```js
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
```

- [ ] **Step 2: Set the test script, then run the tests and check they fail**

Set `scripts.test` to the value in Global Constraints. Run `npm test`. Expected: FAIL, cannot find module `context-gate.js`.

- [ ] **Step 3: Implement `classifyUrl` and `ContextGate`** in `src/content/context/context-gate.js`

Use `new URL(url)` inside try/catch (an invalid URL means blocked). Match the host exactly, then the path by regex: chess.com `^/play/computer(/|$)`, `^/game/computer/\d+(/|$)`, `^/analysis(/|$)`; lichess `^/analysis(/|$)`.

- [ ] **Step 4: Run the tests**

Run `npm test`. Expected: all pass.

- [ ] **Step 5: Commit**: `git add package.json src/content/context test/context-gate.test.js && git commit -m "feat: add bot/analysis context gate"`

---

### Task 2: Vendor chess.js + GameState

**Files:**
- Create: `src/vendor/chess.js` (from `chess.js@1.4.0`, `dist/esm/chess.js`)
- Create: `src/content/chess/game-state.js`
- Test: `test/game-state.test.js`

**Interfaces:**
- Produces from `src/vendor/chess.js`: `export class Chess`, `export function validateFen`.
- Produces from `game-state.js`:
  - `export function normalizeFen(fen: string): string`
  - `export function parseMoveText(text: string): string[]`: strips move numbers (`1.`, `1...`) and result tokens (`1-0`, `0-1`, `1/2-1/2`, `*`), and returns SAN tokens.
  - `export function replay(sanList: string[], startFen?: string): { ok: boolean, fen: string, sanHistory: string[], fens: string[], badIndex: number }`. `fens[i]` is the normalized FEN *after* move `i`. `fens` excludes the start. On failure, `ok=false`, `badIndex` = index of the first illegal move, and `fen`/`sanHistory` reflect the moves before it. On success `badIndex = -1`. `sanHistory` is chess.js canonical SAN.
  - `export function sanToUci(fen: string, san: string): string | null`
  - `export function uciToSan(fen: string, uci: string): string | null`
  - `export function legalMoves(fen: string): Array<{ san, uci, from, to, piece, captured, flags }>`
  - `export const START_FEN`

- [ ] **Step 1: Vendor the library**

```bash
cd "$(mktemp -d)" && npm pack chess.js@1.4.0 && tar xzf chess.js-1.4.0.tgz
```

Copy `package/dist/esm/chess.js` to `src/vendor/chess.js`, then:
- Prepend a comment with the full BSD-2-Clause text from `package/LICENSE` and `chess.js 1.4.0 — vendored; exports adapted for scripts/build.js`.
- Change line-start `class Chess {` → `export class Chess {` and `function validateFen(` → `export function validateFen(`.
- Delete the final `export { BISHOP, … };` line.
- Remove the trailing `//# sourceMappingURL` line.

- [ ] **Step 2: Write the failing tests** in `test/game-state.test.js`:

```js
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
```

- [ ] **Step 3: Run the tests**: `npm test`. Expected: FAIL, missing module.

- [ ] **Step 4: Implement `game-state.js`**

Before calling `chess.move(san)`, strip `!` and `?` characters from each SAN token. Wrap each `move` in try/catch, because chess.js 1.x throws on illegal moves.

- [ ] **Step 5: Run the tests**: `npm test`. Expected: all pass.

- [ ] **Step 6: Syntax-check the vendor file**: `node --check src/vendor/chess.js`. Expected: no output. Bundling is verified in Task 4 Step 4.

- [ ] **Step 7: Commit**: `feat: vendor chess.js and add GameState helpers`

---

### Task 3: Move extraction (pure) + live-sync adapter

**Files:**
- Create: `src/content/chess/move-extract.js` (pure)
- Create: `src/content/chess/live-sync.js` (DOM adapter)
- Test: `test/live-sync.test.js`

**Interfaces:**
- Produces: `export function extractMoves(nodes: Array<{ text: string, figurine: string|null, classes: string[] }>): string[]`
  - Nodes whose `classes` include `node` must also include `main-line-ply`, or they are dropped. Nodes without the `node` class (lichess `kwdb`) are kept.
  - Text is trimmed and whitespace removed. Skip empty strings, move numbers (`/^\d+\.*$/`) and `...`.
  - If `figurine` is set: text ending in `=` gets the figurine appended, otherwise the figurine is prefixed.
- Produces: `export class LiveSync { constructor({ onPositionChanged: (p) => void }); start(): void; stop(): void; snapshot(): PositionSnapshot | null }`, where `PositionSnapshot = { sanHistory: string[], fen: string, turn: 'w'|'b', userColor: 'w'|'b', synced: boolean }`.
  - DOM reading: nodes from `.move-list .node, wc-simple-move-list .node, l4x kwdb`. `figurine` comes from `node.querySelector('[data-figurine]')?.dataset.figurine`.
  - `userColor`: `MoveHighlighter.getBoardState(MoveHighlighter.getBoard()).isFlipped ? 'b' : 'w'`.
  - `synced`: `replay(...).ok`, and the placement field of `BoardParser.parseBoardFromDOM()` equals the placement field of the replayed FEN. When parsing returns null, the cross-check is skipped and the result is treated as synced.
  - Emits only when `normalizeFen(fen)`, `synced` or `userColor` change. Debounce is 150 ms. Triggers: a `MutationObserver` on `document.querySelector(SELECTORS.MOVE_LIST)` (retry the lookup every 1000 ms until found, as `setupMoveObserver` does now) plus a 1000 ms poll.

- [ ] **Step 1: Write the failing tests** in `test/live-sync.test.js` (on `extractMoves` only):

```js
const n = (text, classes = ['node','main-line-ply'], figurine = null) => ({ text, classes, figurine });
test('text-only chess.com nodes', () => assert.deepEqual(extractMoves([n('e4'), n('c6'), n('d4')]), ['e4','c6','d4']));
test('figurine prefix', () => assert.deepEqual(extractMoves([n('f3', undefined, 'N')]), ['Nf3']));
test('figurine promotion suffix', () => assert.deepEqual(extractMoves([n('e8=', undefined, 'Q')]), ['e8=Q']));
test('castling untouched', () => assert.deepEqual(extractMoves([n('O-O')]), ['O-O']));
test('extractMoves ignores non-mainline nodes', () =>
  assert.deepEqual(extractMoves([n('e4'), n('d5', ['node','variation']), n('e5')]), ['e4','e5']));
test('lichess kwdb nodes', () => assert.deepEqual(extractMoves([n('e4', []), n('c6', [])]), ['e4','c6']));
test('skips numbers and empties', () => assert.deepEqual(extractMoves([n('1.', []), n('', []), n('...', []), n('e4', [])]), ['e4']));
test('empty list', () => assert.deepEqual(extractMoves([]), []));
```

- [ ] **Step 2: Run**: `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement `extractMoves`** in `move-extract.js`.
- [ ] **Step 4: Run**: `npm test`. Expected: pass.
- [ ] **Step 5: Implement `LiveSync`** in `live-sync.js` per the Interfaces block. This is covered by manual testing only.
- [ ] **Step 6: Commit**: `feat: add figurine-aware move extraction and live sync`

---

### Task 4: Wire gate + live sync into the content script (existing features gated)

**Files:**
- Modify: `src/content/index.js` (constructor, `initialize`, `setupMoveObserver`, `getPlayedMoves`, `updateOpeningExplorer`, `saveCurrentLineToRepertoire`)
- Modify: `src/content/ui/overlay.js` (`analyze`, new `setBlocked(blocked: boolean)`)
- Modify: `src/styles/overlay.css` (`.chess-assistant-blocked` state)
- Modify: `README.md` (new "Where assistance works" section)

**Interfaces:**
- Consumes: `ContextGate`, `classifyUrl` (Task 1); `LiveSync`, `PositionSnapshot` (Task 3).
- Produces on `ChessAssistant`:
  - `this.contextVerdict: 'training'|'blocked'`
  - `this.position: PositionSnapshot|null`
  - `onPositionChanged(p)`, which Task 11 extends
  - `applyVerdict(verdict)`
- Produces on `Overlay`: `setBlocked(blocked)`. When blocked it disables the Analyze/AUTO buttons, replaces the moves container text with the blocked copy, and adds the class `chess-assistant-blocked` to the root.

- [ ] **Step 1: Start the gate in `initialize()`**

Create `this.gate = new ContextGate({ getUrl: () => location.href, onChange: v => this.applyVerdict(v) })` and start it **before** `analysisService.connect()`.

Wrap `history.pushState`/`replaceState` once and listen to `popstate`. All three call `this.gate.check()`.

- [ ] **Step 2: Implement `applyVerdict(verdict)`**

On `blocked`: `this.analysisService.stopAnalysis()`, `MoveHighlighter.clearAll()`, `this.topMoves = []`, `overlay.setBlocked(true)`.

On `training`: `overlay.setBlocked(false)`.

`Overlay.analyze()` returns early unless `this.isEnabled && !this.isBlocked`.

- [ ] **Step 3: Replace the move observer with `LiveSync`**

`setupMoveObserver` becomes `this.liveSync = new LiveSync({ onPositionChanged: p => this.onPositionChanged(p) }); this.liveSync.start();`.

`onPositionChanged(p)` stores `this.position = p`. If the verdict is `training`, auto-analyze is on, the overlay is enabled and `p.synced`, it runs `stopCurrentAnalysis()` then `overlay.analyze()`.

Delete `getMoveCount`/`moveListCache`. `getPlayedMoves()` returns `this.position?.sanHistory ?? []`.

- [ ] **Step 4: Build and smoke-check**

Run `npm run build:chrome && npm run build:firefox && npm test`. Expected: both builds succeed.

Then run `grep -c "class Chess" dist/chrome/content.js`. Expected: `1`.

- [ ] **Step 5: README**

Add a "Where assistance works" section listing the allowed pages from Global Constraints. State that human games, daily games and lichess game pages are blocked, and that this is a change from earlier versions.

- [ ] **Step 6: Commit**: `feat: gate all assistance to bot/analysis pages and use live sync`

---

### Task 5: Opening tree

**Files:**
- Create: `src/content/study/opening-tree.js`
- Create: `test/fixtures/eco-sample.json`
- Test: `test/opening-tree.test.js`

**Interfaces:**
- Consumes: `replay`, `parseMoveText`, `normalizeFen` (Task 2).
- Input entries: `{ eco: string, name: string, moves: string }`. These are the same objects `OpeningExplorer.entries` holds (`opening-explorer.js:73`).
- Produces: `export class OpeningTree`
  - `static build(entries): OpeningTree`
  - `get size(): number` (named entries indexed)
  - `get skipped(): number`
  - `search(query: string, limit = 20): Array<{ eco, name, sanMoves: string[], fen: string }>`
  - `nodeForMoves(sanHistory): Node|null`
  - `nodeForFen(fen): Node|null`
  - `deepestNamed(sanHistory): { eco, name, depth: number } | null`
  - `bookContinuations(node): Array<{ san: string, node: Node }>`
  - `lineFor(eco, name): string[] | null`
  - `Node = { san: string|null, fen: string, ply: number, parent: Node|null, children: Map<string, Node>, openings: Array<{eco,name}>, subtreeSize: number }`

  Search ranking: exact ECO match first, then a name that starts with the query, then shorter line. The rules are in spec §5.1. `deepestNamed` walks the history from the root through `children`. When a move is not a child, it falls back to `nodeForFen` of that prefix. It stops at the first miss and returns the last named node.

- [ ] **Step 1: Create the fixture**

`test/fixtures/eco-sample.json` holds about 12 entries copied verbatim from `public/ecoA–E.json`, including:
- `B10 Caro-Kann Defense` (`1. e4 c6`)
- the B12/B13 entries for `1. e4 c6 2. d4 d5`
- `B15 Caro-Kann Defense: Alien Gambit`
- the `B15` entry for `… 4. Nxe4 Nf6`
- one `B18` Classical line
- `C00 French Defense` (`1. e4 e6`)
- `B20 Sicilian Defense`

Store it as an array of `{eco, name, moves}`, plus one deliberately broken entry `{ "eco": "X00", "name": "Broken", "moves": "1. e4 e4" }`.

- [ ] **Step 2: Write the failing tests**:

```js
const tree = OpeningTree.build(JSON.parse(readFileSync(new URL('./fixtures/eco-sample.json', import.meta.url))));
test('skips broken entries', () => assert.equal(tree.skipped, 1));
test('search alien finds B15', () => {
  const r = tree.search('alien');
  assert.equal(r[0].eco, 'B15'); assert.equal(r[0].name, 'Caro-Kann Defense: Alien Gambit');
  assert.equal(r[0].sanMoves.at(-1), 'Nxf7');
});
test('search multi-token and eco', () => {
  assert.equal(tree.search('caro alien')[0].eco, 'B15');
  assert.ok(tree.search('B15').every(r => r.eco === 'B15'));
  assert.deepEqual(tree.search('zzz'), []);
});
test('transposition by fen', () => {
  const fen = replay(['d4','c6','e4','d5']).fen;
  assert.ok(tree.nodeForFen(fen));
});
test('deepestNamed after deviation', () => {
  assert.equal(tree.deepestNamed(['e4','c6','d4','d5','Nc3','e6']).eco.startsWith('B1'), true);
  assert.equal(tree.deepestNamed(['e4','e6']).name, 'French Defense');
  assert.equal(tree.deepestNamed(['a3']), null);
});
test('bookContinuations ordered by subtree size', () => {
  const kids = tree.bookContinuations(tree.nodeForMoves(['e4']));
  assert.equal(kids[0].san, 'c6');
});
```

The last assertion holds because the fixture has the most `1…c6` lines. Adjust the fixture, not the test, if needed.

- [ ] **Step 3: Run**: `npm test`. Expected: FAIL.
- [ ] **Step 4: Implement `OpeningTree`**. Replay each entry once and share prefix nodes. A FEN index entry is created only the first time that FEN is seen.
- [ ] **Step 5: Run**: `npm test`. Expected: pass.

- [ ] **Step 6: Check the full database builds**

```bash
node -e "import('./src/content/study/opening-tree.js').then(async ({OpeningTree})=>{const fs=require('fs');const e=['A','B','C','D','E'].flatMap(l=>{const d=JSON.parse(fs.readFileSync('public/eco'+l+'.json'));return Object.values(d)});console.time('build');const t=OpeningTree.build(e);console.timeEnd('build');console.log(t.size,t.skipped)})"
```

Expected: `size` > 3000, `skipped` < 1%, build under 3 s. Record the numbers in the commit message.

- [ ] **Step 7: Commit**: `feat: add ECO opening tree with search and transposition index`

---

### Task 6: Opening notes data

**Files:**
- Create: `public/opening-notes.json`
- Modify: `scripts/build.js:114` (add `opening-notes.json` to `copyPublicFiles` list)
- Modify: `public/manifest.json`, `public/manifest.firefox.json` (`web_accessible_resources`)
- Test: `test/opening-notes.test.js`

**Interfaces:**
- Produces: a JSON object keyed by `normalizeFen` of the position *before* the move: `{ moves: { [SAN]: string }, plan?: string, traps?: string[] }`.

- [ ] **Step 1: Generate the file**

Generate it with a one-off script (don't commit the script), using `replay` to compute keys. Use these entries and this exact text:

| Moves before | SAN | Note |
|---|---|---|
| (start) | `e4` | Claims the center and opens lines for the queen and the light-squared bishop. |
| `e4` | `c6` | The Caro-Kann: prepares ...d5 to challenge e4 while keeping the c8-bishop's diagonal open. |
| `e4 c6` | `d4` | Builds a full pawn center on e4 and d4. |
| `e4 c6 d4` | `d5` | Strikes at e4; the c6-pawn supports d5. |
| `e4 c6 d4 d5` | `Nc3` | Defends e4 with a piece while developing. |
| `e4 c6 d4 d5 Nc3` | `dxe4` | Releases the tension by taking the e4-pawn; White will recapture with the knight. |
| `e4 c6 d4 d5 Nc3 dxe4` | `Nxe4` | Recaptures and centralizes the knight. |
| `e4 c6 d4 d5 Nc3 dxe4 Nxe4` | `Nf6` | Challenges the centralized knight straight away. |
| `… Nxe4 Nf6` | `Ng5` | The Alien Gambit: avoids the knight trade and eyes f7, hoping for ...h6 so that Nxf7 becomes possible. |
| `… Nxe4 Nf6` | `Nxf6+` | The main line: trades knights and forces Black to recapture with a pawn. |
| `… Nf6 Ng5` | `h6` | Questions the knight; this is the reply the gambit is hoping for. |
| `… Ng5 h6` | `Nxf7` | The sacrifice: the knight takes the f7-pawn to drag Black's king into the open. White is giving up a knight for a pawn; engines judge it unsound. |
| `… h6 Nxf7` | `Kxf7` | Takes the knight; Black is up a piece but the king has lost its shelter. |

Plans:
- After `… Nxf7 Kxf7`: `"White: develop fast and keep the king in the open — Bc4+ is a typical follow-up. Black: tuck the king away and return material if needed to finish development."`
- On `… Nxe4 Nf6` (before 5.Ng5): `"Decide between the solid main line (Nxf6+) and the Alien Gambit (Ng5)."`

No `traps` entries.

- [ ] **Step 2: Write the failing test**

Load the notes and the full ECO tree (as in Task 5 Step 6), then check:
- every key equals `normalizeFen` of some tree node, or the start position;
- every SAN in `moves` is legal in that position (`sanToUci(key + ' 0 1', san) !== null`);
- every note is ≤ 200 characters.

- [ ] **Step 3: Run**: `npm test`. Expected: pass once the file exists. If the file is absent the test fails, so run Steps 2→3 before Step 1 to watch it fail first.

- [ ] **Step 4: Wire into the build and manifests**

Add the file to `copyPublicFiles` and to both manifests' `web_accessible_resources`. Run `npm run build:chrome && ls dist/chrome/opening-notes.json`.

- [ ] **Step 5: Commit**: `feat: add Caro-Kann / Alien Gambit opening notes`

---

### Task 7: Explainer

**Files:**
- Create: `src/content/study/explainer.js`
- Test: `test/explainer.test.js`

**Interfaces:**
- Consumes: `Chess` (vendor), `normalizeFen`, `legalMoves` (Task 2).
- Produces: `export function explain({ fen: string, san: string, notes?: NotesFile, engine?: { scoreText: string, depth: number } }): { text: string, phrases: string[], source: 'notes'|'book'|'engine', threat: string|null, nextObjective: string|null }`
  - `source` is `notes` when a notes text exists for `(normalizeFen(fen), san)`, otherwise `engine` when `engine` is given, otherwise `book`.
  - `phrases` holds at most 3 and follows the rule order in spec §6.
  - `text = phrases.join(' ')`.
  - Values for material: P1 N3 B3 R5 Q9. A "sacrifice" means the side moving is down material after the opponent's best single recapture on the destination square.
  - Phrase templates (exact):
    - `Develops the {piece}.`
    - `Controls {squares}.` (squares joined with ` and `, in the order d4, d5, e4, e5)
    - `Attacks the {piece} on {sq}.`
    - `Captures a {piece}.`
    - `Gives up a {piece} for a {piece}.` (or `for nothing.`)
    - `Gives check.`
    - `Castles.`
    - `Opens the {piece} on {sq}.`
    - `{Color} threatens {san}.`
    - Engine suffix `{scoreText} at depth {depth}.`
  - `nextObjective` comes from the notes `plan` when present. Otherwise the first matching principle: `Castle next.` (castling legal for the mover after the move, when it's their turn again), then `Develop your remaining minor pieces.`, then `Connect your rooks.`

- [ ] **Step 1: Write the failing tests**:

```js
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
```

- [ ] **Step 2: Run**: FAIL.

- [ ] **Step 3: Implement**

Compute the threat from the position *before* the move: flip the side to move in the FEN, clearing en passant. Score each capture as `gain = value(captured) − (value(capturer) if the destination is attacked by the original mover, else 0)`. Report the highest-gain capture when `gain > 0`. Otherwise report the highest-gain capture that gives check, if any (for the test position this yields `Nxf3+`, gain 0, over `Nxc2+`, gain −2). Report it as `{Color} threatens {san}.`

- [ ] **Step 4: Run**: pass.
- [ ] **Step 5: Commit**: `feat: add rules-based move explainer`

---

### Task 8: Study tracker

**Files:**
- Create: `src/content/study/study-tracker.js`
- Test: `test/study-tracker.test.js`

**Interfaces:**
- Consumes: `OpeningTree` (Task 5), `replay`/`normalizeFen`/`sanToUci` (Task 2).
- Produces: `export function evaluate({ target, position, tree }): StudyStatus`
  - `target = { eco, name, moves: string[], fen: string, color: 'w'|'b', mode: 'show'|'try' }`
  - `position` = `PositionSnapshot` (Task 3)
  - `StudyStatus = { state, message: string, nextMove: { san, uci, source: 'book'|'engine-needed' } | null, predictedMove: { san, uci } | null, awaiting: string[], newOpening: { eco, name } | null, bookMove: string | null, userMovesPastTarget: number }`
  - `state ∈ 'syncing'|'wrong-color'|'on-track'|'reached'|'opponent-deviated'|'you-deviated'`
  - `nextMove.source === 'engine-needed'` tells the controller (Task 9) to ask Stockfish. It's only set when the user is to move, there's no book child, and `userMovesPastTarget < 10`. When the user is to move and no move is available, `nextMove = null`; at 10 or more moves past the target the message reads `Study line complete.`
- Messages (exact):

| State | Message |
|---|---|
| `syncing` | `Syncing with board…` |
| `wrong-color` | `{name} is a {White\|Black} opening. You're {Black\|White} this game.` |
| `on-track`, user to move | `On the {name} line — your move.` |
| `on-track`, opponent to move | `Waiting for {opp}. The line needs {awaiting joined ', '}.` with awaiting as move-numbered SAN, e.g. `3...dxe4` |
| `reached` | `You're in the {name}.` |
| `opponent-deviated` | `{moveNo}{san}: now the {newOpening.name} ({eco}). {name} can't be reached this game.` (when `newOpening` is null: `{moveNo}{san} leaves the book.`) |
| `you-deviated` | `You left the line. The book move was {bookMove}.` |

  Deviation detection: compare `position.sanHistory` with `target.moves` to find the first differing ply. If any position after the deviation has a FEN in the target line's FENs (via `replay(target.moves).fens`), the state is `on-track` from that matching index (transposition re-entry). The deviation type follows the color of the side that made the first off-line move.

- [ ] **Step 1: Write the failing tests**

Use the `eco-sample.json` tree, with `target` built from `tree.search('alien')[0]`, `color: 'w'`, and `pos(moves, userColor='w', synced=true)` built via `replay`:
- `empty history: on-track, nextMove e4`
- `after 1.e4: opponent to move, predictedMove c6, awaiting ['1...c6','2...d5','3...dxe4','4...Nf6','5...h6']`
- `after 1.e4 c6: nextMove d4`
- `full line: reached` (and `nextMove.source === 'engine-needed'` when no fixture child exists)
- `opponent-deviated on 3...e6` (newOpening eco starts with `B1`, message contains `can't be reached`)
- `you-deviated on 5.Nxf6+` (bookMove `Ng5`)
- `wrong-color when userColor b` (message `Caro-Kann Defense: Alien Gambit is a White opening. You're Black this game.`)
- `syncing when synced false`
- `transposition re-entry: 1.d4 c6 2.e4 d5 → on-track, nextMove Nc3`
- `new game resets to on-track`: evaluate a deviated history, then `[]`; expect `on-track`. Calls are stateless, so this proves there's no hidden state.
- `engine cap: userMovesPastTarget >= 10 → nextMove null, message 'Study line complete.'`

For the last case, build the position by appending 20 legal plies after the target. Generate them with `legalMoves(fen)[0]` in the test.

- [ ] **Step 2: Run**: FAIL.
- [ ] **Step 3: Implement `evaluate`** as a pure function.
- [ ] **Step 4: Run**: pass.
- [ ] **Step 5: Commit**: `feat: add study tracker state machine`

---

### Task 9: Study storage + StudyController

**Files:**
- Modify: `src/shared/constants.js` (`STORAGE_KEYS.STUDY_TARGET = 'studyTarget'`, `STORAGE_KEYS.STUDY_RECENT = 'studyRecent'`, `DEFAULT_SETTINGS.studyTarget = null`, `DEFAULT_SETTINGS.studyRecent = []`, `STUDY = { ENGINE_TIMEOUT_MS: 8000, MAX_PAST_TARGET: 10, RECENT_MAX: 10, SEARCH_LIMIT: 20 }`)
- Create: `src/content/study/study-controller.js`
- Test: `test/study-controller.test.js`

**Interfaces:**
- Consumes: `evaluate` (Task 8), `explain` (Task 7), `OpeningTree` (Task 5).
- Produces: `export class StudyController`
  - `constructor({ tree, notes, requestEngine: (fen) => Promise<{ uci, scoreText, depth }>, cancelEngine: () => void, onUpdate: (view: StudyView) => void, timeoutMs = 8000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout })`
  - `setTarget(target|null): void`
  - `setMode('show'|'try'): void`
  - `setPosition(PositionSnapshot): void`
  - `revealHint(): void`
  - `setBlocked(boolean): void`
  - `get view(): StudyView`
- `StudyView = { blocked, target, mode, status: StudyStatus|null, move: { san, uci, source: 'book'|'notes'|'engine', explanation } | null, revealed: boolean, predictedUci: string|null, engineState: 'idle'|'pending'|'unavailable' }`
  - `move` is filled for `nextMove` (book → `explain`, engine → after resolve), and for `you-deviated` using `bookMove` explained on the position before the deviation.
  - `revealed` is `mode === 'show' || hintRevealed`, and it resets on every new position.
  - Engine cache: `Map<normalizeFen, result>`.
  - A new position calls `cancelEngine()` if a request is pending. A late resolve for a non-current FEN is ignored.
  - Timeout sets `engineState = 'unavailable'`.
  - `setBlocked(true)` clears `move`/`predictedUci` and cancels the engine.

- [ ] **Step 1: Write the failing tests**

Use a fake `requestEngine` that returns controllable promises and a fake timer:
- `book move is explained` (`view.move.source` is `notes` or `book`, explanation non-empty)
- `engine-needed requests once and caches` (the second `setPosition` with the same FEN doesn't call `requestEngine` again)
- `stale engine result is discarded` (resolve the first request after moving to a new position, and check `view.move` doesn't use it)
- `timeout marks engine unavailable`
- `try mode hides until revealHint` (`revealed` false → true; resets on the next position)
- `blocked clears guidance and cancels`
- `you-deviated shows book move explanation`

- [ ] **Step 2: Run**: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**: pass.
- [ ] **Step 5: Commit**: `feat: add study controller with engine fallback, cache and timeout`

---

### Task 10: Dashed arrows + resize redraw

**Files:**
- Modify: `src/content/chess/move-highlighter.js` (`drawArrow`, `createArrow`, new `drawStudyArrows`, `clearStudyArrows`)

**Interfaces:**
- Produces:
  - `MoveHighlighter.drawArrow(uci, boardState, style = 'solid')`, where `style: 'solid'|'dashed'`. Dashed sets `stroke-dasharray="2 1.5"` and `opacity="0.75"`. SVG gets the class `chess-assistant-arrow-layer` plus `chess-assistant-arrow-{style}`.
  - `MoveHighlighter.drawStudyArrows({ primaryUci: string|null, predictedUci: string|null })`: clears the previous study arrows and draws primary solid and predicted dashed. It remembers the args.
  - `MoveHighlighter.clearStudyArrows()`.
  - One `window` `resize` listener (installed once, debounced 100 ms) re-runs `drawStudyArrows` with the remembered args.
- Existing `highlight(uci)` behavior is unchanged (solid).

- [ ] **Step 1: Implement** per the interfaces. Study arrows use a separate SVG class (`chess-assistant-study-arrow`), so `clearAll()` from the analysis code does not remove them and `clearStudyArrows()` does not remove analysis arrows.
- [ ] **Step 2: Verify**: `npm run build:chrome && npm test`. Expected: build OK, tests pass. Visual check is in Task 12.
- [ ] **Step 3: Commit**: `feat: add dashed study arrows with resize redraw`

---

### Task 11: Study panel UI, picker, shortcuts, and wiring

**Files:**
- Create: `src/content/ui/study-panel.js`
- Modify: `src/content/ui/overlay.js` (`getTemplate`: add `<div id="chess-assistant-study" class="study-container"></div>` above the moves container; Opening Explorer + Repertoire wrapped in a `<details class="ca-more">` collapsed by default)
- Modify: `src/styles/overlay.css` (`.study-*`, `.ca-badge-{book|notes|engine}`, picker list, focus styles; reuse existing colors/spacing variables and font)
- Modify: `src/content/index.js` (build tree, load notes, create controller + panel, `requestEngine` adapter, storage load/save, shortcuts)
- Modify: `src/content/services/opening-explorer.js` (no behavior change; expose `entries` as already public, and add `async loadNotes(): Promise<object>` fetching `opening-notes.json`, returning `{}` on failure)

**Interfaces:**
- Consumes: `StudyController`/`StudyView` (Task 9), `OpeningTree.search` (Task 5), `MoveHighlighter.drawStudyArrows`/`clearStudyArrows` (Task 10), `ChessAssistant.onPositionChanged`/`applyVerdict` (Task 4), `STORAGE_KEYS.STUDY_*` (Task 9).
- Produces: `export class StudyPanel { constructor(rootEl, { onPick(target), onToggleMode(), onReveal(), onSearch(query) → results, onColor(color) }); render(view: StudyView, { recent }): void; openPicker(): void; closePicker(): void; get pickerOpen(): boolean }`
- Panel content (exact copy):
  - Empty target: `Pick an opening to study` + button `Choose opening`.
  - Header: `{eco} · {name}`, a color badge `White`/`Black`, toggle button label `Show`/`Try`, button `Change`.
  - Try mode, hidden: `Find the book move` + button `Show me`.
  - Engine pending: `Engine thinking…`. Unavailable: `Engine unavailable`.
  - Blocked: the blocked copy only.
  - Picker: input `placeholder="Search openings (name or ECO)"`, results as buttons `{eco} {name}` with secondary text = first 6 SAN moves, a `Recent` heading, and a `White`/`Black` segmented switch defaulting to the color of the target's last move: `sanMoves.length % 2 === 1 ? 'w' : 'b'`.
- `requestEngine(fen)` adapter in `index.js`: store `this.pendingEngine = { fen, resolve, reject }`. If `analysisService.isAnalyzing && analysisService.lastFen === fen`, wait. Otherwise call `analysisService.sendAnalyzeRequest(fen)`. In `displayResults()`, when `pendingEngine?.fen === analysisStartFEN`, resolve with `{ uci: topMoves[0].move, scoreText: overlay.formatScore(topMoves[0]), depth: topMoves[0].depth }`. `cancelEngine()` clears `pendingEngine` (it doesn't stop the user's own analysis).
- Arrows from the view: `drawStudyArrows({ primaryUci: view.revealed ? view.move?.uci ?? null : null, predictedUci: view.predictedUci })`. Clear them when blocked or there's no target.
- Shortcuts: a `keydown` listener on `document`, ignored when `event.target` is an input, textarea, select or `isContentEditable`, or when a modifier key is held. `s`/`S` toggles mode, `h`/`H` reveals, `o`/`O` opens the picker, `Escape` closes it.
- Storage: load `studyTarget`/`studyRecent` in `loadSettings()`. On pick, save both: recent is deduped by `eco|name`, newest first, capped at 10. A failed save shows `Couldn't save study settings.` via `overlay.updateMessage` and keeps the in-memory state.
- Empty tree (`tree.size === 0`): the panel shows `Opening data unavailable` and the picker search is disabled.

- Target from a picked search result `r`: `{ eco: r.eco, name: r.name, moves: r.sanMoves, fen: r.fen, color: <switch value>, mode: 'show' }`.

- [ ] **Step 1: Implement `StudyPanel`** with DOM-node construction only. Grep check: `grep -n "innerHTML" src/content/ui/study-panel.js`. Expected: no output.
- [ ] **Step 2: Wire into `index.js`** per the interfaces. `onPositionChanged` also calls `studyController.setPosition(p)`. `applyVerdict` also calls `studyController.setBlocked(verdict === 'blocked')`.
- [ ] **Step 3: Update the overlay template and CSS.** Keep the existing header buttons and their ids unchanged.
- [ ] **Step 4: Verify**: `npm test && npm run build:chrome && npm run build:firefox && npm run lint`. Expected: tests pass, both builds succeed, no new lint errors in changed files.
- [ ] **Step 5: Commit**: `feat: add study panel, opening picker and keyboard shortcuts`

---

### Task 12: Edge docs + manual verification checklist

**Files:**
- Modify: `README.md` (sections "Install in Microsoft Edge", "Study an opening", "Manual test checklist"; update the Features list and the Scripts table with `npm test`)

- [ ] **Step 1: Write the README sections**

Add:
- **Edge install:** `npm run build:chrome` → `edge://extensions` → enable Developer mode → Load unpacked → `dist/chrome`.
- **Study an opening:** the user flow, the Show/Try toggle, shortcuts S/H/O/Esc, and what Book/Notes/Engine mean.
- **Manual checklist:** the 7 steps from spec §9.2 verbatim, plus "Navigate from `/play/computer` to `/play/online` without reloading; the panel shows the blocked message within 1 s and no arrows remain."

- [ ] **Step 2: Final verification**: `npm test && npm run build:chrome && npm run build:firefox`. Paste the summary lines (number of tests passed, build success) into the PR/summary.
- [ ] **Step 3: Commit**: `docs: add Edge install, study guide and manual checklist`
