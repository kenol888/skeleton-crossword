# Skeleton Crossword

A static, no-build web app (PWA) for solving Sunday Express style skeleton crosswords on an iPad. Plain ES modules, no framework, no bundler, no runtime dependencies. See `README.md` for what it does and `PLAN.md` for the original design.

## Commands

- Serve locally: `python tools/serve.py 8080`, then open `http://localhost:8080/?nosw`. That server sends `Cache-Control: no-store`; the `?nosw` flag skips the service worker and clears its cache. You need both while editing, otherwise the browser mixes old and new modules and the page comes up blank. If it still does, refresh each file with `fetch(url, { cache: 'reload' })` and reload.
- Tests: `node --test tests/` (Node 20, no install step, no dependencies).
- Regenerate icons: `python tools/make-icons.py`.
- Rebuild the sample puzzle: `node tools/build-sample.mjs` (writes `samples/sample-skeleton.json`; it checks that the intended layout is among the solver's solutions).

## Layout and conventions

- Pure logic has no DOM access and is covered by tests: `js/model.js`, `js/solver.js`, `js/clueParser.js`, `js/clueFinder.js`, `js/gridDetect.js`. Keep it that way. Anything that touches `document`, `canvas` or `localStorage` lives elsewhere (`js/imageImport.js`, `js/ocr.js`, `js/storage.js`, `js/theme.js`, `js/play.js`, `js/importFlow.js`, `js/ui/*`).
- Add a test whenever you change pure logic. Tests live in `tests/` and use `node:test`.
- All colours are CSS tokens on `:root` in `css/styles.css`, with the dark theme under `:root[data-theme="dark"]`. Do not hard-code colours in components.
- Never use `alert()`, `confirm()` or `prompt()`. Use `dialog`, `confirmDialog` and `inputDialog` from `js/ui/dom.js`.
- Every `localStorage` access goes through `js/storage.js`, which wraps it in try/catch and falls back to memory.
- Touch targets are at least 44px. Use `touch-action: manipulation` on controls and `touch-action: none` on the grid.
- Heavy libraries (Tesseract.js, pdf.js, the word list) are loaded lazily from CDNs with exact pinned versions. Every feature that needs one must fail with a clear message and leave the rest of the app working.

## How the pieces fit

- A puzzle is `{ rows, cols, cells[], clues:{across,down}, settings, ... }` (see `js/model.js`). Grids are rectangular: the Sunday Express skeleton is 15 columns by 11 rows. Version 1 files had one square `size` and half-turn symmetry; `fromJSON` still reads them. `cells[i].block` is the player's black square; `givenBlock`, `givenNumber` and `givenLetter` are hints printed in the source and are locked.
- Runs of white squares come from the blocks (`computeNumbering`), never stored. The player must never be numbered for: the grid shows only `givenNumber` (printed) and `userNumber` (typed by the player), and a clue is linked to a word by `linkClues`, which looks for the square the player numbered with that clue's number. `matchClues` (the numbers a drawn layout would get) is kept only to judge a layout in opt-in feedback; do not show computed numbers, and do not use them to select or highlight clues (that would reveal where numbers go). 
- Symmetry is `settings.symmetry`: `mirror4` (reflect top/bottom and left/right, up to three copies of a square; the Sunday Express rule), `rotational` (half turn) or `none`. `symmetryTargets()` in `js/model.js` is the single definition; the solver and the play screen both use it.
- `js/solver.js` (`solveLayout`) finds black-square layouts from the clue numbers. The app does not use it any more: the Check my layout, Hint and Reveal tools were removed at the testers' request. It stays because it is pure, tested logic that `tools/build-sample.mjs` uses and a future feature might want. Do not bring those tools back without being asked.
- The player picks a square first, then what to put in it (Letter, Number, Black square); `S.input` is `letter` or `number` and the keyboard shows letters or a number pad to match. Numbers are typed digit by digit into the square (`typeDigit`), and a number is taken from any other square when typing moves on (`finishNumber`). Never add a pop-up for typing a number.
- Light is the default appearance and dark is a setting (`settings.theme`, applied by `js/theme.js` and by a tiny script in `index.html` before first paint). The app never follows the device's dark mode.
- `js/play.js` owns all play state. Edits go through `commit()` so undo and redo, autosave and re-rendering stay consistent.
- `settings.symmetry` (per puzzle) is the rule the puzzle follows and what the solver assumes; `settings.autoMirror` (global) only decides whether placing a square also places its mirrors. With it off the player places every mirror square, and the mirror squares of a selected black square are ringed.

## Gotchas

- Run `node tools/stamp.mjs` before every push (`--keep` re-stamps the time without raising the number). It writes the version, the time and the list of app files into `version.json`, the version into `js/version.js`, and the `CACHE` name into `sw.js`; `tests/version.test.js` checks they agree and that every imported module is on the list. There is no hand-kept file list: the worker reads the list from `version.json` when it installs.
- GitHub Pages lets browsers keep files for ten minutes (`max-age=600`). Anything that is meant to fetch the latest files must bypass that cache: the worker installs with `fetch(f, { cache: 'reload' })` and refuses to install if `version.json` belongs to a different release; `Update now` re-fetches every file with `cache: 'reload'` before clearing the stored copies and reloading. A plain `location.reload()` or a worker `fetch()` through the browser cache can store or show the old files, which is how an update once appeared to do nothing. `version.json` itself is never cached or answered by the worker.
- Grid size detection (`detectGridDims`) prefers the largest size that scores close to the best, because a 15 grid also has the line positions of a 5 grid, and it tries nearby row counts because a skewed photo distorts the aspect ratio. Grid finding (`detectQuads`) keys on groups of long parallel lines with the same extent, which ignores title bars and form underlines; it returns several candidates because a newspaper page can hold more than one crossword. `.local-test/` (git-ignored) is where to put a real page image for trying the importer; never commit one.
- Import reads the page with Tesseract in `recognizeWords()` (`js/ocr.js`), which returns every word with its box and is cached per canvas. The same read is used three ways: judging orientation (`fixOrientation` in `js/imageImport.js` tries the rotations that fit the grid's shape and keeps the one with the most confidently read words), then locating the clue lists (`locateClues`), then a careful second read of each list. Never judge where a clue list ends by the height of word boxes: the text reader's boxes differ between browsers and devices (a box can be several lines tall), and an early version that did so stopped after two clues on an iPad while working on desktop. `measureSection` uses only word centres and the usual line pitch, and `tests/clueFinder.test.js` feeds it deliberately messy boxes. `findClues` also retries with a looser gap when clue numbers are missing.
- The on-screen keyboard is `settings.keyboard`: `auto` (shown after tapping a white square, hidden by its Hide button or when a black square is selected), `always` or `never`. Keep the clue lists as the default focus.
- There is no answer key, so never claim answers are correct, only that the grid is complete.
- The sample puzzle is invented. Do not add real newspaper puzzles or clues to the repository.

## Deployment

Run `node tools/stamp.mjs`, commit, then push. The site is the repository root, served as-is by GitHub Pages from the `main` branch. There is no build step, so every path must be relative (no leading `/`) so it works under `/<repo-name>/`.
