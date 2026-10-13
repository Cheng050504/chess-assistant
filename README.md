# Chess Assistant

A free browser extension that provides real-time chess analysis powered by Stockfish directly on [chess.com](https://www.chess.com) and [lichess.org](https://lichess.org).

<img src="https://i.imgur.com/R8GnEoh.jpeg" width="700">

<img src="https://i.imgur.com/CYJSMjJ.jpeg" width="700">

---

## Features

- **Real-time analysis** — Stockfish engine runs locally in your browser; no data is sent to any server
- **One best move per turn** — on your turn the overlay shows a single best-move card with a source badge, a short reason when one applies, the evaluation and up to two alternatives that score about as well, plus an arrow on the board
- **Opening-aware** — guidance follows the opening you chose to learn, then the best book move against the bot's opening, then Stockfish
- **Learn an opening** — pick an opening by name or ECO code; the color is set automatically
- **Depth control** — configurable analysis depth from 5 to 25 half-moves
- **Customizable colors** — choose your own highlight and arrow colors
- **Works on both Chess.com and Lichess.org**
- **Chrome (Manifest V3) and Firefox (Manifest V2) support**

---

## Where assistance works

Engine assistance (the best-move card and arrows) is only on in these places:

- Chess.com: games against the computer (`/play/computer`, `/game/computer/<id>`) and the analysis board (`/analysis`)
- Lichess: the analysis board (`/analysis`)

It is off everywhere else. Human games, daily games and lichess game pages are blocked, and the overlay says "Assistance is off in games against people." This is a change from earlier versions, which worked on every game page.

---

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or later to build (v22 or later to run the tests)
- npm v7 or later

### Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/Gnomee1337/chess-assistant.git
   cd chess-assistant
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```
---

## Building the Extension

### Build for Chrome

```bash
# Development build
npm run build:chrome

# Production build (minified, optimized)
npm run build:chrome:prod

# Package as a .zip ready for the Chrome Web Store
npm run package:chrome
```

### Build for Firefox

```bash
# Development build
npm run build:firefox

# Production build
npm run build:firefox:prod

# Package as a .xpi ready for Firefox Add-ons
npm run package:firefox
```

### Build for both browsers (default)

```bash
# Development build (defaults to Chrome)
npm run build

# Watch mode — rebuilds automatically on file changes
npm run watch

# Watch mode for Firefox
npm run watch:firefox

# Clean the dist/ directory
npm run clean
```

Built files are output to:
- `dist/chrome/` — Chrome extension
- `dist/firefox/` — Firefox add-on

---

## Loading the Extension in Your Browser

### Chrome

1. Open `chrome://extensions/` in your browser
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `dist/chrome/` folder

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Navigate to `dist/firefox/` and select `manifest.json`

> **Note:** Temporary add-ons in Firefox are removed when the browser is closed. For a persistent installation, the extension must be signed or installed via `about:addons`.

### Install in Microsoft Edge

The Chrome (Manifest V3) build works unchanged in Edge.

1. Run `npm run build:chrome`
2. Open `edge://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the `dist/chrome/` folder

---

## Usage

1. Open a game against the computer on [chess.com](https://www.chess.com) (or an analysis board).
2. The **Chess Assistant** overlay appears in the top-right corner of the page.
3. On your turn, the overlay shows one **best-move card** and a solid arrow on the board. Guidance continues every turn until the game ends; there is no move limit.
4. On the bot's turn the card says "Waiting for the bot…". On an analysis board there is no bot, so the card always suggests a move for the side to move.
5. Use the **popup icon** in your browser toolbar to adjust analysis depth and colors.

### The best-move card

The card shows:

- the move, with a badge: **Study**, **Book** or **Engine**
- a short reason when one applies
- the evaluation and depth, for example `+0.3 · depth 15`
- **Also good:** up to two alternative moves, shown only when they are within half a pawn of the chosen move (a mate is listed only next to another mate for the same side)

The move comes from the first rule that applies:

1. **Study**: you chose an opening to learn and the game still fits it. The card shows that opening's next move.
2. **Book**: the position is still in opening theory. The card shows the highest-ranked of Stockfish's top three moves that is also a book move, which is the best counter to the bot's opening, and names the opening.
3. **Engine**: otherwise the card shows Stockfish's best move.

A book move that Stockfish rejects is never shown.

Stockfish runs locally in your browser (no online service) and only on your turn, at the depth set in the popup. If it cannot answer within 30 seconds, the card says "Engine unavailable — retrying on the next move".

### Arrows

- A **solid arrow** is the card's move on your turn.
- A **dashed arrow** is the reply the bot is expected to play. It shows only on the bot's turn, when you are following a study line.

### Overlay controls

| Control | Description |
|---------|-------------|
| **ON / OFF** | Enable or disable the assistant |
| **−** | Collapse the overlay |
| **✕** | Hide the overlay (restore with the floating launcher button) |

---

## Learn an opening

Learning an opening is optional. It works only on the pages listed in [Where assistance works](#where-assistance-works).

1. In the overlay's **Learn an opening** row, click **Choose…** (or the pencil to change the opening). The opening tree loads after the page becomes a training page, so you may see the button disabled for about a second.
2. Search by name or ECO code, for example `alien` or `B15`, and click an opening. There is no color choice: the color is the side that plays the last move of the line.
3. Play the game. While the game fits the line, the card shows the line's next move with the **Study** badge. Notes appear on whichever card move they match. They currently cover the Caro-Kann main moves and the Alien Gambit, which continues past the opening line with 7.Nf3 and the 7...Bg4? 8.Ne5+ trap.
4. If the bot (or you) leaves the line, the status line says so and the card switches to **Book** or **Engine** guidance.
5. Click **Stop learning** to clear the opening.

The only keyboard shortcut is **Esc**, which closes the opening picker.

---

## Manual test checklist

Run these in Microsoft Edge after a change to the extension.

1. `npm run build:chrome`, then `edge://extensions` → Developer mode → Load unpacked → `dist/chrome`.
2. `/play/computer`, no opening chosen: play a full game; the card shows a move every turn of yours until the game ends.
3. Choose the Alien Gambit and play as White; when the bot plays the Caro-Kann, the card shows the Study badge through 6.Nxf7 and then 7.Nf3, with dashed arrows for the expected bot replies while on the line. If the bot plays 7...Bg4, the card shows 8.Ne5+ (the trap).
4. Bot deviates: the card switches to Book or Engine and names the new opening.
5. `/play/online` and a `/game/live/…` page: nothing shown and no engine activity.
6. Navigate from `/play/computer` to `/play/online` without reloading; the panel shows the blocked message within 1 s and no arrows remain.
7. Resize the window and flip the board: arrows stay aligned.

---

## Project Structure

```
chess-assistant/
├── public/                  # Static assets copied into the build
│   ├── manifest.json        # Chrome MV3 manifest
│   ├── manifest.firefox.json# Firefox MV2 manifest
│   ├── offscreen.html       # Chrome MV3 offscreen document
│   ├── browser-polyfill.js  # Chrome/Firefox API compatibility shim
│   ├── icons/               # Extension icons
│   └── stockfish/           # Stockfish engine files (add manually)
├── src/
│   ├── background/          # Service worker / background page
│   │   ├── background.js    # Main background script
│   │   ├── offscreen.js     # Chrome offscreen Stockfish host
│   │   └── stockfish-worker-ff.js  # Firefox Stockfish worker wrapper
│   ├── content/             # Content scripts injected into chess sites
│   │   ├── index.js         # Entry point
│   │   ├── chess/           # Board parsing, FEN validation, move highlighting
│   │   ├── context/         # Page gate: where assistance is allowed
│   │   ├── coach/           # Best-move coach: Study → Book → Engine
│   │   ├── study/           # Opening tree, study tracker, explainer, recent list
│   │   ├── services/        # Analysis service, opening explorer
│   │   └── ui/              # Overlay and coach panel
│   ├── popup/               # Browser action popup (settings UI)
│   ├── shared/              # Shared constants, logger, storage helpers
│   ├── styles/              # Overlay CSS
│   └── vendor/              # Vendored libraries (chess.js)
├── test/                    # Node test runner suites (*.test.js) and fixtures
└── scripts/
    └── build.js             # Build script
```

---

## Scripts Reference

| Command | Description |
|---------|-------------|
| `npm run build` | Development build (Chrome) |
| `npm run build:prod` | Production build (Chrome) |
| `npm run build:chrome` | Development build for Chrome |
| `npm run build:chrome:prod` | Production build for Chrome |
| `npm run build:firefox` | Development build for Firefox |
| `npm run build:firefox:prod` | Production build for Firefox |
| `npm run watch` | Watch mode (Chrome) |
| `npm run watch:firefox` | Watch mode (Firefox) |
| `npm run clean` | Remove `dist/` directory |
| `npm run package:chrome` | Build + package Chrome `.zip` |
| `npm run package:firefox` | Build + package Firefox `.xpi` |
| `npm test` | Run the unit tests (Node 22 or later) |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |

---

## Credits

This project makes use of the following libraries:

- **[@hayatbiralem/eco.json](https://www.npmjs.com/package/@hayatbiralem/eco.json)** — ECO chess opening database in JSON format, used to identify openings by FEN or move sequence.
- **[chess.js 1.4.0](https://github.com/jhlywa/chess.js)** (BSD-2-Clause) — move generation and validation, vendored in `src/vendor/chess.js`.
- **[@nmrugg/stockfish.js v10.0.2](https://www.npmjs.com/package/@nmrugg/stockfish.js)** — Stockfish chess engine compiled to JavaScript/WebAssembly, used for local position analysis.

For more details, refer to the documentation of each library.

---

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

---

## Contributing

Pull requests and issues are welcome! Please open an issue first to discuss any significant changes.

## Disclaimer

This project is provided for educational, research, and development purposes only.

The software may include functionality that can interact with external systems, automate tasks, or process user-provided data. Improper or unauthorized use of these features may violate the terms of service of third-party platforms, local laws, or organizational policies.

By using this project, you agree to:

- Use it only on systems, accounts, and data you own or have explicit permission to access.
- Comply with all applicable laws, regulations, and third-party terms of service.
- Take full responsibility for how the software is used.

The authors and contributors do not encourage, support, or accept responsibility for any illegal, unethical, or unauthorized use of this project.
