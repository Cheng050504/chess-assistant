// DOM adapter: reads the move list, replays it, and emits position snapshots.

import { SELECTORS } from '../../shared/constants.js';
import { Logger } from '../../shared/logger.js';
import { MoveHighlighter } from './move-highlighter.js';
import { BoardParser } from './board-parser.js';
import { extractMoves } from './move-extract.js';
import { replay, normalizeFen } from './game-state.js';

const logger = new Logger('LiveSync');

const NODE_SELECTOR = '.move-list .node, wc-simple-move-list .node, l4x kwdb';
const DEBOUNCE_MS = 150;
const POLL_MS = 1000;

export class LiveSync {
    constructor({ onPositionChanged }) {
        this.onPositionChanged = onPositionChanged;
        this.observer = null;
        this.retryTimer = null;
        this.pollTimer = null;
        this.debounceTimer = null;
        this.running = false;
        this.lastKey = null;
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.attachObserver();
        this.pollTimer = setInterval(() => this.schedule(), POLL_MS);
        this.schedule();
    }

    stop() {
        this.running = false;
        this.observer?.disconnect();
        this.observer = null;
        clearTimeout(this.retryTimer);
        clearInterval(this.pollTimer);
        clearTimeout(this.debounceTimer);
        this.retryTimer = this.pollTimer = this.debounceTimer = null;
        this.lastKey = null;
    }

    attachObserver() {
        if (!this.running) return;
        const moveList = document.querySelector(SELECTORS.MOVE_LIST);
        if (!moveList) {
            logger.warn('Move list not found, retrying...');
            this.retryTimer = setTimeout(() => this.attachObserver(), 1000);
            return;
        }
        this.observer = new MutationObserver(() => this.schedule());
        this.observer.observe(moveList, { childList: true, subtree: true, characterData: true });
    }

    schedule() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.check(), DEBOUNCE_MS);
    }

    check() {
        if (!this.running) return;
        const snap = this.snapshot();
        if (!snap) return;
        const key = `${normalizeFen(snap.fen)}|${snap.synced}|${snap.userColor}`;
        if (key === this.lastKey) return;
        this.lastKey = key;
        this.onPositionChanged(snap);
    }

    readNodes() {
        return Array.from(document.querySelectorAll(NODE_SELECTOR)).map(el => ({
            text: el.textContent || '',
            figurine: el.querySelector('[data-figurine]')?.dataset.figurine || null,
            classes: Array.from(el.classList)
        }));
    }

    snapshot() {
        try {
            const sans = extractMoves(this.readNodes());
            const result = replay(sans);
            const board = MoveHighlighter.getBoard();
            const userColor = board && MoveHighlighter.getBoardState(board).isFlipped ? 'b' : 'w';

            let synced = result.ok;
            if (synced) {
                const domFen = BoardParser.parseBoardFromDOM();
                if (domFen && domFen.split(' ')[0] !== result.fen.split(' ')[0]) synced = false;
            }

            return {
                sanHistory: result.sanHistory,
                fen: result.fen,
                turn: result.fen.split(' ')[1],
                userColor,
                synced
            };
        } catch (error) {
            logger.error('Failed to build snapshot', error);
            return null;
        }
    }
}
