import { sanToUci } from '../chess/game-state.js';

export function pickBookMove({ fen, sanHistory, tree, engineLines }) {
  if (!tree || !fen) return null;
  const node = tree.nodeForFen(fen);
  if (!node) return null;
  const children = tree.bookContinuations(node);
  if (!children.length) return null;
  const byUci = new Map();
  for (const c of children) {
    const uci = sanToUci(fen, c.san);
    if (uci && !byUci.has(uci)) byUci.set(uci, c);
  }
  for (const line of engineLines || []) {
    const child = line && byUci.get(line.uci);
    if (!child) continue;
    const name = (child.node.openings && child.node.openings[0] && child.node.openings[0].name)
      || (tree.deepestNamed([...(sanHistory || []), child.san]) || {}).name
      || null;
    return { uci: line.uci, san: child.san, openingName: name };
  }
  return null;
}
