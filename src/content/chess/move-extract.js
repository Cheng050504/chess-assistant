// Pure move extraction from move-list node descriptors (no DOM access).

export function extractMoves(nodes) {
    const moves = [];
    for (const node of nodes) {
        const classes = node.classes || [];
        if (classes.includes('node') && !classes.includes('main-line-ply')) continue;

        const text = String(node.text || '').replace(/\s+/g, '');
        if (!text || /^\d+\.*$/.test(text) || text === '...') continue;

        if (node.figurine) {
            moves.push(text.endsWith('=') ? text + node.figurine : node.figurine + text);
        } else {
            moves.push(text);
        }
    }
    return moves;
}
