import { normalizeFen, replay, sanToUci, START_FEN } from '../chess/game-state.js';

// Engine continuation past the target (or past a deviation) stops after this many user moves.
const ENGINE_CAP = 10;

const COLOR_NAME = { w: 'White', b: 'Black' };

// Ply p (1-based, from the standard start) is a White move when odd.
function moverOf(ply) {
  return ply % 2 === 1 ? 'w' : 'b';
}

function moveNo(ply) {
  const n = Math.ceil(ply / 2);
  return moverOf(ply) === 'w' ? n + '.' : n + '...';
}

// User moves among plies from..to (inclusive).
function countUserMoves(from, to, userColor) {
  let n = 0;
  for (let p = from; p <= to; p++) if (moverOf(p) === userColor) n++;
  return n;
}

function status(state, message, extra) {
  return {
    state,
    message,
    nextMove: null,
    predictedMove: null,
    awaiting: [],
    newOpening: null,
    bookMove: null,
    userMovesPastTarget: 0,
    ...extra,
  };
}

// Book/engine guidance from the current position once the target line no longer applies.
function continuation({ tree, cur, fullFen, userToMove, movesPast }) {
  const book = tree.bookContinuations(tree.nodeForFen(cur));
  const first = book.length ? { san: book[0].san, uci: sanToUci(fullFen, book[0].san) } : null;
  const complete = !first && movesPast >= ENGINE_CAP;
  let nextMove = null;
  let predictedMove = null;
  if (userToMove) {
    if (first) nextMove = { ...first, source: 'book' };
    else if (!complete) nextMove = { san: null, uci: null, source: 'engine-needed' };
  } else {
    predictedMove = first;
  }
  return { nextMove, predictedMove, complete };
}

export function evaluate({ target, position, tree }) {
  if (!position || !position.synced) return status('syncing', 'Syncing with board…');
  if (position.userColor !== target.color) {
    return status('wrong-color', `${target.name} is a ${COLOR_NAME[target.color]} opening. ` +
      `You're ${COLOR_NAME[position.userColor]} this game.`);
  }

  const start = normalizeFen(START_FEN);
  const cur = normalizeFen(position.fen);
  const turn = cur.split(' ')[1];
  const userToMove = turn === position.userColor;
  const userColor = position.userColor;

  const game = replay(position.sanHistory || []);
  const history = game.sanHistory;
  // positions[k] = position after ply k (positions[0] = start); the last one is the current position.
  const positions = [start, ...game.fens];
  if (!game.ok || positions.at(-1) !== cur) positions.push(cur);
  const plies = positions.length - 1;

  const line = replay(target.moves || []);
  const lineSans = line.sanHistory;
  const lineFens = [start, ...line.fens];
  const targetFen = normalizeFen(target.fen);

  // Reached: the target position occurs anywhere in the history.
  const reachedAt = positions.lastIndexOf(targetFen);
  if (reachedAt !== -1) {
    const movesPast = countUserMoves(reachedAt + 1, plies, userColor);
    const c = continuation({ tree, cur, fullFen: position.fen, userToMove, movesPast });
    return status('reached', c.complete ? 'Study line complete.' : `You're in the ${target.name}.`, {
      nextMove: c.nextMove,
      predictedMove: c.predictedMove,
      userMovesPastTarget: movesPast,
    });
  }

  // On track: the current position is on the target line (directly or by transposition).
  const idx = lineFens.indexOf(cur);
  if (idx !== -1 && idx < lineSans.length) {
    const san = lineSans[idx];
    const move = { san, uci: sanToUci(position.fen, san) };
    if (userToMove) {
      return status('on-track', `On the ${target.name} line — your move.`, {
        nextMove: { ...move, source: 'book' },
      });
    }
    const awaiting = [];
    for (let j = idx; j < lineSans.length; j++) {
      const ply = plies + (j - idx) + 1;
      if (moverOf(ply) !== userColor) awaiting.push(moveNo(ply) + lineSans[j]);
    }
    return status('on-track', `Waiting for ${COLOR_NAME[turn]}. The line needs ${awaiting.join(', ')}.`, {
      predictedMove: move,
      awaiting,
    });
  }

  // Deviated: the move right after the last history position on the target line.
  let k = plies - 1;
  while (k > 0 && !lineFens.includes(positions[k])) k--;
  const devPly = k + 1;
  const devSan = history[k] ?? null;
  const bookMove = lineSans[lineFens.indexOf(positions[k])] ?? null;
  const named = tree.deepestNamed(history);
  const newOpening = named ? { eco: named.eco, name: named.name } : null;
  const movesPast = countUserMoves(devPly, plies, userColor);
  const c = continuation({ tree, cur, fullFen: position.fen, userToMove, movesPast });
  const extra = {
    nextMove: c.nextMove,
    predictedMove: c.predictedMove,
    newOpening,
    bookMove,
    userMovesPastTarget: movesPast,
  };

  if (moverOf(devPly) === userColor) {
    return status('you-deviated', `You left the line. The book move was ${bookMove}.`, extra);
  }
  const lead = moveNo(devPly) + devSan;
  const message = newOpening
    ? `${lead}: now the ${newOpening.name} (${newOpening.eco}). You've left the ${target.name} line — watching for a transposition back.`
    : `${lead} leaves the book. Watching for a transposition back to the ${target.name}.`;
  return status('opponent-deviated', message, extra);
}
