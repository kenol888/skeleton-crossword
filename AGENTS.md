# Skeleton Crossword

A static, no-build web app (PWA) for solving Sunday Express style skeleton crosswords on an iPad. Plain ES modules, no framework, no bundler, no runtime dependencies. See `README.md` for what it does and `PLAN.md` for the original design.

## Commands

- Serve locally: `python -m http.server 8080`, then open `http://localhost:8080/?nosw`. The `?nosw` flag skips the service worker and clears its cache, which you want while editing (otherwise you see stale files).
- Tests: `node --test tests/` (Node 20, no install step, no dependencies).
- Regenerate icons: `python tools/make-icons.py`.
- Rebuild the sample puzzle: `node tools/build-sample.mjs`.

## Layout and conventions

- Pure logic has no DOM access and is covered by tests: `js/model.js`, `js/solver.js`, `js/clueParser.js`, `js/gridDetect.js`. Keep it that way. Anything that touches `document`, `canvas` or `localStorage` lives elsewhere (`js/imageImport.js`, `js/ocr.js`, `js/storage.js`, `js/play.js`, `js/importFlow.js`, `js/ui/*`).
- Add a test whenever you change pure logic. Tests live in `tests/` and use `node:test`.
- All colours are CSS tokens on `:root` in `css/styles.css`, with a dark theme under `prefers-color-scheme: dark`. Do not hard-code colours in components.
- Never use `alert()`, `confirm()` or `prompt()`. Use `dialog`, `confirmDialog` and `inputDialog` from `js/ui/dom.js`.
- Every `localStorage` access goes through `js/storage.js`, which wraps it in try/catch and falls back to memory.
- Touch targets are at least 44px. Use `touch-action: manipulation` on controls and `touch-action: none` on the grid.
- Heavy libraries (Tesseract.js, pdf.js, the word list) are loaded lazily from CDNs with exact pinned versions. Every feature that needs one must fail with a clear message and leave the rest of the app working.

## How the pieces fit

- A puzzle is `{ size, cells[], clues:{across,down}, settings, ... }` (see `js/model.js`). `cells[i].block` is the player's black square; `givenBlock`, `givenNumber` and `givenLetter` are hints printed in the source and are locked.
- Numbering and slots are always derived from the blocks (`computeNumbering`), never stored. Clues are matched to slots by number and direction (`matchClues`).
- The layout solver (`solveLayout`) searches for black-square patterns that agree with the clue numbers and lengths. It runs in a Web Worker via `js/solverClient.js` and falls back to the main thread.
- `js/play.js` owns all play state. Edits go through `commit()` so undo and redo, autosave and re-rendering stay consistent.
- Layout help (check, hint, reveal) is opt-in because it gives hints about the grid pattern. Do not show layout feedback by default.

## Gotchas

- Bump `CACHE` in `sw.js` and update its `SHELL` list when you add, rename or remove a file, or installed copies will serve stale or missing files. `cache.addAll` fails the whole install if one listed file is missing.
- Grid size detection prefers the largest size that scores close to the best, because a 15 grid also has the line positions of a 5 grid. Check this if you change the scoring.
- There is no answer key, so never claim answers are correct, only that the grid is complete.
- The sample puzzle is invented. Do not add real newspaper puzzles or clues to the repository.

## Deployment

The site is the repository root, served as-is by GitHub Pages from the `main` branch. There is no build step, so every path must be relative (no leading `/`) so it works under `/<repo-name>/`.
