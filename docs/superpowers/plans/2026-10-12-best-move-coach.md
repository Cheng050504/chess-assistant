# Best-Move Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every user turn of a Chess.com bot game, show one best move (Study → Book → Engine) in a single card with an arrow, until the game ends.

**Architecture:** A new pure `counter-picker` picks the engine-approved book move. The study controller becomes a `CoachController`, which applies the three rules, requests engine lines only on the user's turn, and produces a `CoachView`. The panel renders that view as one card. `index.js` drops the old auto-analysis/top-3/Show-Try/shortcut paths and drives everything through the controller.

**Tech Stack:** Plain ES modules (regex bundler `scripts/build.js`), vendored chess.js, Stockfish via the existing `AnalysisService`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-11-best-move-coach-design.md`

## Global Constraints

- Simplicity rule:
  - no Show/Try toggle, no color switch, no AUTO/MANUAL or Analyze buttons, no keyboard shortcuts except Esc (closes the picker)
  - no top-3 list and no Opening Explorer/Repertoire section in the panel
  - header = ON/OFF, `−`, `✕`
- Badges (exact text): `Study`, `Book`, `Engine`.
- Card copy (exact):
  - `Waiting for the bot…`
  - `Thinking…`
  - `Engine loading…`
  - `Engine unavailable — retrying on the next move`
  - `Syncing with board…`
  - `Game over`
  - `Also good: ` (prefix)
- Other panel copy (exact): `Learn an opening`, `Choose…`, `Stop learning`, `Opening data unavailable`, and the blocked copy `Assistance is off in games against people.` (unchanged).
- Engine: MultiPV 3 at the popup depth, user's turn only. Timeout 8000 ms (`STUDY.ENGINE_TIMEOUT_MS`). No online engine.
- Rule 1 applies only when the tracker state is `on-track` or `reached` **and** `status.nextMove.source === 'book'`.
- Rule 2: the first engine line (engine order) whose uci is a book child of the current tree node; otherwise rule 3 (engine line 0).
- The 10-move engine cap is removed everywhere (`ENGINE_CAP`, `STUDY.MAX_PAST_TARGET`, `Study line complete.`).
- Pure modules (`counter-picker`, `coach-controller`, `study-tracker`, `explainer`, `opening-tree`) touch no DOM/chrome/Logger. Imports are one-line relative only; exports use `export class|const|function` at line start.
- Timer functions passed into classes must be called unbound (see `context-gate.js`, `study-controller.js`).
- Assistance stays gated to bot/analysis pages (unchanged gate code).

## Review Focus

1. **Bot moves while an engine request is in flight.** A late result for the user's previous position must never show on the bot's turn. Pinned in Task 3: `stale lines after turn change are ignored`.
2. **Checkmate or stalemate on the board.** The card must show `Game over` with no engine request. Pinned in Task 3: `game over: no request, Game over card`.
3. **User plays the "wrong" color for the chosen study opening.** Coaching continues via rules 2/3 and the status line shows the wrong-color message. Pinned in Task 3: `wrong color falls through to book/engine`.
4. **Engine returns a uci that is illegal in the position** (stale or garbled). The card must not crash; treat it as unavailable. Pinned in Task 3: `illegal engine uci → unavailable`.
5. **Opening tree not yet built (`tree` null while loading).** Rules 2/3 must still work engine-only. Pinned in Task 3: `no tree: engine-only`.

---

### Task 1: Counter-picker

**Files:**
- Create: `src/content/coach/counter-picker.js`
- Test: `test/counter-picker.test.js`

**Interfaces:**
- Consumes:
  - `OpeningTree` (`nodeForFen(fen)`, `bookContinuations(node) → [{ san, node }]`, `deepestNamed(sanHistory)`, nodes carry `openings: [{eco, name}]`)
  - `sanToUci(fen, san)` from `src/content/chess/game-state.js`
- Produces: `export function pickBookMove({ fen, sanHistory, tree, engineLines }) → { uci, san, openingName } | null`
  - `engineLines` = `[{ uci, scoreText, depth }]`, best first.
  - `openingName` is resolved in this order: the name on the child node reached by the move (`node.openings[0].name` if any); else `tree.deepestNamed([...sanHistory, san])?.name`; else `null`.
  - Returns `null` when `tree` is falsy, the position isn't in the tree, the node has no children, or no engine line is a book move.

- [ ] **Step 1: Write the failing tests**

Use `OpeningTree.build` on `test/fixtures/eco-sample.json`, and `replay` for FENs.

- `picks the engine-ordered book move`: position after `['e4']`; engineLines `[{uci:'g7g6'}, {uci:'c7c6'}, {uci:'e7e6'}]`. Expect `uci === 'c7c6'` when `g7g6` isn't a book child in the fixture. Otherwise pick the first engine uci that is. Assert against the fixture's actual children: compute `expected` in the test as the first engine uci present among `tree.bookContinuations(node)` mapped to uci.
- `no intersection → null`: same position, engineLines `[{uci:'a7a6'}]`.
- `not in tree → null`: position after `['a3','h6']`.
- `no tree → null`: `tree: null`.
- `opening name after the move`: for the Alien line before `Nxf7` (after `…Ng5 h6`) with engineLines `[{uci:'g5f7'}]`, expect `san === 'Nxf7'` and `openingName === 'Caro-Kann Defense: Alien Gambit'`.

- [ ] **Step 2: Run** `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON test/counter-picker.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `pickBookMove`** in `src/content/coach/counter-picker.js`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: add book-move counter picker`

---

### Task 2: Remove the engine cap and add the Alien Gambit notes

**Files:**
- Modify: `src/content/study/study-tracker.js` (remove `ENGINE_CAP` and the `complete` branch; `continuation()` returns `engine-needed` whenever the user is to move and there's no book child)
- Modify: `src/shared/constants.js` (remove `STUDY.MAX_PAST_TARGET`)
- Modify: `test/study-tracker.test.js` (replace the cap test)
- Modify: `public/opening-notes.json`
- Test: `test/opening-notes.test.js` (existing; must pass with the new keys)

**Interfaces:**
- Produces: tracker never emits the message `Study line complete.`. `userMovesPastTarget` is still reported.

- [ ] **Step 1: Replace the cap test** with `engine-needed persists past 10 moves`: append 20 legal plies after the target (as the old test did). Expect `state === 'reached'`, `nextMove.source === 'engine-needed'`, and the message not containing `Study line complete`.
- [ ] **Step 2: Run** the tracker tests. Expected: FAIL on the new test.
- [ ] **Step 3: Remove the cap** in the tracker and constants. `grep -rn "MAX_PAST_TARGET\|ENGINE_CAP\|Study line complete" src test` → no output.
- [ ] **Step 4: Add notes** (keys = `normalizeFen` of the position *before* the move, computed with `replay`; text exact):

| Moves before | SAN | Note |
|---|---|---|
| `e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Ng5 h6 Nxf7 Kxf7` | `Nf3` | witty_alien's main follow-up: develops with tempo ideas against the exposed king and prepares Ne5+ tricks. |
| `… Kxf7 Nf3` | `Bg4` | Looks like a strong pin, but it's the famous trap: 8.Ne5+ forks the king and the bishop. |
| `… Nf3 Bg4` | `Ne5+` | Forks the king on f7 and the bishop on g4 — Black has only king moves, so White wins the bishop next. |

  - Keep the existing `plan` on the `… Kxf7` key and add `moves.Nf3` to it.
  - On the `… Kxf7 Nf3` key, also set `traps: ["7...Bg4? 8.Ne5+ forks king and bishop"]`.

- [ ] **Step 5: Run** `npm test`. Expected: all pass, including `opening-notes.test.js`, whose R8 reachability rule covers the new keys.
- [ ] **Step 6: Commit** `feat: guide past the book without a cap; add Alien Gambit 7.Nf3 and trap notes`

---

### Task 3: CoachController

**Files:**
- Create: `src/content/coach/coach-controller.js` (replaces `src/content/study/study-controller.js`; delete that file and `test/study-controller.test.js`)
- Delete: `src/content/study/study-view.js` and `test/study-view.test.js` (Try-mode helpers no longer used), unless Task 4 still needs `samePosition`. If so, keep `samePosition` only.
- Test: `test/coach-controller.test.js` (port the timer/stale/blocked tests from the old controller test, adapted)

**Interfaces:**
- Consumes:
  - `evaluate` (tracker)
  - `explain`
  - `pickBookMove` (Task 1)
  - `normalizeFen`, `replay`, `uciToSan`, `legalMoves` (game-state)
  - `STUDY.ENGINE_TIMEOUT_MS`
- Produces: `export class CoachController`
  - `constructor({ tree, notes, requestEngine: (fen) => Promise<Array<{uci, scoreText, depth}>>, cancelEngine: () => void, onUpdate: (view) => void, timeoutMs, setTimeoutFn, clearTimeoutFn })`
  - methods: `setTree(tree)`, `setNotes(notes)`, `setTarget(target|null)`, `setPosition(snapshot)`, `setBlocked(bool)`, `setEngineLoading(bool)`
  - getter `view`
- `CoachView`:

```
{ blocked: boolean,
  target: StudyTarget|null,
  studyMessage: string|null,        // tracker status.message when a target is set
  openingName: string|null,
  card: { kind: 'move'|'waiting'|'thinking'|'loading'|'unavailable'|'syncing'|'gameover'|'idle',
          move: { san, uci, source: 'study'|'book'|'engine', explanation, scoreText|null, depth|null } | null,
          alternatives: Array<{ san, uci }> },
  predictedUci: string|null }
```

- Rules:
  - **No position or blocked:** kind `idle` (blocked: `blocked: true`).
  - **`!synced`:** `syncing`.
  - **No legal moves:** `gameover`.
  - **Not the user's turn** (`turn !== userColor`): `waiting`. `predictedUci` = the tracker's `predictedMove.uci` only when the state is `on-track`. No engine request; cancel any pending one.
  - **User's turn:**
    1. Rule 1 (Global Constraints) → move `source: 'study'`, explanation from `explain({ fen, san, notes })`. Show it immediately (`kind: 'move'`), and still request engine lines for evaluation and alternatives.
    2. Otherwise `kind: 'thinking'` (or `loading` while `setEngineLoading(true)`) until lines arrive.
    3. With lines: rule 1 move stays. Otherwise `pickBookMove` → `source: 'book'`, else line 0 → `source: 'engine'`.
    4. `scoreText`/`depth` come from the matching line, else null. `alternatives` = other lines' moves (max 2, excluding the chosen uci), converted with `uciToSan`.
  - `openingName` = book pick's `openingName`, else `tree?.deepestNamed(sanHistory)?.name ?? null`.
  - Engine cache by `normalizeFen`.
  - Stale results are ignored (identity check).
  - Timeout → `unavailable` (rule 1 move, if any, stays shown).
  - An illegal engine uci (`uciToSan` null) → `unavailable`.
  - Never cache stale or invalid results.

- [ ] **Step 1: Write the failing tests.** Use a fake `requestEngine` with controllable promises, fake timers, the fixture tree, and the Alien target `tree.search('alien')[0]` as `{eco,name,moves: sanMoves, fen, color:'w'}`.
  - `rule 1 study move shown immediately`: history `['e4','c6']`, White to move → `card.kind==='move'`, `move.source==='study'`, `move.san==='d4'`. The engine was requested once.
  - `rule 2 book move from engine lines`: no target, history `['e4']`, user Black. Resolve lines whose second entry is a book child and whose first is not → `source==='book'` with that uci.
  - `rule 3 engine move`: no target, a position not in the tree → `source==='engine'`, `uci === lines[0].uci`, `scoreText` set.
  - `alternatives exclude chosen and max 2`.
  - `bot's turn: waiting, no request`.
  - `stale lines after turn change are ignored`: request on the user's turn, then `setPosition` (bot's turn), then resolve the old promise → card stays `waiting`.
  - `game over: no request, Game over card`: use the fool's-mate position after `['f3','e5','g4','Qh4#']`.
  - `wrong color falls through to book/engine`: Alien target, user Black → `studyMessage` contains `is a White opening`, and the card source is `book` or `engine`.
  - `illegal engine uci → unavailable`.
  - `no tree: engine-only`: `tree: null` → engine move used.
  - `timeout → unavailable, study move kept`.
  - `blocked: no request, blocked view`.
  - `timers are called unbound` (port the browser-like `this` check from `test/timer-binding.test.js`, and update that file to import `CoachController`).
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement `CoachController`.**
- [ ] **Step 4: Run** `npm test`. Expected: all pass, with no references to the deleted modules (`grep -rn "study-controller\|study-view" src test` only shows what Task 4 will remove from `index.js`, or nothing).
- [ ] **Step 5: Commit** `feat: add CoachController (study → book → engine)`

---

### Task 4: Panel, overlay and wiring

**Files:**
- Modify: `src/content/ui/overlay.js`:
  - the template keeps the header (ON, `−`, `✕`) and `#chess-assistant-study` only
  - remove the AUTO/Analyze buttons, `#chess-assistant-moves`, the explorer `<details>`, the suppress-moves code and `displayMoves` usage
  - `setBlocked` no longer writes into the removed moves container
  - every handler must tolerate removed elements
- Modify: `src/content/ui/study-panel.js` → render a `CoachView` per spec §3:
  - opening name line
  - the card (big SAN, badge, explanation, `scoreText · depth N`, `Also good: …`)
  - a `Learn an opening` row (`Choose…` / target name + `✎`, plus `Stop learning`)
  - a study status line
  - picker = search + recent, no color switch; Esc closes it
- Modify: `src/content/index.js`:
  - create a `CoachController` instead of the study controller
  - `requestEngine(fen)` resolves with `topMoves.slice(0,3).map(m => ({ uci: m.move, scoreText: this.overlay.formatScore(m), depth: m.depth }))`
  - `cancelEngine` clears `pendingEngine` **and** calls `analysisService.stopAnalysis()`
  - `analysisService.onLoading` → `coach.setEngineLoading(true)`; first engine output → `setEngineLoading(false)`
  - `onPositionChanged` only gates and forwards to the controller (no direct `overlay.analyze()`)
  - remove `toggleStudyMode`, the S/H/O shortcuts (keep Esc), the repertoire/explorer wiring and the `displayMoves` calls
  - arrows: on `kind:'move'` draw the solid arrow for `card.move.uci` and the dashed one for `predictedUci`; on `waiting` draw dashed only; otherwise clear
  - target color = `defaultStudyColor(sanMoves)`
  - `Stop learning` → `setTarget(null)` and save
- Modify: `src/styles/overlay.css` (card styles: big move, badge colors, small alternatives; remove styles that are now unused, only if trivially safe)
- Modify: `src/shared/constants.js` (drop `AUTO_ANALYZE` from defaults only if nothing reads it; otherwise leave)

**Interfaces:**
- Consumes: `CoachController`/`CoachView` (Task 3), `MoveHighlighter.drawStudyArrows/clearStudyArrows`, `OpeningTree.search`, `updateRecent`, `defaultStudyColor`.

- [ ] **Step 1: Implement** per the file list. Check: `grep -n innerHTML src/content/ui/study-panel.js` → no output.
- [ ] **Step 2: Verify:** `npm test && npm run build:chrome && npm run build:firefox` pass, and eslint shows no new errors in the changed files.
- [ ] **Step 3: Browser check** with the scratchpad harness (local chess.com mock + Chromium + the extension). Report the card text in each case:
  - a mock position in the Alien line with White to move → card `d4`/`Nc3`… with `Study`
  - a position out of book → `Engine` move with a score
  - after the bot moves → `Waiting for the bot…`
  - `/play/online` → blocked copy
- [ ] **Step 4: Commit** `feat: single best-move card; remove try mode, shortcuts and top-3 list`

---

### Task 5: README

**Files:**
- Modify: `README.md`:
  - replace the Show/Try, shortcuts and top-3 descriptions with the best-move card
  - describe the Study → Book → Engine order
  - update "Study an opening" (pick, no color choice, Stop learning)
  - update the manual checklist steps to the new UI
  - keep the Edge install and "Where assistance works" sections

- [ ] **Step 1: Edit**, checking every claim against `src/content/ui/study-panel.js` and `src/content/index.js`.
- [ ] **Step 2: Commit** `docs: describe the best-move coach`
