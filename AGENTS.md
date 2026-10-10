# Skeleton Crossword

A static, no-build web app (PWA) for solving Sunday Express style skeleton crosswords on an iPad. Plain ES modules, no framework, no bundler, no runtime dependencies. See `README.md` for what it does and `PLAN.md` for the original design.

## Commands

- Serve locally: `python tools/serve.py 8080`, then open `http://localhost:8080/?nosw`. That server sends `Cache-Control: no-store`; the `?nosw` flag skips the service worker and clears its cache. You need both while editing, otherwise the browser mixes old and new modules and the page comes up blank. If it still does, refresh each file with `fetch(url, { cache: 'reload' })` and reload.
- Tests: `node --test tests/` (Node 20, no install step, no dependencies).
- Regenerate icons: `python tools/make-icons.py`.
- Rebuild the sample puzzle: `node tools/build-sample.mjs` (writes `samples/sample-skeleton.json`; it checks that the intended layout is among the solver's solutions).

## Layout and conventions

- Pure logic has no DOM access and is covered by tests: `js/model.js`, `js/solver.js`, `js/clueParser.js`, `js/clueFinder.js`, `js/gridDetect.js`. Keep it that way. Anything that touches `document`, `canvas` or `localStorage` lives elsewhere (`js/imageImport.js`, `js/ocr.js`, `js/storage.js`, `js/play.js`, `js/importFlow.js`, `js/ui/*`).
- Add a test whenever you change pure logic. Tests live in `tests/` and use `node:test`.
- All colours are CSS tokens on `:root` in `css/styles.css`, with a dark theme under `prefers-color-scheme: dark`. Do not hard-code colours in components.
- Never use `alert()`, `confirm()` or `prompt()`. Use `dialog`, `confirmDialog` and `inputDialog` from `js/ui/dom.js`.
- Every `localStorage` access goes through `js/storage.js`, which wraps it in try/catch and falls back to memory.
- Touch targets are at least 44px. Use `touch-action: manipulation` on controls and `touch-action: none` on the grid.
- Heavy libraries (Tesseract.js, pdf.js, the word list) are loaded lazily from CDNs with exact pinned versions. Every feature that needs one must fail with a clear message and leave the rest of the app working.

## How the pieces fit

- A puzzle is `{ rows, cols, cells[], clues:{across,down}, settings, ... }` (see `js/model.js`). Grids are rectangular: the Sunday Express skeleton is 15 columns by 11 rows. Version 1 files had one square `size` and half-turn symmetry; `fromJSON` still reads them. `cells[i].block` is the player's black square; `givenBlock`, `givenNumber` and `givenLetter` are hints printed in the source and are locked.
- Numbering and slots are always derived from the blocks (`computeNumbering`), never stored. Clues are matched to slots by number and direction (`matchClues`).
- Symmetry is `settings.symmetry`: `mirror4` (reflect top/bottom and left/right, up to three copies of a square; the Sunday Express rule), `rotational` (half turn) or `none`. `symmetryTargets()` in `js/model.js` is the single definition; the solver and the play screen both use it.
- The layout solver (`solveLayout`) searches for black-square patterns that agree with the clue numbers. Letter counts are optional: a clue with `length` 0 only fixes which numbers start an across or down word, and the real Sunday Express puzzle has no counts, so it usually has several valid layouts (about 10). It runs in a Web Worker via `js/solverClient.js` and falls back to the main thread.
- Treat solver output carefully. `result.complete` is true only when every solution was found (neither the node cap nor `maxSolutions` stopped the search). A square is only certain when it is black in *all* solutions of a complete result, so hints and "reveal" must check `complete` first. `play.js` asks for up to 3000 solutions for that reason.
- `js/play.js` owns all play state. Edits go through `commit()` so undo and redo, autosave and re-rendering stay consistent.
- Layout help (check, hint, reveal) is opt-in because it gives hints about the grid pattern. Do not show layout feedback by default.

## Gotchas

- Run `node tools/stamp.mjs` before every push. It raises the version number and records the time in `version.json`, `js/version.js` and the `CACHE` name in `sw.js` (`tests/version.test.js` checks they agree). The home screen shows the version and fetches `version.json` fresh to say whether a newer one is published, with an Update now button that clears the service worker and caches. The new cache name is also what stops installed copies running a mix of old and new modules. Update the `SHELL` list in `sw.js` when you add, rename or remove a file: `cache.addAll` fails the whole install if one listed file is missing.
- Grid size detection (`detectGridDims`) prefers the largest size that scores close to the best, because a 15 grid also has the line positions of a 5 grid, and it tries nearby row counts because a skewed photo distorts the aspect ratio. Grid finding (`detectQuads`) keys on groups of long parallel lines with the same extent, which ignores title bars and form underlines; it returns several candidates because a newspaper page can hold more than one crossword. `.local-test/` (git-ignored) is where to put a real page image for trying the importer; never commit one.
- Import reads the page with Tesseract in `recognizeWords()` (`js/ocr.js`), which returns every word with its box and is cached per canvas. The same read is used three ways: judging orientation (`fixOrientation` in `js/imageImport.js` tries the rotations that fit the grid's shape and keeps the one with the most confidently read words), then locating the clue lists (`locateClues`), then a careful second read of each list. Word boxes can be several lines tall when the reader merges text, so `clueFinder` judges line height by the typical word and ignores oversize boxes.
- The on-screen keyboard is `settings.keyboard`: `auto` (shown after tapping a square, hidden by its Hide button or in Squares mode), `always` or `never`. Keep the clue lists as the default focus.
- There is no answer key, so never claim answers are correct, only that the grid is complete.
- The sample puzzle is invented. Do not add real newspaper puzzles or clues to the repository.

## Deployment

Run `node tools/stamp.mjs`, commit, then push. The site is the repository root, served as-is by GitHub Pages from the `main` branch. There is no build step, so every path must be relative (no leading `/`) so it works under `/<repo-name>/`.
