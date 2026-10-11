# Best-Move Coach — Design Spec

- **Date:** 2026-10-11
- **Status:** Draft, awaiting review
- **Builds on:** `2026-10-09-study-opening-design.md` (PR #1). The context gate, live sync, opening tree, explainer, tracker and engine bridge are reused as they are.

## 1. Goal

In a Chess.com bot game, on every user turn from move 1 until the game ends, show **one best move**: an arrow on the board and a one-line reason. The user makes no choices beyond optionally picking an opening to learn.

The move comes from the first rule that applies:

1. **Study**: the user picked an opening to learn and the game still fits it. Show that opening's next move.
2. **Book**: the position is still in opening theory. Show the book move Stockfish rates best, which is the best counter to the bot's opening.
3. **Engine**: otherwise, show Stockfish's best move.

Non-goals: Ghost Mode, an online engine fallback, user-facing settings for any of this.

## 2. Simplicity rule

The extension decides; the user is not asked. In this design that means:

- No Show/Try toggle. The move is always shown.
- No color switch when picking an opening. The color comes from the opening: the side that plays its last move.
- No AUTO/MANUAL or Analyze buttons. Analysis always runs automatically on the user's turn.
- No keyboard shortcuts, except Esc to close the opening picker.
- The Opening Explorer and Repertoire section is removed from the panel. Its code may stay but is no longer rendered.
- The header keeps only ON/OFF, collapse (−) and hide (✕).

## 3. Panel

```
┌ ♟ Chess Assistant          ON  −  ✕ ┐
│ Sicilian Defense: Alapin Variation   │  ← current opening name (or blank)
│ ┌──────────────────────────────────┐ │
│ │  2.c3                    [Book]  │ │  ← best move, large, with a source badge
│ │  Prepares d4 to build a full     │ │  ← explainer text (1–3 phrases)
│ │  pawn center.                    │ │
│ │  +0.3 · depth 15                 │ │  ← engine evaluation (when known)
│ │  Also good: 2.Nf3 · 2.Nc3        │ │  ← engine #2/#3 (small)
│ └──────────────────────────────────┘ │
│ 📚 Learn an opening: Alien Gambit ✎  │  ← optional; "Choose…" when none
│ ↳ On the Alien Gambit line            │  ← study status line, only when set
└──────────────────────────────────────┘
```

- **Bot's turn:** the card shows `Waiting for the bot…`. When the study line is on track, it also shows the dashed arrow and "The line needs 3...dxe4".
- **Game over:** the card shows `Game over`.
- **Badges:** `Study`, `Book`, `Engine`.
- **Blocked pages:** only `Assistance is off in games against people.`, as today.

## 4. How the move is chosen

### 4.1 Engine on every user turn

- When the position changes and it is the user's turn, the extension asks Stockfish for its top 3 lines at the depth set in the popup. This is the existing MultiPV-3 analysis.
- On the bot's turn it does not analyze. Any analysis still running is stopped when the position changes.
- The engine bridge returns all three lines: `[{ uci, scoreText, depth }]`, best first.
- The controller's existing cache, stale-request discard and 8 s timeout stay. On timeout the card shows `Engine unavailable — retrying on the next move`.

### 4.2 Rule 1: Study (unchanged tracker, minus the cap)

- The study tracker from PR #1 decides on-track, reached and deviated exactly as before.
- **Remove** the 10-user-move engine cap (`ENGINE_CAP`, `STUDY.MAX_PAST_TARGET`) and the `Study line complete.` state.
- Rule 1 applies only when the tracker gives a **book** next move for the user (on-track, or reached with a book continuation). The card uses that move with the notes/book explanation.
- In every other case (deviated, past the book, wrong color, line finished), rules 2 and 3 fill the card. The study line still shows the tracker's message, for example `This game left the Alien Gambit line — watching for a transposition back.`
- **Wrong color:** the status line shows the existing wrong-color message, and the card uses rules 2 and 3.

### 4.3 Rule 2: Book (new, `src/content/coach/counter-picker.js`, pure)

`pickBookMove({ fen, tree, engineLines }) → { uci, san, openingName } | null`

- `node = tree.nodeForFen(fen)`. If there is no node or it has no children, return `null`.
- Candidates are the node's book children, each with its uci (from SAN) and `subtreeSize`.
- Return the first engine line (in engine order) whose uci is a book candidate.
- If no engine line is a book move, return `null`, and rule 3 applies.
- `openingName` = the name of the deepest named node after playing the move. If there is none, use `tree.deepestNamed` of the current history.

Engine lines are required. Before the engine answers, the card shows `Thinking…`. A book move that Stockfish rejects is never shown.

### 4.4 Rule 3: Engine

The first engine line, explained via `explain({ fen, san, notes, engine })`.

### 4.5 Alternatives and evaluation

- `Also good:` lists the other engine lines (up to 2) that differ from the chosen move.
- The evaluation and depth come from the engine line of the chosen move. If the chosen move is a study move that isn't among the engine lines, the evaluation is omitted.

## 5. Opening picker (simplified)

- The picker has a search box and the recent list. Clicking a result sets the target. There is no color switch.
- Target color = the side that plays the line's last move (existing `defaultStudyColor`).
- A `Stop learning` link clears the target.
- The target is stored as today (`studyTarget`, `studyRecent`).

## 6. Alien Gambit notes (additions)

Added to `public/opening-notes.json`. Keys are normalized FENs before the move. All of this is verified with chess.js.

| Position after | Move | Note |
|---|---|---|
| … 6.Nxf7 Kxf7 | `Nf3` | witty_alien's main follow-up: develops with tempo ideas against the exposed king and prepares Ne5+ tricks. |
| … 7.Nf3 | `Bg4` | Looks like a strong pin, but it's the famous trap: 8.Ne5+ forks the king and the bishop. |
| … 7...Bg4 | `Ne5+` | Forks the king on f7 and the bishop on g4. Black has only king moves, so White wins the bishop next. |

- The existing plan text on the position after 6...Kxf7 stays.
- Add `traps: ["7...Bg4? 8.Ne5+ forks king and bishop"]` to the position after 7.Nf3.

## 7. Arrows

- **Solid arrow:** the card's move, on the user's turn.
- **Dashed arrow:** only for the study line's expected bot reply, on the bot's turn.
- The analysis hover-highlight on the old top-3 list goes away with that list.

## 8. Error handling

| Case | Card |
|---|---|
| Engine still loading | `Engine loading…` |
| Engine timeout or failure | Rule 1 (study) still shows its move, since it needs no engine; otherwise `Engine unavailable — retrying on the next move` |
| Out of sync | `Syncing with board…` |
| Opening data missing | rules 2 and 3 fall back to the engine only; the picker shows `Opening data unavailable` |

## 9. Testing

**Automated (`node --test`):**
- `counter-picker.test.js`:
  - book ∩ engine picks the engine-ordered book move
  - no intersection gives `null`
  - not in the tree gives `null`
  - opening name after the move
- `study-tracker.test.js`: the cap tests are replaced by "engine-needed persists past 10 moves".
- `study-controller.test.js` (coach):
  - each rule chosen correctly
  - alternatives exclude the chosen move
  - bot's turn produces no engine request
  - stale and timeout behavior kept
- `opening-notes.test.js`: the new keys and moves are legal and reachable.

**Manual (Edge, `/play/computer`):**
- A full game shows a move every turn until checkmate.
- With the Alien Gambit chosen and the bot playing the Caro-Kann, the card follows the line, including 7.Nf3 and the trap note.
- When the bot deviates, the card switches to Book or Engine and names the new opening.
- `/play/online` stays blocked.

## 10. Changes to existing behavior

- The Show/Try mode, keyboard shortcuts (except Esc), color switch, AUTO and Analyze buttons, the top-3 list and the Opening Explorer/Repertoire section are removed from the UI.
- The engine runs only on the user's turn.
- The 10-move engine cap is removed.
