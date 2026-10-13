/**
 * Overlay UI component: draggable panel with the header (ON/OFF, −, ✕) and
 * the coach section (#chess-assistant-study), rendered by StudyPanel.
 */

import { Logger } from '../../shared/logger.js';

const logger = new Logger('Overlay');

export class Overlay {
    constructor() {
        this.element = null;
        this.launcher = null;
        this.isEnabled = true;
        this.isBlocked = false;
        this.isCollapsed = false;
        this.isHidden = false;
        this.onEnabledChangeCallback = null;
        this.dragState = {
            isDragging: false,
            offsetX: 0,
            offsetY: 0
        };
    }

    /**
     * Create and inject overlay into page
     */
    create() {
        if (this.element) return;

        this.element = document.createElement('div');
        this.element.id = 'chess-assistant-overlay';
        this.element.innerHTML = this.getTemplate();

        this.launcher = document.createElement('button');
        this.launcher.id = 'chess-assistant-launcher';
        this.launcher.textContent = '♟️ Assistant';

        document.body.appendChild(this.element);
        document.body.appendChild(this.launcher);

        this.setInitialPosition();
        this.attachEventListeners();
        this.refreshControls();
        logger.log('Overlay created');
    }

    refreshControls() {
        this.updateEnabledButton();
        this.setBlocked(this.isBlocked);
    }

    getTemplate() {
        return `
            <div class="chess-assistant-header">
                <span>♟️ Chess Assistant</span>
                <button id="chess-assistant-toggle" class="toggle-btn">ON</button>
                <button id="chess-assistant-collapse" class="icon-btn" title="Collapse overlay">−</button>
                <button id="chess-assistant-hide" class="icon-btn" title="Hide overlay">✕</button>
            </div>
            <div id="chess-assistant-study" class="study-container" role="region" aria-label="Best move"></div>
        `;
    }

    attachEventListeners() {
        const on = (id, handler) => {
            const node = document.getElementById(id);
            if (node) node.addEventListener('click', handler);
        };
        on('chess-assistant-toggle', () => this.toggleEnabled());
        on('chess-assistant-collapse', () => this.toggleCollapse());
        on('chess-assistant-hide', () => this.hideOverlay());
        this.launcher.addEventListener('click', () => this.showOverlay());

        const header = this.element.querySelector('.chess-assistant-header');
        if (header) {
            header.addEventListener('mousedown', (event) => this.startDrag(event));
        }

        document.addEventListener('mousemove', (event) => this.onDrag(event));
        document.addEventListener('mouseup', () => this.stopDrag());
        window.addEventListener('resize', () => this.handleResize());
    }

    onEnabledChange(callback) {
        this.onEnabledChangeCallback = callback;
    }

    setInitialPosition() {
        if (!this.element) return;

        const margin = 20;
        const width = this.element.offsetWidth || 280;
        this.setPosition(window.innerWidth - width - margin, margin);
    }

    setPosition(left, top) {
        if (!this.element) return;

        const margin = 8;
        const overlayRect = this.element.getBoundingClientRect();
        const maxLeft = Math.max(margin, window.innerWidth - overlayRect.width - margin);
        const maxTop = Math.max(margin, window.innerHeight - overlayRect.height - margin);
        const clampedLeft = Math.min(Math.max(left, margin), maxLeft);
        const clampedTop = Math.min(Math.max(top, margin), maxTop);

        this.element.style.left = `${clampedLeft}px`;
        this.element.style.top = `${clampedTop}px`;
        this.element.style.right = 'auto';

        this.updateLauncherPosition(clampedLeft, clampedTop);
    }

    updateLauncherPosition(left, top) {
        if (!this.launcher) return;

        this.launcher.style.left = `${left}px`;
        this.launcher.style.top = `${top}px`;
        this.launcher.style.right = 'auto';
    }

    startDrag(event) {
        if (event.button !== 0) return;
        if (event.target.closest('button')) return;

        const overlayRect = this.element.getBoundingClientRect();
        this.dragState.isDragging = true;
        this.dragState.offsetX = event.clientX - overlayRect.left;
        this.dragState.offsetY = event.clientY - overlayRect.top;

        this.element.classList.add('dragging');
        event.preventDefault();
    }

    onDrag(event) {
        if (!this.dragState.isDragging || !this.element) return;

        this.setPosition(
            event.clientX - this.dragState.offsetX,
            event.clientY - this.dragState.offsetY
        );
    }

    stopDrag() {
        if (!this.dragState.isDragging || !this.element) return;

        this.dragState.isDragging = false;
        this.element.classList.remove('dragging');
    }

    handleResize() {
        if (!this.element) return;

        const overlayRect = this.element.getBoundingClientRect();
        this.setPosition(overlayRect.left, overlayRect.top);
    }

    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        this.element.classList.toggle('collapsed', this.isCollapsed);

        const collapseBtn = document.getElementById('chess-assistant-collapse');
        if (collapseBtn) {
            collapseBtn.textContent = this.isCollapsed ? '+' : '−';
            collapseBtn.title = this.isCollapsed ? 'Expand overlay' : 'Collapse overlay';
        }
    }

    hideOverlay() {
        this.isHidden = true;
        this.element.classList.add('hidden');
        this.launcher.classList.add('visible');
    }

    showOverlay() {
        this.isHidden = false;
        this.element.classList.remove('hidden');
        this.launcher.classList.remove('visible');

        const overlayRect = this.element.getBoundingClientRect();
        this.setPosition(overlayRect.left, overlayRect.top);
    }

    toggleEnabled() {
        this.setEnabled(!this.isEnabled);
        chrome.storage.sync.set({ enabled: this.isEnabled });
    }

    setEnabled(enabled) {
        enabled = !!enabled;
        const changed = enabled !== this.isEnabled;
        this.isEnabled = enabled;
        this.updateEnabledButton();
        if (changed && this.onEnabledChangeCallback) this.onEnabledChangeCallback(enabled);
    }

    updateEnabledButton() {
        const btn = document.getElementById('chess-assistant-toggle');
        if (!btn) return;

        btn.textContent = this.isEnabled ? 'ON' : 'OFF';
        btn.classList.toggle('off', !this.isEnabled);
    }

    formatScore(moveData) {
        if (Math.abs(moveData.score) > 100) {
            if (moveData.mateIn !== undefined) {
                const absMate = Math.abs(moveData.mateIn);
                if (absMate === 1) {
                    return moveData.mateIn > 0 ? 'Checkmate' : '-Checkmate';
                }
                return moveData.mateIn > 0 ? `Mate in ${absMate}` : `-Mate in ${absMate}`;
            }
            return moveData.score > 0 ? 'Mate!' : '-Mate';
        }
        return moveData.score > 0 ? `+${moveData.score.toFixed(2)}` : moveData.score.toFixed(2);
    }

    // The blocked copy itself is rendered by the coach section.
    setBlocked(blocked) {
        this.isBlocked = blocked;
        if (!this.element) return;
        this.element.classList.toggle('chess-assistant-blocked', blocked);
    }
}
