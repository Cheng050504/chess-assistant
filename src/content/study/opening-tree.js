import { normalizeFen, parseMoveText, replay, START_FEN } from '../chess/game-state.js';

function makeNode(san, fen, ply, parent) {
  return { san, fen, ply, parent, children: new Map(), openings: [], subtreeSize: 0 };
}

// Normalized FEN plus neutral counters; enough for chess.js to replay moves from a node.
function fullFen(node) {
  return node.fen + ' 0 ' + (Math.floor(node.ply / 2) + 1);
}

export class OpeningTree {
  constructor() {
    this.root = makeNode(null, normalizeFen(START_FEN), 0, null);
    this.fenIndex = new Map([[this.root.fen, this.root]]);
    this.entries = [];
    this.lines = new Map();
    this._skipped = 0;
  }

  static build(entries) {
    const tree = new OpeningTree();
    for (const entry of entries || []) tree._add(entry);
    return tree;
  }

  get size() {
    return this.entries.length;
  }

  get skipped() {
    return this._skipped;
  }

  _add(entry) {
    if (!entry || typeof entry.eco !== 'string' || typeof entry.name !== 'string') {
      this._skipped++;
      return;
    }
    const moves = parseMoveText(entry.moves || '');
    if (!moves.length) {
      this._skipped++;
      return;
    }
    // Follow existing canonical-SAN children, then replay only the unseen suffix from there.
    let node = this.root;
    const path = [node];
    let i = 0;
    while (i < moves.length && node.children.has(moves[i])) {
      node = node.children.get(moves[i++]);
      path.push(node);
    }
    let sans = [];
    let fens = [];
    if (i < moves.length) {
      const r = replay(moves.slice(i), fullFen(node));
      if (!r.ok) {
        this._skipped++;
        return;
      }
      sans = r.sanHistory;
      fens = r.fens;
    }
    for (let j = 0; j < sans.length; j++) {
      let child = node.children.get(sans[j]);
      if (!child) {
        child = makeNode(sans[j], fens[j], node.ply + 1, node);
        node.children.set(sans[j], child);
        if (!this.fenIndex.has(child.fen)) this.fenIndex.set(child.fen, child);
      }
      node = child;
      path.push(node);
    }
    for (const n of path) n.subtreeSize++;
    const sanMoves = [];
    for (let n = node; n.parent; n = n.parent) sanMoves.unshift(n.san);
    if (!node.openings.some(o => o.eco === entry.eco && o.name === entry.name)) {
      node.openings.push({ eco: entry.eco, name: entry.name });
    }
    const rec = {
      eco: entry.eco,
      name: entry.name,
      sanMoves,
      fen: node.fen,
      haystack: (entry.eco + ' ' + entry.name).toLowerCase(),
    };
    this.entries.push(rec);
    const key = entry.eco + '\n' + entry.name;
    if (!this.lines.has(key)) this.lines.set(key, sanMoves);
  }

  search(query, limit = 20) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/);
    const hits = [];
    this.entries.forEach((e, idx) => {
      if (!tokens.every(t => e.haystack.includes(t))) return;
      const exactEco = e.eco.toLowerCase() === q ? 0 : 1;
      const prefix = e.name.toLowerCase().startsWith(q) ? 0 : 1;
      hits.push({ e, exactEco, prefix, idx });
    });
    hits.sort((a, b) => a.exactEco - b.exactEco || a.prefix - b.prefix ||
      a.e.sanMoves.length - b.e.sanMoves.length || a.idx - b.idx);
    return hits.slice(0, limit).map(({ e }) => ({
      eco: e.eco, name: e.name, sanMoves: e.sanMoves.slice(), fen: e.fen,
    }));
  }

  nodeForFen(fen) {
    return this.fenIndex.get(normalizeFen(fen)) || null;
  }

  // Child by exact SAN, else the node reached by the replayed prefix (transposition / SAN variants).
  _step(node, history, i) {
    const direct = node.children.get(history[i]);
    if (direct) return direct;
    const r = replay(history.slice(0, i + 1));
    return r.ok ? this.nodeForFen(r.fen) : null;
  }

  nodeForMoves(sanHistory) {
    const history = sanHistory || [];
    let node = this.root;
    for (let i = 0; i < history.length; i++) {
      node = this._step(node, history, i);
      if (!node) return null;
    }
    return node;
  }

  deepestNamed(sanHistory) {
    const history = sanHistory || [];
    let node = this.root;
    let best = null;
    for (let i = 0; i < history.length; i++) {
      node = this._step(node, history, i);
      if (!node) break;
      if (node.openings.length) {
        best = { eco: node.openings[0].eco, name: node.openings[0].name, depth: i + 1 };
      }
    }
    return best;
  }

  bookContinuations(node) {
    if (!node) return [];
    return [...node.children.entries()]
      .map(([san, child]) => ({ san, node: child }))
      .sort((a, b) => b.node.subtreeSize - a.node.subtreeSize);
  }

  lineFor(eco, name) {
    const line = this.lines.get(eco + '\n' + name);
    return line ? line.slice() : null;
  }
}
