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
import { StudyController } from './study/study-controller.js';
import { OpeningTree } from './study/opening-tree.js';
import { updateRecent } from './study/study-recent.js';
import { shouldSuppressMoves, samePosition } from './study/study-view.js';
import { STORAGE_KEYS, STUDY } from '../shared/constants.js';

const logger = new Logger('Content');

const EXPLORER_BLOCKED_COPY = 'Assistance is off in games against people.';
const EXPLORER_IDLE = { name: 'Opening not recognized yet', lines: ['Run analysis to detect opening context'], playedMoves: [] };

const isStudyTarget = (t) => !!t && typeof t.fen === 'string' && Array.isArray(t.moves)
    && (t.color === 'w' || t.color === 'b');

class ChessAssistant {
    constructor() {
        this.analysisService = new AnalysisService();
        this.openingExplorer = new OpeningExplorer();
        this.overlay = new Overlay(this.analysisService);
        this.gate = null;
        this.liveSync = null;
        this.contextVerdict = 'blocked';
        this.position = null;
        this.analysisStartFEN = null;
        this.analysisStartTurn = null;
        this.analysisColor = null;
        this.topMoves = [];
        this.currentAnalysisDepth = 0;
        this.maxAnalysisDepth = 0;
        this.repertoireLines = [];
        this.highlightColor = null;
        this.arrowColor = null;
        this.studyTree = null;
        this.studyController = null;
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

        // The background port is opened only on a training verdict (applyVerdict).
        this.startGate();

        this.overlay.create();
        this.overlay.refreshControls();
        this.overlay.setRepertoireLines(this.repertoireLines);
        this.setupOverlayCallbacks();
        this.overlay.onBeforeAnalyze(() => this.gate.check());
        this.setupAnalysisCallbacks();
        this.setupMoveObserver();
        this.setupStorageListener();
        this.createStudyPanel();
        this.scheduleStudyInit();
        document.addEventListener('keydown', (event) => this.onStudyKey(event));

        logger.log('Chess Assistant ready!');
    }

    // ── Study ─────────────────────────────────────────────────────────────────

    createStudyPanel() {
        const root = document.getElementById('chess-assistant-study');
        if (!root) return;
        this.studyPanel = new StudyPanel(root, {
            onPick: (target) => this.pickStudyTarget(target),
            onToggleMode: () => this.toggleStudyMode(),
            onReveal: () => this.studyController?.revealHint(),
            onSearch: (query) => this.studyTree ? this.studyTree.search(query, STUDY.SEARCH_LIMIT) : [],
            onColor: (color) => logger.log('Study color switched to', color)
        });
        this.renderStudy();
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
            this.studyController = new StudyController({
                tree,
                notes,
                requestEngine: (fen) => this.requestEngine(fen),
                cancelEngine: () => { this.pendingEngine = null; },
                onUpdate: (view) => this.renderStudy(view)
            });
            this.studyPanel?.setDataState(tree.size ? 'ready' : 'unavailable');
            this.studyController.setBlocked(this.contextVerdict === 'blocked');
            this.studyController.setTarget(this.studyTarget);
            if (this.position) this.studyController.setPosition(this.position);
        } catch (error) {
            logger.error('Study setup failed:', error);
            this.studyPanel?.setDataState('unavailable');
        }
    }

    renderStudy(view = this.studyController?.view) {
        const blocked = this.contextVerdict === 'blocked';
        const v = view || { blocked, target: null, move: null };
        this.studyPanel?.render(v, { recent: this.studyRecent });
        this.overlay.setSuppressMoves(shouldSuppressMoves(v));
        if (blocked || v.blocked || !v.target) {
            MoveHighlighter.clearStudyArrows();
            return;
        }
        // Solid arrow only for a move playable now (not the book move after a deviation).
        const playable = v.revealed && v.status?.nextMove ? v.move?.uci ?? null : null;
        MoveHighlighter.drawStudyArrows({ primaryUci: playable, predictedUci: v.predictedUci });
    }

    pickStudyTarget(target) {
        this.studyTarget = target;
        this.studyRecent = updateRecent(this.studyRecent, target);
        this.studyController?.setTarget(target);
        this.saveStudy(true);
    }

    toggleStudyMode() {
        const controller = this.studyController;
        if (!controller?.target) return;
        controller.setMode(controller.mode === 'try' ? 'show' : 'try');
        this.studyTarget = controller.target;
        this.saveStudy(false);
    }

    saveStudy(withRecent) {
        const writes = [StorageService.set(STORAGE_KEYS.STUDY_TARGET, this.studyTarget)];
        if (withRecent) writes.push(StorageService.set(STORAGE_KEYS.STUDY_RECENT, this.studyRecent));
        Promise.all(writes).catch(() => this.overlay.updateMessage('Couldn\'t save study settings.'));
    }

    // Engine bridge for the study controller: shares the regular analysis
    // when it is already running on this position, otherwise starts one.
    requestEngine(fen) {
        const service = this.analysisService;
        if (service.isBlocked) return Promise.reject(new Error('Analysis is blocked'));
        return new Promise((resolve, reject) => {
            const entry = { fen, resolve, reject };
            this.pendingEngine = entry;
            // Next task: lets an auto-analysis started for the same move go first.
            setTimeout(async () => {
                if (this.pendingEngine !== entry) return;
                if (service.isAnalyzing && samePosition(service.lastFen, fen)) return;
                const connected = !service.isBlocked && await service.ensureConnected();
                if (this.pendingEngine !== entry) return;
                if (!connected || !service.sendAnalyzeRequest(fen)) {
                    this.pendingEngine = null;
                    reject(new Error('Engine request failed'));
                }
            }, 0);
        });
    }

    onStudyKey(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const t = event.composedPath?.()[0] ?? event.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
        const panel = this.studyPanel;
        const controller = this.studyController;
        if (!panel || !controller || this.overlay.isHidden || this.overlay.isCollapsed) return;

        const key = (event.key || '').toLowerCase();
        if (key === 'escape' && panel.pickerOpen) panel.closePicker();
        else if (this.contextVerdict === 'blocked') return;
        else if (key === 's' && controller.target) this.toggleStudyMode();
        else if (key === 'h' && controller.target) controller.revealHint();
        else if (key === 'o' && !panel.pickerOpen) {
            panel.openPicker();
            if (!panel.pickerOpen) return;
        } else return;
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
            this.analysisStartTurn = null;
            this.analysisColor = null;
            // Forget the (possibly human-game) position so an unblock can't reuse it.
            this.position = null;
            this.overlay.setBlocked(true);
            this.overlay.setOpening({ name: EXPLORER_BLOCKED_COPY, lines: [], playedMoves: [] });
            MoveHighlighter.clearStudyArrows();
        } else {
            this.analysisService.setBlocked(false);
            this.analysisService.connect(); // idempotent
            this.overlay.setBlocked(false);
            this.overlay.setOpening({ ...EXPLORER_IDLE });
            // Re-read the board so guidance starts from the current position.
            const fresh = this.liveSync?.snapshot() ?? null;
            if (fresh) this.position = fresh;
        }
        if (this.studyController) {
            this.studyController.setBlocked(blocked);
            this.studyController.setPosition(this.position);
        } else {
            this.renderStudy();
        }
        this.scheduleStudyInit();
    }

    async loadSettings() {
        const settings = await StorageService.getMultiple([
            STORAGE_KEYS.DEPTH,
            STORAGE_KEYS.ENABLED,
            STORAGE_KEYS.AUTO_ANALYZE,
            STORAGE_KEYS.REPERTOIRE_LINES,
            STORAGE_KEYS.HIGHLIGHT_COLOR,
            STORAGE_KEYS.ARROW_COLOR,
            STORAGE_KEYS.STUDY_TARGET,
            STORAGE_KEYS.STUDY_RECENT
        ]);

        this.analysisService.setDepth(settings.depth);
        this.overlay.isEnabled = settings.enabled;
        this.overlay.autoAnalyze = settings.autoAnalyze;
        this.repertoireLines = settings.repertoireLines || [];
        this.highlightColor = settings.highlightColor;
        this.arrowColor = settings.arrowColor;
        this.studyTarget = isStudyTarget(settings.studyTarget) ? settings.studyTarget : null;
        this.studyRecent = Array.isArray(settings.studyRecent) ? settings.studyRecent.filter(isStudyTarget) : [];
        MoveHighlighter.setColors({
            highlightColor: this.highlightColor,
            arrowColor: this.arrowColor
        });
        this.overlay.refreshControls();
    }

    setupOverlayCallbacks() {
        this.overlay.onSaveRepertoire(() => this.saveCurrentLineToRepertoire());
        this.overlay.onRemoveRepertoire((index) => this.removeRepertoireLine(index));
    }

    saveCurrentLineToRepertoire() {
        if (!this.topMoves.length) {
            this.overlay.updateMessage('Run analysis first to save a line');
            return;
        }

        const bestLine = this.topMoves[0];
        const opening = this.openingExplorer.findOpening({
            fen: this.analysisService.lastFen,
            playedMoves: this.getPlayedMoves()
        });

        const entry = {
            eco: opening.eco,
            name: opening.name,
            line: bestLine.move,
            fen: this.analysisService.lastFen,
            playedMoves: opening.playedMoves,
            savedAt: Date.now()
        };

        const duplicate = this.repertoireLines.some(
            item => item.fen === entry.fen && item.line === entry.line
        );
        if (duplicate) {
            this.overlay.updateMessage('This line is already saved in repertoire');
            return;
        }

        this.repertoireLines = [entry, ...this.repertoireLines].slice(0, 50);
        StorageService.set(STORAGE_KEYS.REPERTOIRE_LINES, this.repertoireLines)
            .then(() => {
                this.overlay.setRepertoireLines(this.repertoireLines);
                this.overlay.updateMessage('Saved line to repertoire');
            })
            .catch(() => this.overlay.showError('Could not save repertoire line'));
    }

    removeRepertoireLine(index) {
        if (index < 0 || index >= this.repertoireLines.length) return;

        this.repertoireLines.splice(index, 1);
        StorageService.set(STORAGE_KEYS.REPERTOIRE_LINES, this.repertoireLines)
            .then(() => this.overlay.setRepertoireLines(this.repertoireLines))
            .catch(() => this.overlay.showError('Could not update repertoire'));
    }

    setupAnalysisCallbacks() {
        this.analysisService.onMove((message) => {
            this.handleStockfishMessage(message);
        });

        this.analysisService.onAnalyzeStart(() => {
            this.topMoves = [];
            this.currentAnalysisDepth = 0;
            this.maxAnalysisDepth = this.analysisService.depth;

            this.analysisStartFEN = this.analysisService.lastFen;
            this.analysisStartTurn = this.analysisStartFEN.split(' ')[1];
            this.analysisColor = this.analysisStartTurn === 'w' ? 'white' : 'black';

            logger.log('Analysis started for FEN:', this.analysisStartFEN);
            logger.log('Analysis started, turn was:', this.analysisStartTurn);
            logger.log('Analyzing color:', this.analysisColor);

            MoveHighlighter.clearAll();
        });

        this.analysisService.onError((error) => {
            this.overlay.showError(error);
        });

        // Show a friendly status while the WASM engine is still loading.
        this.analysisService.onLoading((status) => {
            this.overlay.updateMessage('⏳ ' + status);
        });
    }

    handleStockfishMessage(message) {
        if (this.contextVerdict !== 'training') return;

        // Show intermediate moves as they arrive (before bestmove)
        if (message.includes('info depth') && message.includes('multipv')) {
            // Extract and track depth
            const depthMatch = message.match(/depth (\d+)/);
            if (depthMatch) {
                const depth = parseInt(depthMatch[1], 10);
                if (depth > this.currentAnalysisDepth) {
                    this.currentAnalysisDepth = depth;
                }
            }

            this.parseMultiPVInfo(message);

            // Check if position has changed before displaying
            if (!this.isAnalysisStillValid()) {
                logger.warn('Position changed during analysis, stopping display');
                this.stopCurrentAnalysis();
                return;
            }

            // Update UI with partial results every few depths
            // Show partial results with depth indicator
            if (this.topMoves.length > 0) {
                const validMoves = this.topMoves
                    .filter(m => m !== undefined)
                    .slice(0, 3);
                if (validMoves.length > 0) {
                    this.overlay.displayMoves(
                        validMoves,
                        this.currentAnalysisDepth,
                        this.maxAnalysisDepth,
                        this.analysisColor
                    );
                }
            }
        } else if (message.includes('bestmove')) {
            // Check one more time before displaying final results
            if (!this.isAnalysisStillValid()) {
                logger.warn('Position changed, discarding analysis results');
                this.stopCurrentAnalysis();
                return;
            }
            // Show final results without depth (or keep it)
            this.currentAnalysisDepth = 0;
            this.displayResults();
        }
    }

    /**
    * Parse MultiPV info and track moves
    * Only process if it's actually the human's turn
    */
    parseMultiPVInfo(message) {
        if (!this.analysisService.isAnalyzing) return;
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

    displayResults() {
        if (this.topMoves.length > 0) {
            const validMoves = this.topMoves.filter(m => m !== undefined);
            validMoves.sort((a, b) => a.multipv - b.multipv);
            this.topMoves = validMoves.slice(0, 3);
            const pending = this.pendingEngine;
            if (pending && samePosition(pending.fen, this.analysisStartFEN)) {
                const best = this.topMoves[0];
                this.pendingEngine = null;
                pending.resolve({ uci: best.move, scoreText: this.overlay.formatScore(best), depth: best.depth });
            }
            this.overlay.displayMoves(this.topMoves, 0, 0);
            this.updateOpeningExplorer();
        } else {
            this.overlay.showError('No moves found');
        }

        this.analysisService.setAnalyzing(false);
    }

    getPlayedMoves() {
        return this.position?.sanHistory ?? [];
    }

    updateOpeningExplorer() {
        const opening = this.openingExplorer.findOpening({
            fen: this.analysisService.lastFen,
            playedMoves: this.getPlayedMoves()
        });

        const suggestedLines = [...(opening.lines || [])];
        const tryHidden = shouldSuppressMoves(this.studyController?.view);
        if (this.contextVerdict === 'training' && this.topMoves[0] && !tryHidden) {
            suggestedLines.unshift(`Engine best move here: ${this.topMoves[0].move}`);
        }

        this.overlay.setOpening({
            name: `${opening.eco} • ${opening.name}`,
            lines: suggestedLines.slice(0, 4),
            playedMoves: opening.playedMoves
        });
    }

    setupMoveObserver() {
        this.liveSync = new LiveSync({ onPositionChanged: (p) => this.onPositionChanged(p) });
        this.liveSync.start();
    }

    onPositionChanged(p) {
        // Classify first: positions from a blocked page are never stored.
        if (this.gate.check() !== 'training') return;
        this.position = p;
        this.studyController?.setPosition(p);
        if (!this.overlay.autoAnalyze || !this.overlay.isEnabled || !p.synced) return;

        logger.log('Position changed, auto-analyzing...');
        this.stopCurrentAnalysis();
        this.overlay.analyze();
    }

    // Stop current analysis and reset UI
    stopCurrentAnalysis() {
        logger.log('Stopping previous analysis for old position');

        // Stop the analysis in the engine
        this.analysisService.stopAnalysis();

        // Reset overlay UI
        this.currentAnalysisDepth = 0;
        this.topMoves = [];
        this.analysisStartFEN = null;
        this.analysisStartTurn = null;
        this.analysisColor = null;
        MoveHighlighter.clearAll();

        // Clear the moves display
        this.overlay.updateMessage('Position changed, analyzing new position...');
    }

    /**
     * Check if the current board position matches when analysis started
     * If the position changed (opponent moved), analysis is no longer valid
     */
    isAnalysisStillValid() {
        const currentFEN = BoardParser.getCurrentFEN();
        if (!currentFEN || !this.analysisStartFEN) {
            logger.warn('Cannot validate analysis: missing FEN');
            return true; // Assume valid if we can't check
        }

        // Get current turn
        const currentTurn = currentFEN.split(' ')[1];
        const startTurn = this.analysisStartTurn;

        // If turn changed, position changed!
        if (currentTurn !== startTurn) {
            logger.warn(
                `Turn changed during analysis! Started: ${startTurn}, Now: ${currentTurn}`
            );
            return false;
        }

        // Also compare the full FEN position (not move counter)
        const currentPos = currentFEN.split(' ').slice(0, 4).join(' ');
        const startPos = this.analysisStartFEN.split(' ').slice(0, 4).join(' ');

        if (currentPos !== startPos) {
            logger.warn('Position changed during analysis');
            logger.warn('Started:', startPos);
            logger.warn('Now:', currentPos);
            return false;
        }

        return true;
    }

    setupStorageListener() {
        StorageService.onChange((changes) => {
            if (changes.depth) {
                this.analysisService.setDepth(changes.depth.newValue);
            }
            if (changes.enabled !== undefined) {
                this.overlay.isEnabled = changes.enabled.newValue;
                this.overlay.updateEnabledButton();
            }
            if (changes.autoAnalyze !== undefined) {
                this.overlay.autoAnalyze = changes.autoAnalyze.newValue;
                this.overlay.updateAutoButton();
            }
            if (changes.repertoireLines !== undefined) {
                this.repertoireLines = changes.repertoireLines.newValue || [];
                this.overlay.setRepertoireLines(this.repertoireLines);
            }
            if (changes.highlightColor !== undefined || changes.arrowColor !== undefined) {
                this.highlightColor = changes.highlightColor
                    ? changes.highlightColor.newValue : this.highlightColor;
                this.arrowColor = changes.arrowColor
                    ? changes.arrowColor.newValue : this.arrowColor;
                MoveHighlighter.setColors({
                    highlightColor: this.highlightColor,
                    arrowColor: this.arrowColor
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