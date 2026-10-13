import { Chess } from '../../vendor/chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

export function normalizeFen(fen) {
  return String(fen).trim().split(/\s+/).slice(0, 4).join(' ');
}

export function parseMoveText(text) {
  const out = [];
  for (const raw of String(text).split(/\s+/)) {
    if (!raw || RESULT_TOKENS.has(raw)) continue;
    const token = raw.replace(/^\d+\.+/, '');
    if (token) out.push(token);
  }
  return out;
}

export function replay(sanList, startFen = START_FEN) {
  const chess = new Chess(startFen);
  const sanHistory = [];
  const fens = [];
  for (let i = 0; i < sanList.length; i++) {
    try {
      const move = chess.move(String(sanList[i]).replace(/[!?]/g, ''));
      sanHistory.push(move.san);
      fens.push(normalizeFen(chess.fen()));
    } catch (e) {
      return { ok: false, fen: chess.fen(), sanHistory, fens, badIndex: i };
    }
  }
  return { ok: true, fen: chess.fen(), sanHistory, fens, badIndex: -1 };
}

function toUci(move) {
  return move.from + move.to + (move.promotion || '');
}

export function sanToUci(fen, san) {
  try {
    return toUci(new Chess(fen).move(String(san).replace(/[!?]/g, '')));
  } catch (e) {
    return null;
  }
}

export function uciToSan(fen, uci) {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(String(uci));
  if (!m) return null;
  try {
    return new Chess(fen).move({ from: m[1], to: m[2], promotion: m[3] }).san;
  } catch (e) {
    return null;
  }
}

export function legalMoves(fen) {
  return new Chess(fen).moves({ verbose: true }).map((m) => ({
    san: m.san,
    uci: toUci(m),
    from: m.from,
    to: m.to,
    piece: m.piece,
    captured: m.captured,
    flags: m.flags,
  }));
}

// Draws the coach treats as game over: insufficient material (read from the FEN) and
// threefold repetition (needs the history: replayed from the start and used only when
// it ends in `fen`). Returns false when neither can be shown.
export function isDrawnPosition(fen, sanHistory = []) {
  try {
    if (new Chess(fen).isInsufficientMaterial()) return true;
  } catch (e) {
    return false;
  }
  try {
    const chess = new Chess(START_FEN);
    for (const san of sanHistory) chess.move(String(san).replace(/[!?]/g, ''));
    if (normalizeFen(chess.fen()) !== normalizeFen(fen)) return false;
    return chess.isThreefoldRepetition();
  } catch (e) {
    return false;
  }
}
