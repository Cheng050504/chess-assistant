import { STUDY } from '../../shared/constants.js';
import { evaluate } from '../study/study-tracker.js';
import { explain } from '../study/explainer.js';
import { pickBookMove } from './counter-picker.js';
import { normalizeFen, uciToSan, legalMoves } from '../chess/game-state.js';

// Decides the single best move for the user's turn: Study → Book → Engine (spec §4).
// Pure: no DOM or chrome access.
export class CoachController {
  constructor({
    tree, notes, requestEngine, cancelEngine, onUpdate,
    timeoutMs = STUDY.ENGINE_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  }) {
    this.tree = tree || null;
    this.notes = notes || {};
    this.requestEngine = requestEngine;
    this.cancelEngine = cancelEngine;
    this.onUpdate = onUpdate;
    this.timeoutMs = timeoutMs;
    // Wrap so the timers are never called as methods of this object; browsers throw
    // "Illegal invocation" when setTimeout/clearTimeout get a foreign `this`.
    this.setTimeoutFn = (fn, ms) => setTimeoutFn(fn, ms);
    this.clearTimeoutFn = (id) => clearTimeoutFn(id);

    this.target = null;
    this.position = null;
    this.blocked = false;
    this.engineLoading = false;
    this.cache = new Map(); // normalizeFen → validated engine lines
    this.pending = null; // { key, timer }
    this.failedKey = null; // position whose engine request timed out or failed
    this._view = this._baseView();
  }

  get view() {
    return this._view;
  }

  setTree(tree) { this.tree = tree || null; this._recompute(); }
  setNotes(notes) { this.notes = notes || {}; this._recompute(); }
  setTarget(target) { this.target = target || null; this._recompute(); }
  setBlocked(blocked) { this.blocked = !!blocked; this._recompute(); }
  setEngineLoading(loading) { this.engineLoading = !!loading; this._recompute(); }

  setPosition(position) {
    const key = position && position.fen ? normalizeFen(position.fen) : null;
    if (key !== this.failedKey) this.failedKey = null;
    this.position = position || null;
    this._recompute();
  }

  _baseView() {
    return {
      blocked: this.blocked, target: this.target, studyMessage: null, openingName: null,
      card: { kind: 'idle', move: null, alternatives: [] }, predictedUci: null
    };
  }

  _publish(view) {
    this._view = view;
    this.onUpdate(view);
  }

  _cancelPending() {
    if (!this.pending) return;
    this.clearTimeoutFn(this.pending.timer);
    this.pending = null;
    this.cancelEngine();
  }

  _recompute() {
    const view = this._baseView();
    const position = this.position;
    const wantKey = this._fill(view, position);
    if (this.pending && this.pending.key !== wantKey) this._cancelPending();
    if (wantKey && !this.pending) this._startEngine(position.fen, wantKey);
    this._publish(view);
  }

  // Fills `view` in place; returns the normalized FEN the engine must analyze, or null.
  _fill(view, position) {
    if (this.blocked || !position) return null;
    const card = view.card;
    if (!position.synced) { card.kind = 'syncing'; return null; }
    let legal;
    try { legal = legalMoves(position.fen); } catch (e) { card.kind = 'syncing'; return null; }
    if (!legal.length) { card.kind = 'gameover'; return null; }

    const tree = this.tree;
    const sanHistory = position.sanHistory || [];
    view.openingName = (tree && tree.deepestNamed(sanHistory) || {}).name || null;
    let status = null;
    if (this.target && tree) {
      status = evaluate({ target: this.target, position, tree });
      view.studyMessage = status.message || null;
    }

    if (position.turn !== position.userColor) {
      card.kind = 'waiting';
      if (status && status.state === 'on-track' && status.predictedMove) view.predictedUci = status.predictedMove.uci;
      return null;
    }

    const fen = position.fen;
    const key = normalizeFen(fen);
    const study = status && (status.state === 'on-track' || status.state === 'reached') &&
      status.nextMove && status.nextMove.source === 'book' && status.nextMove.uci
      ? status.nextMove : null;
    const lines = this.cache.get(key);
    if (lines) {
      this._fromLines(view, fen, sanHistory, lines, study);
      return null;
    }
    if (study) {
      card.kind = 'move';
      card.move = this._move(fen, study.san, study.uci, 'study', null);
    } else {
      card.kind = this.failedKey === key ? 'unavailable' : this.engineLoading ? 'loading' : 'thinking';
    }
    return this.failedKey === key ? null : key;
  }

  _fromLines(view, fen, sanHistory, lines, study) {
    const card = view.card;
    let chosen = study ? { san: study.san, uci: study.uci, source: 'study' } : null;
    if (!chosen) {
      const book = pickBookMove({ fen, sanHistory, tree: this.tree, engineLines: lines });
      if (book) {
        chosen = { san: book.san, uci: book.uci, source: 'book' };
        if (book.openingName) view.openingName = book.openingName;
      } else {
        chosen = { san: uciToSan(fen, lines[0].uci), uci: lines[0].uci, source: 'engine' };
      }
    }
    const line = lines.find((l) => l.uci === chosen.uci) || null;
    card.kind = 'move';
    card.move = this._move(fen, chosen.san, chosen.uci, chosen.source, line);
    card.alternatives = lines
      .filter((l) => l.uci !== chosen.uci)
      .filter((l, i, all) => all.findIndex((o) => o.uci === l.uci) === i)
      .slice(0, 2)
      .map((l) => ({ san: uciToSan(fen, l.uci), uci: l.uci }));
  }

  _move(fen, san, uci, source, line) {
    // R6: the score goes only in the card's score line, not the explanation.
    const explanation = explain({ fen, san, notes: this.notes });
    return {
      san, uci, source, explanation,
      scoreText: line ? line.scoreText ?? null : null,
      depth: line ? line.depth ?? null : null
    };
  }

  // Lines are usable only when non-empty and every uci is legal in `fen`.
  _validLines(fen, lines) {
    if (!Array.isArray(lines) || !lines.length) return null;
    for (const l of lines) if (!l || !uciToSan(fen, l.uci)) return null;
    return lines.map((l) => ({ uci: l.uci, scoreText: l.scoreText ?? null, depth: l.depth ?? null }));
  }

  _startEngine(fen, key) {
    const entry = { key, timer: null };
    this.pending = entry;
    const fail = (cancel) => {
      if (this.pending !== entry) return;
      this.clearTimeoutFn(entry.timer);
      this.pending = null;
      this.failedKey = key;
      if (cancel) this.cancelEngine();
      this._recompute();
    };
    entry.timer = this.setTimeoutFn(() => fail(true), this.timeoutMs);

    let promise;
    try {
      promise = Promise.resolve(this.requestEngine(fen));
    } catch (e) {
      promise = Promise.reject(e);
    }
    promise.then((result) => {
      if (this.pending !== entry) return; // stale: the position changed
      const lines = this._validLines(fen, result);
      if (!lines) return fail(false);
      this.clearTimeoutFn(entry.timer);
      this.pending = null;
      this.cache.set(key, lines);
      try {
        this._recompute();
      } catch (e) {
        this.cache.delete(key);
        this.failedKey = key;
        this._recompute();
      }
    }).catch(() => fail(false));
  }
}
