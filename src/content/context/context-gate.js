const CHESS_COM_TRAINING = [
  /^\/play\/computer(\/|$)/,
  /^\/game\/computer\/\d+(\/|$)/,
  /^\/analysis(\/|$)/
];
const LICHESS_TRAINING = [/^\/analysis(\/|$)/];

export function classifyUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return 'blocked';
  }
  let patterns = null;
  if (parsed.hostname === 'www.chess.com') patterns = CHESS_COM_TRAINING;
  else if (parsed.hostname === 'lichess.org') patterns = LICHESS_TRAINING;
  if (!patterns) return 'blocked';
  return patterns.some(re => re.test(parsed.pathname)) ? 'training' : 'blocked';
}

export class ContextGate {
  constructor({ getUrl, onChange, intervalMs = 1000, setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
    this.getUrl = getUrl;
    this.onChange = onChange;
    this.intervalMs = intervalMs;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this._verdict = null;
    this._timer = null;
  }

  get verdict() {
    return this._verdict;
  }

  start() {
    this.stop();
    this.check();
    this._timer = this.setIntervalFn(() => this.check(), this.intervalMs);
  }

  stop() {
    if (this._timer !== null) {
      this.clearIntervalFn(this._timer);
      this._timer = null;
    }
  }

  check() {
    const next = classifyUrl(this.getUrl());
    if (next !== this._verdict) {
      this._verdict = next;
      this.onChange(next);
    }
    return next;
  }
}
