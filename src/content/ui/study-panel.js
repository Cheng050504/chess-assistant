/**
 * Coach section of the overlay: opening name, the best-move card, the
 * "Learn an opening" row, the study status line and the inline opening
 * picker. Builds DOM nodes only; all data and user text is inserted through
 * textContent.
 */

const BLOCKED_COPY = 'Assistance is off in games against people.';
const BADGE_LABEL = { study: 'Study', book: 'Book', engine: 'Engine' };
const CARD_COPY = {
    waiting: 'Waiting for the bot…',
    thinking: 'Thinking…',
    loading: 'Engine loading…',
    unavailable: 'Engine unavailable — retrying on the next move',
    syncing: 'Syncing with board…',
    gameover: 'Game over'
};
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
     * @param {{onPick: Function, onStop: Function, onSearch: Function}} callbacks
     */
    constructor(rootEl, callbacks = {}) {
        this.root = rootEl;
        this.callbacks = callbacks;
        this.dataState = 'loading'; // 'loading' | 'ready' | 'unavailable'
        this.view = null;
        this.recent = [];
        this.picker = null;

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

        const nodes = [];
        if (view && view.openingName) nodes.push(el('div', 'coach-opening', view.openingName));
        const card = this.buildCard(view && view.card);
        if (card) nodes.push(card);
        nodes.push(this.buildLearnRow(view && view.target));
        if (this.dataState === 'unavailable') {
            nodes.push(el('p', 'study-note study-error', 'Opening data unavailable'));
        }
        if (view && view.target && view.studyMessage) {
            nodes.push(el('p', 'coach-status', `↳ ${view.studyMessage}`));
        }
        return nodes;
    }

    buildCard(card) {
        if (!card) return null;
        if (card.kind === 'move' && card.move) return this.buildMoveCard(card);
        const copy = CARD_COPY[card.kind];
        return copy ? el('div', 'coach-card coach-card-note', copy) : null;
    }

    buildMoveCard({ move, alternatives }) {
        const card = el('div', 'coach-card');
        const top = el('div', 'coach-card-top');
        top.appendChild(el('span', 'coach-move', move.san || move.uci || ''));
        if (BADGE_LABEL[move.source]) {
            top.appendChild(el('span', `ca-badge ca-badge-${move.source}`, BADGE_LABEL[move.source]));
        }
        card.appendChild(top);
        const text = move.explanation && move.explanation.text;
        if (text) card.appendChild(el('p', 'coach-explanation', text));
        if (move.scoreText && move.depth) {
            card.appendChild(el('p', 'coach-score', `${move.scoreText} · depth ${move.depth}`));
        }
        const alts = (alternatives || []).map(a => a.san || a.uci).filter(Boolean);
        if (alts.length) card.appendChild(el('p', 'coach-alts', 'Also good: ' + alts.join(' · ')));
        return card;
    }

    buildLearnRow(target) {
        const row = el('div', 'coach-learn');
        row.appendChild(el('span', 'coach-learn-label', 'Learn an opening'));
        if (!target) {
            const choose = button('Choose…', 'study-btn', () => this.openPicker(), { action: 'choose' });
            choose.disabled = this.dataState === 'loading';
            row.appendChild(choose);
            return row;
        }
        row.appendChild(el('span', 'coach-learn-name', target.name));
        row.appendChild(button('✎', 'study-btn coach-edit', () => this.openPicker(),
            { action: 'change', title: 'Change opening', ariaLabel: 'Change opening' }));
        row.appendChild(button('Stop learning', 'coach-stop', () => {
            this.closePicker();
            this.callbacks.onStop?.();
        }, { action: 'stop' }));
        return row;
    }

    // ── Picker ────────────────────────────────────────────────────────────────

    openPicker() {
        if (this.picker || this.dataState === 'loading' || (this.view && this.view.blocked)) return;

        const wrap = el('div', 'study-picker');
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', 'Choose an opening to learn');

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

        const results = el('ul', 'study-results');
        const recentHeading = el('div', 'study-picker-heading', 'Recent');
        const recentList = el('ul', 'study-results study-recent');

        wrap.append(row, results, recentHeading, recentList);
        this.picker = { wrap, input, results, recentHeading, recentList };
        this.pickerHost.replaceChildren(wrap);

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
        list.replaceChildren(...results.map(r => this.buildResultItem(
            { eco: r.eco, name: r.name, moves: r.sanMoves, fen: r.fen })));
    }

    renderRecent() {
        if (!this.picker) return;
        const { recentHeading, recentList } = this.picker;
        const items = this.recent.filter(t => t && t.eco && t.name && Array.isArray(t.moves));
        recentHeading.hidden = items.length === 0;
        recentList.replaceChildren(...items.map(t => this.buildResultItem(
            { eco: t.eco, name: t.name, moves: t.moves, fen: t.fen })));
    }

    buildResultItem(target) {
        const item = el('li');
        const btn = button('', 'study-result', () => {
            this.closePicker();
            this.callbacks.onPick?.(target);
        });
        btn.appendChild(el('span', 'study-result-name', `${target.eco} ${target.name}`));
        btn.appendChild(el('span', 'study-result-moves', (target.moves || []).slice(0, PREVIEW_MOVES).join(' ')));
        item.appendChild(btn);
        return item;
    }
}
