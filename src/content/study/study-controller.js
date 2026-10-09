import { STUDY } from '../../shared/constants.js';
import { evaluate } from './study-tracker.js';
import { explain } from './explainer.js';
import { normalizeFen, replay, sanToUci, uciToSan } from '../chess/game-state.js';

// Orchestrates tracker + explainer + engine into a StudyView. Pure: no DOM or chrome access.
export class StudyController {
  constructor({
    tree, notes, requestEngine, cancelEngine, onUpdate,
    timeoutMs = STUDY.ENGINE_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  }) {
    this.tree = tree;
    this.notes = notes;
    this.requestEngine = requestEngine;
    this.cancelEngine = cancelEngine;
    this.onUpdate = onUpdate;
    this.timeoutMs = timeoutMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;

    this.target = null;
    this.mode = 'show';
    this.position = null;
    this.blocked = false;
    this.hintRevealed = false;
    this.cache = new Map();
    this.pending = null; // { key, timer }
    this.engineState = 'idle';
    this._view = this._emptyView();
  }

  get view() {
    return this._view;
  }

  setTarget(target) {
    this.target = target || null;
    this.mode = this.target && this.target.mode === 'try' ? 'try' : 'show';
    this.hintRevealed = false;
    this._cancelPending();
    this._recompute();
  }

  setMode(mode) {
    this.mode = mode === 'try' ? 'try' : 'show';
    if (this.target) this.target = { ...this.target, mode: this.mode };
    this._rebuild();
  }

  setPosition(position) {
    this.position = position;
    this.hintRevealed = false;
    this._cancelPending();
    this._recompute();
  }

  revealHint() {
    this.hintRevealed = true;
    this._rebuild();
  }

  setBlocked(blocked) {
    this.blocked = !!blocked;
    this._cancelPending();
    this._recompute();
  }

  _emptyView() {
    return {
      blocked: this.blocked, target: this.target, mode: this.mode, status: null,
      move: null, revealed: false, predictedUci: null, engineState: 'idle'
    };
  }

  _cancelPending() {
    if (this.pending) {
      this.clearTimeoutFn(this.pending.timer);
      this.pending = null;
      this.cancelEngine();
    }
    this.engineState = 'idle';
  }

  _publish(view) {
    this._view = view;
    this.onUpdate(view);
  }

  // Re-render the current view without touching a pending engine request.
  _rebuild() {
    if (this.pending || this.engineState === 'unavailable') {
      this._publish({ ...this._view, ...this._flags() });
    } else {
      this._recompute();
    }
  }

  _flags() {
    return {
      blocked: this.blocked,
      target: this.target,
      mode: this.mode,
      revealed: this.mode === 'show' || this.hintRevealed
    };
  }

  _recompute() {
    const base = { ...this._emptyView(), ...this._flags(), engineState: this.engineState };
    if (this.blocked || !this.target || !this.position) {
      base.revealed = this.target && !this.blocked ? base.revealed : false;
      this.engineState = 'idle';
      base.engineState = 'idle';
      return this._publish(base);
    }

    const position = this.position;
    const status = evaluate({ target: this.target, position, tree: this.tree });
    const view = { ...base, status, predictedUci: status.predictedMove ? status.predictedMove.uci : null };
    const next = status.nextMove;

    if (next && next.source === 'book') {
      view.move = this._bookMove(position.fen, next.san, next.uci);
    } else if (next && next.source === 'engine-needed') {
      const key = normalizeFen(position.fen);
      const cached = this.cache.get(key);
      if (cached) {
        view.move = this._engineMove(position.fen, cached);
      } else {
        this.engineState = 'pending';
        view.engineState = 'pending';
        this._startEngine(position.fen, key);
      }
    } else if (status.state === 'you-deviated' && status.bookMove) {
      const g = replay(position.sanHistory.slice(0, -1));
      if (g.ok) {
        view.move = this._bookMove(g.fen, status.bookMove, sanToUci(g.fen, status.bookMove));
        view.revealed = true;
      }
    }
    this._publish(view);
  }

  _bookMove(fen, san, uci) {
    const explanation = explain({ fen, san, notes: this.notes });
    return { san, uci, source: explanation.source, explanation };
  }

  _engineMove(fen, result) {
    const san = uciToSan(fen, result.uci);
    const explanation = explain({
      fen, san, notes: this.notes,
      engine: { scoreText: result.scoreText, depth: result.depth }
    });
    return { uci: result.uci, san, source: 'engine', explanation };
  }

  _startEngine(fen, key) {
    const entry = { key, timer: null };
    this.pending = entry;
    entry.timer = this.setTimeoutFn(() => {
      if (this.pending !== entry) return;
      this.pending = null;
      this.engineState = 'unavailable';
      this.cancelEngine();
      this._publish({ ...this._view, engineState: 'unavailable' });
    }, this.timeoutMs);

    const fail = () => {
      if (this.pending !== entry) return;
      this.clearTimeoutFn(entry.timer);
      this.pending = null;
      this.engineState = 'unavailable';
      this._publish({ ...this._view, engineState: 'unavailable' });
    };

    let promise;
    try {
      promise = Promise.resolve(this.requestEngine(fen));
    } catch (e) {
      promise = Promise.reject(e);
    }
    promise.then((result) => {
      if (this.pending !== entry) return; // stale: user left this position
      if (!result || !uciToSan(fen, result.uci)) return fail();
      let move;
      try {
        move = this._engineMove(fen, result);
      } catch (e) {
        return fail();
      }
      this.cache.set(key, result);
      this.clearTimeoutFn(entry.timer);
      this.pending = null;
      this.engineState = 'idle';
      this._publish({ ...this._view, move, engineState: 'idle' });
    }).catch(fail);
  }
}
