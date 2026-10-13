/**
 * Main content script entry point
 * Coordinates all content script components
 */

import { Logger } from '../shared/logger.js';
import { StorageService } from '../shared/storage.js';
import { AnalysisService } from './services/analysis-service.js';
import { OpeningExplorer } from './services/opening-explorer.js';
import { Overlay } from './ui/overlay.js';
import { MoveHighlighter } from './chess/move-highlighter.js';
import { BoardParser } from './chess/board-parser.js';
import { LiveSync } from './chess/live-sync.js';
import { ContextGate } from './context/context-gate.js';
import { StudyPanel } from './ui/study-panel.js';
import { CoachController } from './coach/coach-controller.js';
import { OpeningTree } from './study/opening-tree.js';
import { updateRecent, defaultStudyColor } from './study/study-recent.js';
import { samePosition } from './study/study-view.js';
import { STORAGE_KEYS, STUDY } from '../shared/constants.js';

const logger = new Logger('Content');

const isStudyTarget = (t) => !!t && typeof t.fen === 'string' && Array.isArray(t.moves)
    && typeof t.eco === 'string' && typeof t.name === 'string';
// The color always comes from the opening: the side that plays its last move.
const asTarget = (t) => ({ eco: t.eco, name: t.name, moves: t.moves, fen: t.fen, color: defaultStudyColor(t.moves) });

class ChessAssistant {
    constructor() {
        this.analysisService = new AnalysisService();
        this.openingExplorer = new OpeningExplorer();
        this.overlay = new Overlay();
        this.gate = null;
        this.liveSync = null;
        this.contextVerdict = 'blocked';
        this.position = null;
        this.analysisStartFEN = null;
        this.topMoves = [];
        this.engineLoading = false;
        // R13: requestId of the search whose lines fill topMoves (null when none).
        // The background tags engine output with the id of the search producing
        // it; output with any other id (or null) is ignored.
        this.analysisId = null;
        this.coach = null;
        this.studyTree = null;
        this.studyPanel = null;
        this.studyTarget = null;
        this.studyRecent = [];
        this.pendingEngine = null;
        this.studyInitScheduled = false;
    }

    async initialize() {
        logger.log('Initializing Chess Assistant...');

        await this.loadSettings();
        await this.openingExplorer.initialize();
        await this.delay(2000);

        this.overlay.create();
        this.overlay.onEnabledChange(() => this.forwardPosition());
        this.createStudyPanel();
        // The tree is attached later (initStudy); until then the coach works engine-only.
        this.coach = new CoachController({
            tree: null,
            notes: {},
            requestEngine: (fen) => this.requestEngine(fen),
            cancelEngine: () => {
                this.clearPendingEngine();
                this.analysisService.stopAnalysis();
            },
            onUpdate: (view) => this.renderCoach(view)
        });
        this.coach.setTarget(this.studyTarget);

        // The background port is opened only on a training verdict (applyVerdict).
        this.startGate();

        this.setupAnalysisCallbacks();
        this.setupMoveObserver();
        this.setupStorageListener();
        document.addEventListener('keydown', (event) => this.onKey(event));

        logger.log('Chess Assistant ready!');
    }

    // ── Coach ─────────────────────────────────────────────────────────────────

    createStudyPanel() {
        const root = document.getElementById('chess-assistant-study');
        if (!root) return;
        this.studyPanel = new StudyPanel(root, {
            onPick: (target) => this.pickStudyTarget(asTarget(target)),
            onStop: () => this.pickStudyTarget(null),
            onSearch: (query) => this.studyTree ? this.studyTree.search(query, STUDY.SEARCH_LIMIT) : []
        });
        this.renderCoach();
    }

    // Build the tree once, on the first training verdict (never on blocked pages),
    // deferred so the overlay paints before the synchronous build.
    scheduleStudyInit() {
        if (this.studyInitScheduled || !this.studyPanel || this.contextVerdict !== 'training') return;
        this.studyInitScheduled = true;
        setTimeout(() => this.initStudy(), 0);
    }

    async initStudy() {
        try {
            const notes = await this.openingExplorer.loadNotes();
            const tree = OpeningTree.build(this.openingExplorer.entries);
            logger.log(`Opening tree built: ${tree.size} openings, ${tree.skipped} skipped`);
            this.studyTree = tree;
            this.coach.setNotes(notes);
            this.coach.setTree(tree);
            this.studyPanel?.setDataState(tree.size ? 'ready' : 'unavailable');
        } catch (error) {
            logger.error('Study setup failed:', error);
            this.studyPanel?.setDataState('unavailable');
        }
    }

    renderCoach(view = this.coach?.view) {
        const blocked = this.contextVerdict === 'blocked';
        const v = view || { blocked, target: this.studyTarget, card: { kind: 'idle', move: null, alternatives: [] } };
        this.studyPanel?.render(v, { recent: this.studyRecent });
        const kind = v.card?.kind;
        if (blocked || v.blocked || (kind !== 'move' && kind !== 'waiting')) {
            MoveHighlighter.clearStudyArrows();
            return;
        }
        MoveHighlighter.drawStudyArrows({
            primaryUci: kind === 'move' ? v.card.move?.uci ?? null : null,
            predictedUci: v.predictedUci ?? null
        });
    }

    pickStudyTarget(target) {
        this.studyTarget = target;
        if (target) this.studyRecent = updateRecent(this.studyRecent, target);
        this.coach?.setTarget(target);
        const writes = [StorageService.set(STORAGE_KEYS.STUDY_TARGET, target)];
        if (target) writes.push(StorageService.set(STORAGE_KEYS.STUDY_RECENT, this.studyRecent));
        Promise.all(writes).catch((error) => logger.warn('Couldn\'t save study settings:', error));
    }

    // Only a synced position on a training page with the assistant ON reaches the coach.
    // R11: analysis boards have no bot, so the side to move is the user there.
    forwardPosition() {
        let p = this.overlay.isEnabled ? this.position : null;
        if (p && location.pathname.startsWith('/analysis')) p = { ...p, userColor: p.turn };
        this.coach?.setPosition(p);
    }

    // Engine bridge for the coach: resolves with up to 3 lines, best first.
    requestEngine(fen) {
        const service = this.analysisService;
        if (service.isBlocked) return Promise.reject(new Error('Analysis is blocked'));
        return new Promise((resolve, reject) => {
            const entry = { fen, resolve, reject, softTimer: null, requestId: null };
            this.clearPendingEngine();
            this.pendingEngine = entry;
            this.armSoftLimit(entry, 2);
            setTimeout(async () => {
                // Re-check the URL first (deferred: a verdict change re-enters the coach).
                if (this.pendingEngine !== entry || this.gate.check() !== 'training') return;
                if (service.isAnalyzing && samePosition(service.lastFen, fen)) {
                    entry.requestId = this.analysisId; // that search already serves this position
                    return;
                }
                const connected = !service.isBlocked && await service.ensureConnected();
                if (this.pendingEngine !== entry) return;
                if (!connected || !service.sendAnalyzeRequest(fen)) {
                    this.clearPendingEngine();
                    reject(new Error('Engine request failed'));
                    return;
                }
                entry.requestId = this.analysisId;
            }, 0);
        });
    }

    // R12: the pure-JS engine can be slow; after the soft limit, answer with the
    // deepest lines of the current search so far (re-armed once if it has none).
    armSoftLimit(entry, tries) {
        entry.softTimer = setTimeout(() => {
            entry.softTimer = null;
            if (this.pendingEngine !== entry) return;
            const current = this.contextVerdict === 'training' && entry.requestId !== null
                && entry.requestId === this.analysisId && samePosition(entry.fen, this.analysisStartFEN);
            if (current && this.topMoves.some(m => m !== undefined)) {
                logger.log('Engine soft limit reached, answering with the deepest lines so far');
                this.deliverLines();
                // Its later bestmove (if any) finds no pending request and resolves nothing.
                this.analysisService.stopAnalysis();
            } else if (tries > 1) {
                this.armSoftLimit(entry, tries - 1);
            }
        }, STUDY.ENGINE_SOFT_LIMIT_MS);
    }

    clearPendingEngine() {
        const pending = this.pendingEngine;
        this.pendingEngine = null;
        if (pending?.softTimer) clearTimeout(pending.softTimer);
        return pending;
    }

    onKey(event) {
        if (event.key !== 'Escape' || !this.studyPanel?.pickerOpen) return;
        if (this.overlay.isHidden || this.overlay.isCollapsed) return;
        this.studyPanel.closePicker();
        event.preventDefault();
    }

    startGate() {
        this.gate = new ContextGate({
            getUrl: () => location.href,
            onChange: (verdict) => this.applyVerdict(verdict)
        });

        // The isolated world cannot see the page's own pushState calls, so the
        // gate also re-checks on popstate, its 1 s poll, and before any analysis.
        window.addEventListener('popstate', () => this.gate.check());

        this.gate.start();
    }

    applyVerdict(verdict) {
        this.contextVerdict = verdict;
        const blocked = verdict === 'blocked';
        if (blocked) {
            this.analysisService.setBlocked(true);
            this.analysisService.stopAnalysis();
            // Close the port: no engine, offscreen document or keep-alives on
            // blocked pages, and no port to steal another tab's results.
            this.analysisService.disconnect();
            MoveHighlighter.clearAll();
            this.topMoves = [];
            this.analysisStartFEN = null;
            this.analysisId = null;
            // Forget the (possibly human-game) position so an unblock can't reuse it.
            this.position = null;
            this.overlay.setBlocked(true);
            MoveHighlighter.clearStudyArrows();
        } else {
            this.analysisService.setBlocked(false);
            this.analysisService.connect(); // idempotent
            this.overlay.setBlocked(false);
            // Re-read the board so guidance starts from the current position.
            const fresh = this.liveSync?.snapshot() ?? null;
            if (fresh) this.position = fresh;
        }
        if (this.coach) {
            this.coach.setBlocked(blocked);
            this.forwardPosition();
        } else {
            this.renderCoach();
        }
        this.scheduleStudyInit();
    }

    async loadSettings() {
        const settings = await StorageService.getMultiple([
            STORAGE_KEYS.DEPTH,
            STORAGE_KEYS.ENABLED,
            STORAGE_KEYS.HIGHLIGHT_COLOR,
            STORAGE_KEYS.ARROW_COLOR,
            STORAGE_KEYS.STUDY_TARGET,
            STORAGE_KEYS.STUDY_RECENT
        ]);

        this.analysisService.setDepth(settings.depth);
        this.overlay.isEnabled = settings.enabled !== false;
        this.studyTarget = isStudyTarget(settings.studyTarget) ? asTarget(settings.studyTarget) : null;
        this.studyRecent = Array.isArray(settings.studyRecent) ? settings.studyRecent.filter(isStudyTarget).map(asTarget) : [];
        MoveHighlighter.setColors({
            highlightColor: settings.highlightColor,
            arrowColor: settings.arrowColor
        });
    }

    setupAnalysisCallbacks() {
        this.analysisService.onMove((message, searchId) => {
            this.handleStockfishMessage(message, searchId);
        });

        this.analysisService.onAnalyzeStart(() => {
            this.analysisId = this.analysisService.currentRequestId;
            this.topMoves = [];
            this.analysisStartFEN = this.analysisService.lastFen;
            logger.log('Analysis started for FEN:', this.analysisStartFEN);
        });

        this.analysisService.onError((error) => {
            logger.warn('Engine error:', error);
            // The coach owns retries (next position); the service must never
            // re-send an older FEN on its own after a reconnect.
            this.analysisService.pendingRetryFen = null;
            this.analysisId = null;
            this.rejectEngine(error);
        });

        this.analysisService.onLoading(() => this.setEngineLoading(true));
    }

    rejectEngine(reason) {
        const pending = this.clearPendingEngine();
        pending?.reject(new Error(String(reason)));
    }

    setEngineLoading(loading) {
        if (loading === this.engineLoading) return;
        this.engineLoading = loading;
        this.coach?.setEngineLoading(loading);
    }

    handleStockfishMessage(message, searchId = null) {
        if (this.contextVerdict !== 'training') return;
        this.setEngineLoading(false);

        // Only output of our current search counts (stopped/late/duplicate output,
        // or another page's search, carries another id or null).
        if (searchId === null || searchId !== this.analysisId) return;
        const isBest = message.includes('bestmove');
        if (!isBest && !(message.includes('info depth') && message.includes('multipv'))) return;
        if (!this.isAnalysisStillValid()) {
            // The board moved on: fail now so the card doesn't wait for the timeout.
            logger.warn('Position changed during analysis, discarding');
            this.analysisService.stopAnalysis();
            // Only the request this search serves; a newer deferred request survives.
            if (this.pendingEngine && this.pendingEngine.requestId === this.analysisId) {
                this.rejectEngine('Position changed during analysis');
            }
            this.analysisId = null;
            return;
        }
        if (isBest) {
            this.resolveEngine();
            this.analysisId = null;
        } else {
            this.parseMultiPVInfo(message);
        }
    }

    /**
    * Parse MultiPV info and keep the deepest line per multipv slot
    */
    parseMultiPVInfo(message) {
        const depthMatch = message.match(/depth (\d+)/);
        const multipvMatch = message.match(/multipv (\d+)/);
        const scoreMatch = message.match(/score cp (-?\d+)/);
        const mateMatch = message.match(/score mate (-?\d+)/);
        const moveMatch = message.match(/pv ([a-h][1-8][a-h][1-8][a-z]?)/);

        if (!depthMatch || !multipvMatch || !moveMatch) return;

        const depth = parseInt(depthMatch[1], 10);
        const multipv = parseInt(multipvMatch[1], 10);
        const move = moveMatch[1];

        // Verify FEN turn matches what we expect
        const fen = this.analysisService.lastFen;
        const fenTurn = fen.split(' ')[1];

        if (!fenTurn || (fenTurn !== 'w' && fenTurn !== 'b')) {
            logger.warn('Invalid FEN turn in lastFen:', fenTurn, 'Full FEN:', fen);
            return;
        }

        let score, mateIn;

        if (mateMatch) {
            mateIn = parseInt(mateMatch[1], 10);
            score = mateIn > 0 ? 1000 : -1000;
        } else if (scoreMatch) {
            score = parseInt(scoreMatch[1], 10) / 100.0;
        } else {
            return;
        }

        // Always keep the deepest result seen per multipv slot so that if the engine
        // finishes before the target depth (forced mate, early bestmove, etc.)
        // we still have something to display.
        const existing = this.topMoves[multipv - 1];
        if (!existing || depth >= (existing.depth || 0)) {
            this.topMoves[multipv - 1] = { move, score, multipv, mateIn, depth };
        }
    }

    resolveEngine() {
        this.deliverLines();
        this.analysisService.setAnalyzing(false);
    }

    // Resolve the pending request with up to 3 lines, best first, if they are for its position.
    deliverLines() {
        const lines = this.topMoves.filter(m => m !== undefined).sort((a, b) => a.multipv - b.multipv).slice(0, 3);
        this.topMoves = lines;
        const pending = this.pendingEngine;
        if (lines.length && pending && pending.requestId !== null && pending.requestId === this.analysisId
            && samePosition(pending.fen, this.analysisStartFEN)) {
            this.clearPendingEngine();
            pending.resolve(lines.map(m => ({
                uci: m.move, scoreText: this.overlay.formatScore(m), depth: m.depth,
                score: m.score, mateIn: m.mateIn
            })));
        }
    }

    setupMoveObserver() {
        this.liveSync = new LiveSync({ onPositionChanged: (p) => this.onPositionChanged(p) });
        this.liveSync.start();
    }

    onPositionChanged(p) {
        // Classify first: positions from a blocked page are never stored.
        if (this.gate.check() !== 'training') return;
        this.position = p;
        this.forwardPosition();
    }

    // The board still shows the analyzed position (placement + side to move; the
    // analyzed FEN comes from LiveSync, whose castling field BoardParser can't match).
    isAnalysisStillValid() {
        const currentFEN = BoardParser.getCurrentFEN();
        if (!currentFEN || !this.analysisStartFEN) return true; // can't check
        return samePosition(currentFEN, this.analysisStartFEN);
    }

    setupStorageListener() {
        StorageService.onChange((changes) => {
            if (changes.depth) {
                this.analysisService.setDepth(changes.depth.newValue);
            }
            if (changes.enabled !== undefined) {
                this.overlay.setEnabled(changes.enabled.newValue !== false);
            }
            if (changes.highlightColor !== undefined || changes.arrowColor !== undefined) {
                // setColors ignores missing values.
                MoveHighlighter.setColors({
                    highlightColor: changes.highlightColor?.newValue,
                    arrowColor: changes.arrowColor?.newValue
                });
            }
        });
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const assistant = new ChessAssistant();
        assistant.initialize();
    });
} else {
    const assistant = new ChessAssistant();
    assistant.initialize();
}