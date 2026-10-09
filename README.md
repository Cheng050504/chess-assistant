# Chess Assistant

A free browser extension that provides real-time chess analysis powered by Stockfish directly on [chess.com](https://www.chess.com) and [lichess.org](https://lichess.org).

<img src="https://i.imgur.com/R8GnEoh.jpeg" width="700">

<img src="https://i.imgur.com/CYJSMjJ.jpeg" width="700">

---

## Features

- **Real-time analysis** — Stockfish engine runs locally in your browser; no data is sent to any server
- **Top 3 move suggestions** with evaluation scores and mate detection
- **Opening explorer** — automatically identifies the opening from ECO databases (A–E)
- **Study an opening** — pick an opening by name or ECO code and get move-by-move guidance in Chess.com bot games and on the analysis boards, with a Show/Try toggle for practice
- **Repertoire builder** — save and manage your favorite lines
- **Depth control** — configurable analysis depth from 5 to 25 half-moves
- **Auto-analyze mode** — triggers analysis automatically after each move
- **Move highlighting** — hover over a suggestion to see it highlighted on the board with an arrow
- **Customizable colors** — choose your own highlight and arrow colors
- **Works on both Chess.com and Lichess.org**
- **Chrome (Manifest V3) and Firefox (Manifest V2) support**

---

## Where assistance works

Engine assistance (Analyze, auto-analyze, top-3 suggestions and arrows) is only on in these places:

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

1. Navigate to a game on [chess.com](https://www.chess.com) or [lichess.org](https://lichess.org)
2. The **Chess Assistant** overlay will appear in the top-right corner of the page
3. Click **Analyze** to get the top 3 suggested moves for the current position
4. Enable **AUTO** mode to have analysis triggered automatically after every move
5. Hover over a suggested move to highlight it on the board
6. Use the **popup icon** in your browser toolbar to adjust analysis depth and colors

### Overlay Controls

| Button | Description |
|--------|-------------|
| **ON / OFF** | Enable or disable the assistant |
| **AUTO / MANUAL** | Toggle automatic analysis after each move |
| **Analyze** | Manually trigger analysis of the current position |
| **−** | Collapse the overlay |
| **✕** | Hide the overlay (restore with the floating launcher button) |

---

## Study an opening

The **Study** section of the overlay guides you through an opening in a Chess.com game against the computer, or on the analysis boards (Chess.com and Lichess `/analysis`). It works only on the pages listed in [Where assistance works](#where-assistance-works).

1. In the overlay's Study section, click **Choose opening** (or **Change** if one is already chosen). The opening tree loads after the page becomes a training page, so you may see "Loading openings…" for about a second.
2. In the picker, choose **White** or **Black**. If you do not choose, the default is the side that plays the last move of the line.
3. Search by name or ECO code, for example `alien` or `B15`, and click an opening. The color is fixed at this click. To switch color later, click **Change**, choose the color, and pick the opening again.
4. Play the game. The overlay and the board show what to play next.

### Show and Try

- **Show** displays the book move and its arrow.
- **Try** hides the book move until you click **Show me**. While there is a move for you to find in Try mode, Stockfish's top-3 list is hidden too.

### Arrows and sources

- A **dashed arrow** is the reply the bot is expected to play. A **solid arrow** is your next move.
- Each piece of guidance carries a badge:
  - **Book**: the move comes from the opening line.
  - **Notes**: the move comes with a written explanation. Notes currently cover the Caro-Kann main moves and the Alien Gambit only.
  - **Engine**: the move comes from Stockfish. After the book line ends, or after a deviation, Engine guidance continues for up to 10 of your moves.
- If the bot (or you) leaves the line, the deviation is named and guidance continues from the new position.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| **S** | Switch between Show and Try |
| **H** | Show me (reveal the hidden move in Try mode) |
| **O** | Open the opening picker |
| **Esc** | Close the opening picker |

Shortcuts are ignored while you are typing in a text field and with Ctrl, Cmd or Alt combinations. They do nothing while the overlay is hidden or collapsed, or on pages where assistance is off. **S** and **H** need a chosen opening. **Esc** also closes the picker from inside its search box.

---

## Manual test checklist

Run these in Microsoft Edge after a change to the extension.

1. `npm run build:chrome`, then `edge://extensions` → Developer mode → Load unpacked → `dist/chrome`.
2. `/play/computer` as White: pick Alien Gambit; follow the line; confirm book moves, dashed bot predictions, `reached`.
3. Bot deviates: confirm the new opening name and continued guidance.
4. Try mode: Show me, wrong move feedback.
5. As Black: `wrong-color` message.
6. `/play/online` and a `/game/live/…` page: nothing shown and no engine activity.
7. Resize the window and flip the board: arrows stay aligned.
8. Navigate from `/play/computer` to `/play/online` without reloading; the panel shows the blocked message within 1 s and no arrows remain.

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
│   │   ├── study/           # Opening tree, study tracker/controller, explainer, recent list
│   │   ├── services/        # Analysis service, opening explorer
│   │   └── ui/              # Overlay component
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
