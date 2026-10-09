# Study Opening — Design Spec

- **Date:** 2026-10-09
- **Status:** Draft, awaiting review
- **Scope:** Sub-project 0 (Foundation) + Sub-project A (Study Opening) of the Opening Coach roadmap

## 1. Goal

Let the user pick one opening to study (e.g. *Caro-Kann Defense: Alien Gambit*, B15) and, while playing a Chess.com **computer-bot** game, have the extension:

1. Tell them whether the opening is reachable from the current game.
2. Guide them move by move while they are on the line.
3. Explain each guided move using facts verifiable in the actual position.
4. Detect when either side leaves the line, name the new opening, and keep guiding.

Assistance must only ever appear in confirmed bot or analysis contexts.

### Success criteria

- In a `/play/computer` game, choosing "Alien Gambit" shows the right book move (or prompt, in Try mode) on every user turn while on the line, waits correctly on bot turns, and reports `reached` after 6.Nxf7.
- A bot deviation (e.g. 3...e6) is reported by name within one position update, and guidance continues from Book or Engine.
- On any non-allow-listed page (e.g. `/play/online`, `/game/live/...`), no suggestion, arrow, or engine request is produced, including from the pre-existing features.
- All automated tests listed in §9.1 pass with `npm test`.
- The Chrome MV3 build loads unpacked in Microsoft Edge.

## 2. Roadmap context (out of scope here)

| # | Sub-project | Status |
|---|---|---|
| 0 | Foundation: context gate, rules engine, live sync, test harness | **This spec** |
| A | Study Opening | **This spec** |
| B | Ghost Mode | Later spec |
| C | Opponent-opening recognition and counter recommendations | Later spec |
| D | Typed arrows (primary/alternative/predicted/plan) and broader explanations | Later spec |
| E | Learn / Practice / Test modes, progress tracking, spaced repetition | Later spec |

Also out of scope: lichess AI-game support, the lichess opening-explorer API, and new features for the Firefox build (it must still build).

## 3. Existing code reused

| Existing | Reuse |
|---|---|
| `src/content/services/opening-explorer.js` (loads `ecoA–E.json`) | Data loading. The new opening tree consumes the same entries. |
| `src/content/chess/board-parser.js` | Board-orientation and piece-position reading, used as a cross-check for live sync. |
| `src/content/services/analysis-service.js` + `src/background/*` | Stockfish requests for Engine fallback. |
| `src/content/chess/move-highlighter.js` | Arrow drawing, extended with a dashed style. |
| `src/content/ui/overlay.js`, `src/styles/overlay.css` | Panel. The Study section is added in the existing visual language. |
| `src/shared/storage.js`, `constants.js` | Settings persistence and new keys. |
| `scripts/build.js` (custom regex bundler) | Unchanged. New modules use only relative `import { … } from './x'` and `export class/const/function`. |

## 4. Foundation (sub-project 0)

### 4.1 Context gate — `src/content/context/context-gate.js`

`ContextGate.classify(url) → 'training' | 'blocked'`. Unknown pages are `blocked`.

| Host | Allowed paths (`training`) |
|---|---|
| `www.chess.com` | `/play/computer` (and sub-paths), `/game/computer/<id>`, `/analysis` (and sub-paths) |
| `lichess.org` | `/analysis` (and sub-paths) |

Everything else is `blocked`: `/play/online`, `/game/live/…`, `/game/daily/…`, `/game/<id>`, lichess game pages, and unknown paths.

Behavior:

- Re-checked on `popstate`, on wrapped `history.pushState`/`replaceState`, and by a 1 s interval.
- On `training → blocked`, within the same tick it stops analysis via the existing `stop` path, clears arrows and highlights, and disables Analyze and auto-analysis. The panel shows *"Assistance is off in games against people."*
- **Applies to all existing features.** Analyze, auto-analysis, top-3 suggestions, and opening-explorer engine lines no longer run on blocked pages. This is an intentional behavior change and is documented in the README.
- No override setting.

### 4.2 Rules engine — `src/vendor/chess.js`, `src/content/chess/game-state.js`

- Vendor chess.js (v1.x, BSD-2-Clause, license header kept), adapted to the bundler: a single `export class Chess` plus any needed `export const`.
- `GameState` wraps it:
  - `fromMoves(sanList) → { ok, fen, history, badIndex }`
  - `legalMoves(fen)`
  - `sanToUci(fen, san)` / `uciToSan(fen, uci)`
  - `normalizeFen(fen)`: first four FEN fields, used as the position key.

### 4.3 Live sync — `src/content/chess/live-sync.js`

- Reads the Chess.com move list (`.move-list .node`, `wc-simple-move-list .node`). For figurine nodes it reads the piece letter from `[data-figurine]` and prefixes it to the text. It also reads the lichess analysis move list (`l4x kwdb`).
- Replays the moves through `GameState`. An illegal move at index *i* means the state is `unsynced`.
- Cross-checks the replayed placement field against `board-parser.js`'s parsed board. On mismatch the state is `unsynced`, the move list is trusted for history, and guidance is withheld until they agree.
- User color comes from board orientation (existing detection).
- Emits `positionChanged { sanHistory, fen, turn, userColor, synced }` on change only, debounced 150 ms. Driven by a `MutationObserver` on the move list plus the existing polling as a fallback.
- `content/index.js` consumes this event for both existing analysis triggers and the study tracker. Its private `getPlayedMoves()` is replaced by the live-sync history.

## 5. Study Opening (sub-project A)

### 5.1 Opening tree — `src/content/study/opening-tree.js`

- Built from the loaded ECO entries. Each entry's `moves` string is tokenized (move numbers stripped) and replayed with `GameState`. Entries that fail to replay are skipped and logged.
- **Trie** over SAN moves. Each node holds `{ san, fen, children: Map, openings: [{eco, name}] }`.
- **FEN index** `Map<normalizedFen, node>` for transposition detection (first node wins).
- API:
  - `search(query, limit = 20)`: case-insensitive. Every whitespace-separated token must appear in `name`, or the query matches `eco` exactly. Ranked by exact ECO match, then name-prefix match, then shorter line.
  - `nodeForMoves(sanHistory)` / `nodeForFen(fen)`.
  - `deepestNamed(sanHistory)`: the deepest node along the history that names an opening, for naming the current opening after a deviation.
  - `bookContinuations(node)`: children ordered by subtree size (proxy for mainline-ness).

### 5.2 Study target

Stored under storage key `studyTarget`:

```json
{ "eco": "B15", "name": "Caro-Kann Defense: Alien Gambit",
  "moves": ["e4","c6","d4","d5","Nc3","dxe4","Nxe4","Nf6","Ng5","h6","Nxf7"],
  "fen": "<normalized target fen>", "color": "w", "mode": "show" }
```

- `color` defaults to the side that plays the line's last move, and is user-switchable.
- `mode` is `"show"` (default) or `"try"`.
- `studyRecent`: the last 10 targets (by `eco` + `name`), most recent first.

### 5.3 Study tracker — `src/content/study/study-tracker.js`

Pure logic with no DOM access. `evaluate({ target, sanHistory, fen, turn, userColor, synced, tree }) → StudyStatus`:

| State | Condition | Payload |
|---|---|---|
| `syncing` | `!synced` | none |
| `wrong-color` | `userColor !== target.color` | message |
| `on-track` | history is a prefix of `target.moves`, **or** `normalizeFen(fen)` equals the position after some prefix of the target line (transposition) | user turn: `nextMove` (SAN/UCI) + explanation; bot turn: `awaiting` = remaining opponent moves in the line, `predictedMove` = the next one |
| `reached` | position equals the target position, or the game has continued from it | `nextMove` from `bookContinuations` (source **Book**), else from Engine for up to 10 further user moves past the target, then a stop message |
| `opponent-deviated` | the first off-line move was the opponent's | `newOpening` = `deepestNamed(history)`, `reachable: false` unless a later position re-enters the target line by FEN (then back to `on-track`), plus `nextMove` from that family's book, else Engine |
| `you-deviated` | the first off-line move was the user's | `bookMove` that was expected + its explanation. Afterwards behaves like `opponent-deviated` for continuation |

Every `nextMove` carries `source: 'book' | 'notes' | 'engine'`. Guidance never makes or submits a move.

Engine fallback: requests go through `AnalysisService` at the configured depth. A new position cancels the in-flight request. Results are cached in a session `Map<normalizedFen, {uci, scoreText, depth}>`. Timeout is 8 s, after which the card shows *"Engine unavailable"*.

### 5.4 Notes — `public/opening-notes.json`

```json
{ "<normalized fen>": {
    "moves": { "<SAN>": "short explanation" },
    "plan": "optional next-objective sentence",
    "traps": ["optional, only well-established traps"] } }
```

- Shipped entries cover the Caro-Kann start (1.e4 c6, 2.d4 d5, 3.Nc3 dxe4, 4.Nxe4 Nf6) and the Alien Gambit (5.Ng5, 5...h6, 6.Nxf7, and the position after 6...Kxf7).
- Content is limited to well-established facts, including the honest assessment: White gets two pawns and pressure on the exposed black king for the knight; engines assess it as favorable for Black.
- Added to `web_accessible_resources` in both manifests and copied by the build.

## 6. Explanations — `src/content/study/explainer.js`

Pure function `explain({ fenBefore, san, notes, engine }) → { text, source }`. Rules are applied in this order, and output is capped at 3 phrases:

1. Notes text for (fen, SAN). If present, source is `notes`.
2. **Develops:** a minor piece leaves its starting square.
3. **Center:** which of d4/d5/e4/e5 the moved piece occupies or attacks after the move.
4. **Attack:** a newly attacked enemy piece that is either higher-valued than the mover or attacked more often than defended.
5. **Capture/sacrifice:** material delta by standard values (1/3/3/5/9). A negative delta after the opponent's best recapture (one-ply check) is phrased as *"Gives up a <piece> for <material>."*
6. Check, castling, or opening a line for a bishop, rook, or queen.
7. **Opponent threat** (computed before the move): opponent captures available with null-move semantics that win material.
8. **Next objective:** from notes `plan`, else a principle rule (castle if uncastled and possible → develop the remaining minors → connect the rooks).
9. Engine moves append `"<score> at depth <d>"`.

No claim is made that these rules cannot verify. Traps appear only from notes.

## 7. UI

### 7.1 Panel (`overlay.js`, `overlay.css`)

The new **Study** section sits at the top. The existing Opening Explorer and Repertoire sections remain below, collapsed by default.

- **Header:** name + ECO, color badge, **Show/Try** toggle, **Change** button.
- **Status line:** tracker state sentence + source badge (Book / Notes / Engine).
- **Move card:** Show mode displays the move large, with the explanation below. Try mode displays *"Find the book move"* + a **Show me** button, and reveals the move plus feedback on `you-deviated`.
- **Picker** (inline in the panel): search input with live results (ECO, name, first moves), a Recent list, and a White/Black switch.
- **Blocked context:** the section shows only *"Assistance is off in games against people."*
- All data- and user-derived text is inserted via `textContent` / DOM nodes, never `innerHTML`.

### 7.2 Arrows (`move-highlighter.js`)

- Add `style: 'solid' | 'dashed'` to `drawArrow`.
- **Solid:** the user's next book or engine move. Only drawn in Show mode, or after Show me in Try mode.
- **Dashed:** the opponent's hoped-for reply while `on-track` on the bot's turn.
- Arrows are redrawn on window `resize` and on orientation change.

### 7.3 Keyboard shortcuts

Active only when focus is not in an input, textarea, or contenteditable element:

| Key | Action |
|---|---|
| `S` | Toggle Show/Try |
| `H` | Show me |
| `O` | Open picker |
| `Esc` | Close picker |

## 8. Error handling

| Failure | Behavior |
|---|---|
| ECO file missing or entry won't replay | Skip and log. If the tree is empty: *"Opening data unavailable"*, search disabled. |
| Notes file missing or invalid | Continue without notes. |
| Move list and board disagree | `syncing` state, no guidance, no deviation reported. |
| Engine timeout or crash | *"Engine unavailable"*. Book and notes guidance continue. |
| Storage read/write fails | Use in-memory defaults and show *"Couldn't save study settings."* |
| Gate flips to `blocked` | Clear guidance and arrows and stop the engine in the same tick. |

## 9. Testing

### 9.1 Automated (`node --test`, `test/*.test.js`)

`package.json` gets `"test": "node --test test/"`. Running tests requires Node ≥ 22 (automatic ES-module syntax detection for `.js` files, so `package.json` keeps no `"type"` field and the CommonJS build script is untouched); building still works on the documented Node ≥ 16. Tests import the source ES modules directly. DOM-dependent code is split so its logic is a pure function: live sync exposes `extractMoves(nodes)`, which takes plain objects `{ text, figurine, classes }`; the thin DOM adapter that builds those objects is covered by manual testing only.

| File | Covers |
|---|---|
| `context-gate.test.js` | Allow/block URL table, including `/play/online`, `/game/live/1`, `/game/computer/1`, `/analysis`, lichess `/abcd1234` |
| `game-state.test.js` | Replay valid/invalid SAN lists, SAN↔UCI, FEN normalization |
| `live-sync.test.js` | Move extraction from figurine, text-only, and empty move-list fixtures |
| `opening-tree.test.js` | Build from a fixture ECO subset; `search('alien')` → B15; transposition by FEN; `deepestNamed` after a deviation |
| `study-tracker.test.js` | Full Alien Gambit walk (both turns), `reached`, `opponent-deviated` (3...e6), `you-deviated` (5.Nxf6+), `wrong-color`, `syncing`, re-entry by transposition |
| `explainer.test.js` | 1.Nf3 develops and controls e5/d4; 6.Nxf7 flagged as a sacrifice; opponent-threat detection; no trap text without notes |
| `opening-notes.test.js` | Every notes FEN key is reachable in the tree; every notes SAN is legal in its position |

### 9.2 Manual (README checklist, Microsoft Edge)

1. `npm run build:chrome`, then `edge://extensions` → Developer mode → Load unpacked → `dist/chrome`.
2. `/play/computer` as White: pick Alien Gambit; follow the line; confirm book moves, dashed bot predictions, `reached`.
3. Bot deviates: confirm the new opening name and continued guidance.
4. Try mode: Show me, wrong move feedback.
5. As Black: `wrong-color` message.
6. `/play/online` and a `/game/live/…` page: nothing shown and no engine activity.
7. Resize the window and flip the board: arrows stay aligned.

## 10. Edge compatibility

The Chrome MV3 build is used unchanged in Edge (MV3 and the offscreen API are supported). The README gains an *Install in Microsoft Edge* section.

## 11. Changes to existing behavior

- All engine assistance is disabled outside allow-listed pages (§4.1), including lichess game pages and Chess.com human games.
- The Opening Explorer and Repertoire sections are collapsed by default under the new Study section.
- `getPlayedMoves()` is replaced by live-sync history (figurine-aware).
