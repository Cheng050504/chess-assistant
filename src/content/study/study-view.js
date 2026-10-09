// Pure helpers that interpret a StudyView for the content script. No DOM or chrome access.

// Hide the engine's top-3 only while a Try-mode move is there to be spoiled.
export function shouldSuppressMoves(view) {
  if (!view || view.blocked || !view.target) return false;
  if (view.mode !== 'try' || view.revealed) return false;
  return !!view.move || view.engineState === 'pending';
}

// Same position for engine sharing: piece placement + side to move. BoardParser
// always emits "KQkq -", so castling/en-passant fields are not comparable.
export function samePosition(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const key = (fen) => fen.trim().split(/\s+/).slice(0, 2).join(' ');
  return key(a) === key(b);
}
