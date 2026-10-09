import { Chess } from '../../vendor/chess.js';
import { normalizeFen } from '../chess/game-state.js';

// Rules-based "why this move" explanations (spec §6, ruling R9). Every phrase
// is derived from facts chess.js can verify in the given position; the only
// free text comes from hand-written notes. Throws if `fen`/`san` are invalid.

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const CENTER = ['d4', 'd5', 'e4', 'e5'];
const MINOR_HOMES = { w: { b1: 'n', g1: 'n', c1: 'b', f1: 'b' }, b: { b8: 'n', g8: 'n', c8: 'b', f8: 'b' } };
const FILES = 'abcdefgh';
const SQUARES = [];
for (let r = 1; r <= 8; r++) for (const f of FILES) SQUARES.push(f + r);
const MAX_PHRASES = 3;

export function explain({ fen, san, notes, engine }) {
  const before = new Chess(fen);
  const move = before.move(String(san).replace(/[!?]/g, ''));
  before.undo();
  const after = new Chess(move.after);
  const mover = move.color;
  const entry = notes ? notes[normalizeFen(fen)] : null;
  const noteText = entry && entry.moves ? entry.moves[move.san] : null;

  const phrases = [];
  if (typeof noteText === 'string' && noteText) phrases.push(noteText);
  phrases.push(...rulePhrases(before, after, move));
  const capped = phrases.slice(0, MAX_PHRASES);
  if (engine) capped.push(`${engine.scoreText} at depth ${engine.depth}.`);

  return {
    text: capped.join(' '),
    phrases: capped,
    source: noteText ? 'notes' : engine ? 'engine' : 'book',
    threat: findThreat(fen, mover),
    nextObjective: entry && entry.plan ? entry.plan : principleObjective(after, mover),
  };
}

function rulePhrases(before, after, move) {
  const out = [];
  const mover = move.color;
  const enemy = mover === 'w' ? 'b' : 'w';
  const pieceNow = move.promotion || move.piece;

  // Develops: a minor piece leaves its starting square.
  if (MINOR_HOMES[mover][move.from] === move.piece) {
    out.push(`Develops the ${NAME[move.piece]}.`);
  }

  // Center: squares the moved piece occupies or attacks after the move.
  const center = CENTER.filter((sq) => sq === move.to || after.attackers(sq, mover).includes(move.to));
  if (center.length) out.push(`Controls ${center.join(' and ')}.`);

  // Attack: a newly attacked enemy piece (not the king) that is worth more
  // than the mover or is attacked more often than defended. Highest value wins.
  let target = null;
  for (const sq of SQUARES) {
    const p = after.get(sq);
    if (!p || p.color !== enemy || p.type === 'k') continue;
    if (!after.attackers(sq, mover).includes(move.to)) continue;
    if (before.attackers(sq, mover).includes(move.from)) continue;
    const winning = VALUE[p.type] > VALUE[pieceNow]
      || after.attackers(sq, mover).length > after.attackers(sq, enemy).length;
    if (winning && (!target || VALUE[p.type] > VALUE[target.type])) target = { sq, type: p.type };
  }
  if (target) out.push(`Attacks the ${NAME[target.type]} on ${target.sq}.`);

  // Capture / sacrifice: net material after the opponent's best recapture
  // sequence on the destination square (static exchange).
  const gained = (move.captured ? VALUE[move.captured] : 0) + (move.promotion ? VALUE[move.promotion] - 1 : 0);
  const net = gained - exchange(new Chess(move.after), move.to);
  if (net < 0 && VALUE[pieceNow] > (move.captured ? VALUE[move.captured] : 0)) {
    const forWhat = move.captured ? `for a ${NAME[move.captured]}` : 'for nothing';
    out.push(`Gives up a ${NAME[pieceNow]} ${forWhat}.`);
  } else if (move.captured) {
    out.push(`Captures a ${NAME[move.captured]}.`);
  }

  if (after.inCheck()) out.push('Gives check.');
  if (move.flags.includes('k') || move.flags.includes('q')) out.push('Castles.');

  // Opens a line: the friendly bishop/rook/queen (not the moved piece) whose
  // attacked-square count increases most.
  let opened = null;
  for (const sq of SQUARES) {
    if (sq === move.from || sq === move.to) continue;
    const p = after.get(sq);
    const q = before.get(sq);
    if (!p || p.color !== mover || !'brq'.includes(p.type) || !q || q.type !== p.type || q.color !== mover) continue;
    const gain = reach(after, sq, mover) - reach(before, sq, mover);
    if (gain > 0 && (!opened || gain > opened.gain)) opened = { sq, type: p.type, gain };
  }
  if (opened) out.push(`Opens the ${NAME[opened.type]} on ${opened.sq}.`);
  return out;
}

// Number of squares the piece on `from` attacks.
function reach(chess, from, color) {
  let n = 0;
  for (const sq of SQUARES) if (chess.attackers(sq, color).includes(from)) n++;
  return n;
}

// Static exchange: best material the side to move can win by capturing on
// `sq` with its least valuable legal capturer, given it may stop at any time.
function exchange(chess, sq) {
  const caps = chess.moves({ verbose: true }).filter((m) => m.to === sq && m.captured);
  if (!caps.length) return 0;
  caps.sort((a, b) => VALUE[a.piece] - VALUE[b.piece]);
  const m = caps[0];
  const won = VALUE[m.captured] + (m.promotion ? VALUE[m.promotion] - 1 : 0);
  chess.move(m);
  const value = won - exchange(chess, sq);
  chess.undo();
  return Math.max(0, value);
}

// Position with the other side to move and en passant cleared, or null if
// that position would be illegal (the side to move is in check).
function flipped(fen) {
  const chess = new Chess(fen);
  if (chess.inCheck()) return null;
  const f = fen.split(/\s+/);
  f[1] = f[1] === 'w' ? 'b' : 'w';
  f[3] = '-';
  return new Chess(f.join(' '));
}

function findThreat(fen, mover) {
  let chess;
  try {
    chess = flipped(fen);
  } catch (e) {
    return null;
  }
  if (!chess) return null;
  let bestGain = null;
  let bestCheck = null;
  for (const m of chess.moves({ verbose: true })) {
    if (!m.captured) continue;
    const gain = VALUE[m.captured] - (chess.isAttacked(m.to, mover) ? VALUE[m.piece] : 0);
    if (!bestGain || gain > bestGain.gain) bestGain = { san: m.san, gain };
    if (/[+#]$/.test(m.san) && (!bestCheck || gain > bestCheck.gain)) bestCheck = { san: m.san, gain };
  }
  const pick = bestGain && bestGain.gain > 0 ? bestGain : bestCheck;
  if (!pick) return null;
  return `${mover === 'w' ? 'Black' : 'White'} threatens ${pick.san}.`;
}

function principleObjective(after, mover) {
  let chess = null;
  try {
    chess = flipped(after.fen());
  } catch (e) {
    chess = null;
  }
  if (chess && chess.moves({ verbose: true }).some((m) => m.flags.includes('k') || m.flags.includes('q'))) {
    return 'Castle next.';
  }
  const homes = Object.entries(MINOR_HOMES[mover]);
  if (homes.some(([sq, type]) => {
    const p = after.get(sq);
    return p && p.color === mover && p.type === type;
  })) {
    return 'Develop your remaining minor pieces.';
  }
  const rank = mover === 'w' ? '1' : '8';
  const files = [...FILES].filter((f) => {
    const p = after.get(f + rank);
    return p && p.color === mover && p.type === 'r';
  });
  if (files.length === 2) {
    const [a, b] = files.map((f) => FILES.indexOf(f));
    for (let i = a + 1; i < b; i++) if (after.get(FILES[i] + rank)) return 'Connect your rooks.';
  }
  return null;
}
