// Background service worker — Chess Assistant
//
// Architecture:
//   Chrome MV3:
//     content script ──port──▶ service worker ──sendMessage──▶ offscreen doc
//                    ◀─────────               ◀──────────────  (Stockfish Worker)
//
//   Firefox MV2:
//     content script ──port──▶ background page ──Worker(stockfish-worker-ff.js)
//                    ◀─────────
//
//   Firefox uses a pure-JS (asm.js) Stockfish build — no .wasm file, no fetch,
//   no SharedArrayBuffer workarounds needed.

'use strict';

// Pick the engine host by capability, not by the presence of a `browser` global:
// newer Chromium builds (e.g. Edge) expose `browser` too, and treating them as
// Firefox tried to start a Worker inside the MV3 service worker, so the engine
// never loaded. Chrome/Edge MV3 has chrome.offscreen; Firefox MV2 does not.
const IS_FIREFOX = !(typeof chrome !== 'undefined' && chrome.offscreen);

let currentAnalysisPort = null;
let stockfishReady = false;
let pendingAnalysis = null;
// R13: one search at a time. activeSearchId is the requestId of the running
// search (null when idle or stopping); every forwarded engine line is tagged
// with it, so the content script only accepts lines of the search it asked for.
let activeSearchId = null;
// UCI: every `go` ends with exactly one bestmove, even when stopped. The
// bundled engine can send a stopped search's bestmove late (after the next
// search's lines), so count the ones still owed; while more than one is owed,
// the next bestmove belongs to an older search and is tagged null.
let owedBestmoves = 0;
let queuedAnalysis = null;      // request waiting for a stopped search to end
let stopWaitTimer = null;
const STOP_WAIT_MS = 2000;
let offscreenReady = false;
let firefoxWorker = null;

const ANALYSIS_LIMITS = {
    MIN_DEPTH: 5,
    MAX_DEPTH: 25,
    MAX_FEN_LENGTH: 128
};

// ─── Firefox: pure-JS Worker ─────────────────────────────────────────────────

function initFirefoxWorker() {
    if (firefoxWorker) return;

    console.log('Background (Firefox) - Starting Stockfish Worker...');

    try {
        firefoxWorker = new Worker(chrome.runtime.getURL('stockfish-worker-ff.js'));
    } catch (e) {
        console.error('Background (Firefox) - Worker() failed:', e);
        safePostToPort(currentAnalysisPort, {
            type: 'stockfish-error',
            error: 'Failed to create Stockfish Worker: ' + e.message
        });
        return;
    }

    firefoxWorker.onmessage = function (event) {
        const msg = typeof event === 'string' ? event
            : (event.data !== undefined ? event.data : String(event));
        handleOffscreenMsg({ type: 'offscreen-output', data: msg });
    };

    firefoxWorker.onerror = function (err) {
        console.error('Background (Firefox) - Worker error:', err);
        handleOffscreenMsg({
            type: 'offscreen-error',
            error: err.message || 'Unknown Stockfish Worker error'
        });
        firefoxWorker = null;
    };

    firefoxWorker.postMessage('uci');
}

// ─── Chrome: Offscreen document management ────────────────────────────────────

async function ensureOffscreenDocument() {
    try {
        if (await chrome.offscreen.hasDocument()) {
            offscreenReady = true;
            return true;
        }
        await chrome.offscreen.createDocument({
            url: chrome.runtime.getURL('offscreen.html'),
            reasons: ['WORKERS'],
            justification: 'Run Stockfish chess engine in a Web Worker'
        });
        offscreenReady = true;
        console.log('Background - Offscreen document created');
        return true;
    } catch (e) {
        console.error('Background - Could not create offscreen document:', e);
        offscreenReady = false;
        return false;
    }
}

function sendToStockfish(command) {
    if (IS_FIREFOX) {
        if (firefoxWorker) firefoxWorker.postMessage(command);
        else console.warn('Background (Firefox) - worker not ready, dropping:', command);
        return;
    }
    chrome.runtime.sendMessage({ type: 'stockfish-command', command })
        .catch(e => console.warn('Background - sendToStockfish failed:', e.message));
}

// ─── Engine init ──────────────────────────────────────────────────────────────

async function initStockfish() {
    if (IS_FIREFOX) {
        console.log('Background (Firefox) - Initialising Stockfish...');
        initFirefoxWorker();
        return;
    }

    console.log('Background - Initialising Stockfish via offscreen document...');
    const ok = await ensureOffscreenDocument();
    if (!ok) {
        safePostToPort(currentAnalysisPort, {
            type: 'stockfish-error',
            error: 'Could not create offscreen document. Check that the "offscreen" permission is in manifest.json.'
        });
        return;
    }

    try {
        const status = await chrome.runtime.sendMessage({ type: 'stockfish-status-request' });
        if (status && status.ready) {
            console.log('Background - Offscreen engine already ready (SW restart recovery)');
            stockfishReady = true;
            if (pendingAnalysis) {
                const queued = pendingAnalysis;
                pendingAnalysis = null;
                runAnalysis(queued);
            }
            return;
        }
    } catch {
        // Offscreen doc not yet listening — that's fine.
    }

    sendToStockfish('uci');
}

// ─── Messages FROM offscreen document (Chrome only) ──────────────────────────

chrome.runtime.onMessage.addListener(function (msg, sender) {
    if (sender.id !== chrome.runtime.id) return;
    if (sender.tab) return;
    handleOffscreenMsg(msg);
});

// ─── Port connection from content script ─────────────────────────────────────

chrome.runtime.onConnect.addListener(function (port) {
    if (port.name === 'offscreen') {
        port.onMessage.addListener(msg => handleOffscreenMsg(msg));
        port.onDisconnect.addListener(() => {
            console.warn('Background - Offscreen output port disconnected');
        });
        return;
    }

    if (port.name !== 'chess-assistant') return;

    if (!isTrustedPort(port)) {
        console.warn('Background - Rejected untrusted connection:', port?.sender?.url);
        port.disconnect();
        return;
    }

    // A new page owns the engine now: stop the previous page's search and drop
    // its queued requests, so their output (tagged null) can't match an id of
    // the new page (each page numbers its requests on its own).
    handleStopAnalysis();
    pendingAnalysis = null;
    currentAnalysisPort = port;
    initStockfish();

    port.onMessage.addListener(function (msg) {
        if (msg && msg.type === 'analyze') {
            handleAnalyzeRequest(msg);
        } else if (msg && msg.type === 'reset-engine') {
            handleReset();

        } else if (msg && msg.type === 'stop-engine') {
            // Stop the current analysis
            handleStopAnalysis();
        } else if (msg && msg.type === 'keep-alive') {
            // Keep-alive ping - do nothing, just keeps SW alive
            console.log('Keep-alive ping received');
        }
    });

    port.onDisconnect.addListener(() => {
        // Only clear if a newer tab has not taken over the routing.
        if (currentAnalysisPort === port) currentAnalysisPort = null;
    });
});

// ─── Analysis request handling ────────────────────────────────────────────────

function handleAnalyzeRequest(msg) {
    if (!isValidAnalyzeMessage(msg)) {
        safePostToPort(currentAnalysisPort, { type: 'stockfish-error', error: 'Invalid analysis request.' });
        return;
    }

    const safeFen = msg.fen.trim();
    const safeDepth = normalizeDepth(msg.depth);
    const safeRequestId = msg.requestId === undefined ? null : msg.requestId;

    if (!isValidFEN(safeFen)) {
        safePostToPort(currentAnalysisPort, { type: 'stockfish-error', error: 'Invalid board position.' });
        return;
    }

    if (!stockfishReady) {
        console.log('Background - Engine loading, queuing analysis...');
        pendingAnalysis = { fen: safeFen, depth: safeDepth, requestId: safeRequestId };
        safePostToPort(currentAnalysisPort, {
            type: 'stockfish-message',
            data: 'info string Engine loading, please wait...'
        });
        return;
    }

    runAnalysis({ fen: safeFen, depth: safeDepth, requestId: safeRequestId });
}

function handleReset() {
    console.log('Background - Manual engine reset');
    stockfishReady = false;
    offscreenReady = false;
    pendingAnalysis = null;
    clearSearchState();

    if (IS_FIREFOX) {
        if (firefoxWorker) {
            firefoxWorker.terminate();
            firefoxWorker = null;
        }
        setTimeout(() => initStockfish(), 300);
    } else {
        chrome.offscreen.closeDocument().catch(() => { });
        setTimeout(() => initStockfish(), 300);
    }
}

function handleStopAnalysis() {
    // A stop also drops a request still waiting for the previous search to end.
    queuedAnalysis = null;
    clearTimeout(stopWaitTimer);
    stopWaitTimer = null;
    if (activeSearchId === null) {
        console.log('Background - No analysis running to stop');
        return;
    }
    console.log('Background - ⛔ Stopping analysis');
    activeSearchId = null;
    sendToStockfish('stop');
}

function clearSearchState() {
    activeSearchId = null;
    owedBestmoves = 0;
    queuedAnalysis = null;
    clearTimeout(stopWaitTimer);
    stopWaitTimer = null;
}

// Searches are serialized: a running search is stopped and the new request
// starts once its bestmove arrives (or after STOP_WAIT_MS if it never does).
// A newer request replaces one that is still waiting.
function runAnalysis(msg) {
    if (!stockfishReady) {
        console.error('Background - Cannot analyze: engine not ready');
        return;
    }
    if (owedBestmoves > 0) {
        queuedAnalysis = msg;
        if (activeSearchId !== null) {
            activeSearchId = null;
            sendToStockfish('stop');
        }
        if (!stopWaitTimer) {
            stopWaitTimer = setTimeout(() => {
                stopWaitTimer = null;
                // Its bestmove stays owed: when it does arrive it is tagged null.
                console.warn('Background - stopped search sent no bestmove yet, starting the next one');
                startQueuedAnalysis();
            }, STOP_WAIT_MS);
        }
        return;
    }
    startSearch(msg);
}

function startQueuedAnalysis() {
    clearTimeout(stopWaitTimer);
    stopWaitTimer = null;
    const next = queuedAnalysis;
    queuedAnalysis = null;
    if (next && stockfishReady) startSearch(next);
}

function startSearch(msg) {
    try {
        sendToStockfish('ucinewgame');
        sendToStockfish('position fen ' + msg.fen);
        sendToStockfish('setoption name MultiPV value 3');
        sendToStockfish('go depth ' + msg.depth);
        activeSearchId = msg.requestId;
        owedBestmoves++;
        console.log('Background - ✅ Analysis commands sent, search', msg.requestId);
    } catch (e) {
        console.error('Background - Error sending analysis commands:', e);
        clearSearchState();
        safePostToPort(currentAnalysisPort, {
            type: 'stockfish-error',
            error: 'Error communicating with engine. Try reloading the page.'
        });
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safePostToPort(port, payload) {
    if (!port) return;
    try { port.postMessage(payload); }
    catch (e) { console.error('Background - port.postMessage failed:', e); }
}

function isTrustedPort(port) {
    const senderUrl = port?.sender?.url;
    if (typeof senderUrl !== 'string') return false;
    try {
        const url = new URL(senderUrl);
        if (url.protocol !== 'https:') return false;
        return new Set(['www.chess.com', 'chess.com', 'lichess.org', 'www.lichess.org'])
            .has(url.hostname);
    } catch { return false; }
}

function normalizeDepth(depth) {
    const n = Number.parseInt(depth, 10);
    if (!Number.isFinite(n)) return ANALYSIS_LIMITS.MIN_DEPTH;
    return Math.min(ANALYSIS_LIMITS.MAX_DEPTH, Math.max(ANALYSIS_LIMITS.MIN_DEPTH, n));
}

function handleOffscreenMsg(msg) {
    if (msg.type === 'offscreen-output') {
        const message = msg.data;
        console.log('Stockfish:', message);

        if (typeof message === 'string' && message.includes('uciok')) {
            stockfishReady = true;
            console.log('Background - ✅ Stockfish READY');
            if (pendingAnalysis) {
                const queued = pendingAnalysis;
                pendingAnalysis = null;
                runAnalysis(queued);
            }
        }

        // Tag with the search producing this line; a bestmove ends that search,
        // so duplicate or late bestmoves are tagged null.
        const isBest = typeof message === 'string' && message.includes('bestmove');
        let searchId = activeSearchId;
        if (isBest) {
            if (owedBestmoves > 1) searchId = null; // an older, stopped search's late bestmove
            else activeSearchId = null;
            owedBestmoves = Math.max(0, owedBestmoves - 1);
        }

        safePostToPort(currentAnalysisPort, { type: 'stockfish-message', data: message, searchId });

        if (isBest && owedBestmoves === 0 && queuedAnalysis) startQueuedAnalysis();

    } else if (msg.type === 'offscreen-error') {
        console.error('Background - Stockfish error:', msg.error);
        stockfishReady = false;
        clearSearchState();
        safePostToPort(currentAnalysisPort, { type: 'stockfish-error', error: msg.error });
    }
}

function isValidAnalyzeMessage(msg) {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.type !== 'analyze') return false;
    if (typeof msg.fen !== 'string' || msg.fen.length > ANALYSIS_LIMITS.MAX_FEN_LENGTH) return false;
    if (msg.requestId !== undefined && !(Number.isInteger(msg.requestId) && msg.requestId >= 0)) return false;
    return true;
}

function isValidFEN(fen) {
    if (!fen || typeof fen !== 'string') return false;
    if (fen.length > ANALYSIS_LIMITS.MAX_FEN_LENGTH) return false;
    if (!/^[pnbrqkPNBRQKwW1-8/\s\-a-hA-H0-9]+$/.test(fen)) return false;

    const parts = fen.trim().split(/\s+/);
    if (parts.length < 2) return false;
    if (parts[1] !== 'w' && parts[1] !== 'b') return false;

    const ranks = parts[0].split('/');
    if (ranks.length !== 8) return false;

    for (const rank of ranks) {
        let squares = 0;
        for (const char of rank) {
            if ('12345678'.includes(char)) squares += parseInt(char);
            else if ('pnbrqkPNBRQK'.includes(char)) squares += 1;
            else return false;
        }
        if (squares !== 8) return false;
    }

    return true;
}

console.log('Background - Loaded');