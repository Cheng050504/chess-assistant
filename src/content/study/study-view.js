// Pure helper for the content script's engine bridge. No DOM or chrome access.

// Same position for engine sharing: piece placement + side to move. BoardParser
// always emits "KQkq -", so castling/en-passant fields are not comparable.
export function samePosition(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const key = (fen) => fen.trim().split(/\s+/).slice(0, 2).join(' ');
  return key(a) === key(b);
}
