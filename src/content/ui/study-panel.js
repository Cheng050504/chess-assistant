/**
 * Study section of the overlay: header, status line, move card and the
 * inline opening picker. Builds DOM nodes only; all data and user text is
 * inserted through textContent.
 */

import { defaultStudyColor } from '../study/study-recent.js';

const BLOCKED_COPY = 'Assistance is off in games against people.';
const COLOR_LABEL = { w: 'White', b: 'Black' };
const BADGE_LABEL = { book: 'Book', notes: 'Notes', engine: 'Engine' };
const PREVIEW_MOVES = 6;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function button(label, className, onClick, { action, title, ariaLabel } = {}) {
    const node = el('button', className, label);
    node.type = 'button';
    if (action) node.dataset.studyAction = action;
    if (title) node.title = title;
    if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
    node.addEventListener('click', onClick);
    return node;
}

export class StudyPanel {
    /**
     * @param {HTMLElement} rootEl
     * @param {{onPick: Function, onToggleMode: Function, onReveal: Function,
     *          onSearch: Function, onColor: Function}} callbacks
     */
    constructor(rootEl, callbacks = {}) {
        this.root = rootEl;
        this.callbacks = callbacks;
        this.dataState = 'loading'; // 'loading' | 'ready' | 'unavailable'
        this.view = null;
        this.recent = [];
        this.picker = null;
        this.pickerColor = null; // explicit White/Black choice, null = default
        this.hintColor = 'w';

        this.body = el('div', 'study-body');
        this.body.setAttribute('aria-live', 'polite');
        this.pickerHost = el('div', 'study-picker-host');
        this.root.replaceChildren(this.body, this.pickerHost);
    }

    get pickerOpen() {
        return this.picker !== null;
    }

    setDataState(state) {
        this.dataState = state;
        if (state === 'loading') this.closePicker();
        if (this.picker) this.picker.input.disabled = state !== 'ready';
        this.render(this.view);
    }

    render(view, { recent } = {}) {
        this.view = view;
        if (Array.isArray(recent) && recent !== this.recent) {
            this.recent = recent;
            if (this.picker) this.renderRecent();
        }
        if (view && view.blocked) this.closePicker();

        // Keep keyboard focus on the equivalent control across re-renders.
        const focused = this.body.contains(document.activeElement)
            ? document.activeElement.dataset.studyAction : null;
        this.body.replaceChildren(...this.buildBody(view));
        if (focused) {
            const again = this.body.querySelector(`[data-study-action="${focused}"]`);
            if (again) again.focus();
        }
    }

    buildBody(view) {
        if (view && view.blocked) return [el('p', 'study-note', BLOCKED_COPY)];
        if (this.dataState === 'loading') return [el('p', 'study-note', 'Loading openings…')];

        const nodes = [];
        if (this.dataState === 'unavailable') {
            nodes.push(el('p', 'study-note study-error', 'Opening data unavailable'));
        }

        const target = view && view.target;
        if (!target) {
            nodes.push(el('p', 'study-empty', 'Pick an opening to study'));
            nodes.push(button('Choose opening', 'study-btn study-btn-primary', () => this.openPicker(),
                { action: 'choose', title: 'Choose an opening (O)' }));
            return nodes;
        }

        nodes.push(this.buildHeader(view, target));

        const status = el('div', 'study-status');
        if (view.status && view.status.message) {
            status.appendChild(el('span', 'study-status-text', view.status.message));
        }
        const source = view.move && view.move.source;
        if (BADGE_LABEL[source]) {
            status.appendChild(el('span', `ca-badge ca-badge-${source}`, BADGE_LABEL[source]));
        }
        if (status.childNodes.length) nodes.push(status);

        if (view.engineState === 'pending') nodes.push(el('p', 'study-engine', 'Engine thinking…'));
        if (view.engineState === 'unavailable') nodes.push(el('p', 'study-engine study-error', 'Engine unavailable'));

        if (view.move && view.revealed) nodes.push(this.buildMoveCard(view.move));
        else if (view.move) {
            const card = el('div', 'study-card study-card-hidden');
            card.appendChild(el('p', 'study-prompt', view.move.source === 'engine' ? 'Find the best move' : 'Find the book move'));
            card.appendChild(button('Show me', 'study-btn study-btn-primary', () => this.callbacks.onReveal?.(),
                { action: 'reveal', title: 'Reveal the move (H)' }));
            nodes.push(card);
        }
        return nodes;
    }

    buildHeader(view, target) {
        const header = el('div', 'study-header');
        header.appendChild(el('span', 'study-title', `${target.eco} · ${target.name}`));
        header.appendChild(el('span', `study-color study-color-${target.color}`, COLOR_LABEL[target.color] || ''));

        const label = view.mode === 'try' ? 'Try' : 'Show';
        const toggle = button(label, 'study-btn study-mode', () => this.callbacks.onToggleMode?.(), {
            action: 'mode',
            title: 'Switch between Show and Try (S)',
            ariaLabel: `${label} mode, switch mode (S)`
        });
        header.appendChild(toggle);
        header.appendChild(button('Change', 'study-btn', () => this.openPicker(),
            { action: 'change', title: 'Change opening (O)' }));
        return header;
    }

    buildMoveCard(move) {
        const card = el('div', 'study-card');
        card.appendChild(el('div', 'study-move-san', move.san || move.uci || ''));
        const explanation = move.explanation || {};
        if (explanation.text) card.appendChild(el('p', 'study-explanation', explanation.text));
        if (explanation.threat) card.appendChild(el('p', 'study-threat', explanation.threat));
        if (explanation.nextObjective) card.appendChild(el('p', 'study-next', explanation.nextObjective));
        return card;
    }

    // ── Picker ────────────────────────────────────────────────────────────────

    openPicker() {
        if (this.picker || this.dataState === 'loading' || (this.view && this.view.blocked)) return;

        const target = this.view && this.view.target;
        this.pickerColor = null;
        this.hintColor = target ? defaultStudyColor(target.moves) : 'w';

        const wrap = el('div', 'study-picker');
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', 'Choose an opening to study');

        const row = el('div', 'study-picker-row');
        const input = el('input', 'study-search');
        input.type = 'search';
        input.placeholder = 'Search openings (name or ECO)';
        input.setAttribute('aria-label', 'Search openings (name or ECO)');
        input.disabled = this.dataState !== 'ready';
        input.addEventListener('input', () => this.renderResults());
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.closePicker();
            }
        });
        row.appendChild(input);
        row.appendChild(button('×', 'study-btn study-close', () => this.closePicker(),
            { title: 'Close (Esc)', ariaLabel: 'Close opening picker' }));

        const seg = el('div', 'study-seg');
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Study as');
        const segButtons = {};
        for (const color of ['w', 'b']) {
            segButtons[color] = button(COLOR_LABEL[color], 'study-seg-btn', () => {
                this.pickerColor = color;
                this.updateSwitch();
                this.callbacks.onColor?.(color);
            });
            seg.appendChild(segButtons[color]);
        }

        const results = el('ul', 'study-results');
        const recentHeading = el('div', 'study-picker-heading', 'Recent');
        const recentList = el('ul', 'study-results study-recent');

        wrap.append(row, seg, results, recentHeading, recentList);
        this.picker = { wrap, input, segButtons, results, recentHeading, recentList };
        this.pickerHost.replaceChildren(wrap);

        this.updateSwitch();
        this.renderResults();
        this.renderRecent();
        (input.disabled ? wrap.querySelector('button') : input).focus();
    }

    closePicker() {
        if (!this.picker) return;
        const hadFocus = this.picker.wrap.contains(document.activeElement);
        this.picker = null;
        this.pickerHost.replaceChildren();
        if (hadFocus) {
            const back = this.body.querySelector('[data-study-action="change"], [data-study-action="choose"]');
            if (back) back.focus();
        }
    }

    currentColor() {
        return this.pickerColor || this.hintColor;
    }

    updateSwitch() {
        if (!this.picker) return;
        const color = this.currentColor();
        for (const [c, btn] of Object.entries(this.picker.segButtons)) {
            btn.classList.toggle('active', c === color);
            btn.setAttribute('aria-pressed', String(c === color));
        }
    }

    // Until the user chooses a color, the switch follows the line under the pointer/focus.
    hint(sanMoves) {
        if (this.pickerColor) return;
        this.hintColor = defaultStudyColor(sanMoves);
        this.updateSwitch();
    }

    renderResults() {
        if (!this.picker) return;
        const query = this.picker.input.value.trim();
        const list = this.picker.results;
        if (!query || this.dataState !== 'ready') {
            list.replaceChildren();
            return;
        }
        const results = this.callbacks.onSearch?.(query) || [];
        if (!results.length) {
            list.replaceChildren(el('li', 'study-results-empty', 'No openings found'));
            return;
        }
        list.replaceChildren(...results.map(r => this.buildResultItem(r.eco, r.name, r.sanMoves, () => ({
            eco: r.eco, name: r.name, moves: r.sanMoves, fen: r.fen,
            color: this.pickerColor || defaultStudyColor(r.sanMoves), mode: 'show'
        }))));
        this.hint(results[0].sanMoves);
    }

    renderRecent() {
        if (!this.picker) return;
        const { recentHeading, recentList } = this.picker;
        const items = this.recent.filter(t => t && t.eco && t.name && Array.isArray(t.moves));
        recentHeading.hidden = items.length === 0;
        recentList.replaceChildren(...items.map(t => this.buildResultItem(t.eco, t.name, t.moves, () => ({
            eco: t.eco, name: t.name, moves: t.moves, fen: t.fen,
            color: this.pickerColor || t.color || defaultStudyColor(t.moves), mode: 'show'
        }))));
    }

    buildResultItem(eco, name, sanMoves, makeTarget) {
        const item = el('li');
        const btn = button('', 'study-result', () => {
            const target = makeTarget();
            this.closePicker();
            this.callbacks.onPick?.(target);
        });
        btn.appendChild(el('span', 'study-result-name', `${eco} ${name}`));
        btn.appendChild(el('span', 'study-result-moves', (sanMoves || []).slice(0, PREVIEW_MOVES).join(' ')));
        const onHint = () => this.hint(sanMoves);
        btn.addEventListener('focus', onHint);
        btn.addEventListener('mouseenter', onHint);
        item.appendChild(btn);
        return item;
    }
}
