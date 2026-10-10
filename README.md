# Skeleton Crossword

An iPad-friendly web app for solving Sunday Express style skeleton crosswords. It runs in Safari, can be added to the Home Screen so it opens full screen, and works offline once it has loaded.

The Sunday Express does not publish its Skeleton crossword online, so the app does not fetch puzzles. You give it a photo, screenshot or PDF of the printed page, and it reads the grid and clues from that.

## What it does

- **Made for the Sunday Express skeleton**: a 15 by 11 grid (any size from 3 to 25 works), black squares that mirror top to bottom and left to right, a few printed black squares and numbers, and clues with no letter counts.
- **Import** a photo, screenshot or PDF of the whole page. Four short steps (Photo, Corners, Grid, Clues), and most of the work is automatic:
  - A sideways page is turned the right way up (there are also Turn left and Turn right buttons).
  - The grid is found on the page (if there is more than one crossword, "Try another grid on the page" cycles through them), straightened, and its columns and rows are counted. Drag the corner handles if the box is off.
  - Printed black squares, clue numbers and letters are detected and read on their own. Black squares show as blue stripes, numbers and letters as labels, and anything unreadable as a dashed ?. Fix mistakes with the Black square, Number, Letter and Clear tools.
  - The Across and Down clue lists are found next to the grid, read, and sorted into an editable list. If that fails, draw a box round the clues (both lists together is fine), or paste or type them.
  - Letter counts in the clues are optional.
- **Solves the layout.** The clue numbers say which numbers start an across word, a down word or both, and the symmetry copies every square to its mirrors. From that alone the app usually narrows the grid to a handful of layouts (8 to 10 for typical puzzles) in a fraction of a second. It places the black squares that every possible layout shares, and tells you which clues could still have more than one length. As you solve answers, tap *Set letter count* on a clue and the choices narrow further, often to one. These tools are opt-in: *Check my layout* (tells you whether your squares fit, without revealing anything), *Hint* (places one certain square and its mirrors) and *Reveal whole layout*.
- **Play.** Letters mode and Squares mode, symmetric black squares (mirror, half-turn or none), live clue numbers, pencil entries, undo and redo. The clues stay in view: the on-screen keyboard only slides up when you tap a square to type (and has a Hide button), or can be set to Always or Never in Settings. Hardware keyboards work too, with Tab for the next clue and Space to switch direction.
- **Crossing off.** A clue is struck through automatically when its word is filled in and its length fits the grid. Tap the circle to cross one off by hand.
- **Word finder.** Pattern search (`C?T??`) and anagrams, honouring multi-word answers like (4,7). Results go into the grid in pencil.
- **Library.** Puzzles autosave on the device. Duplicate, export (JSON) and import to back up or move between devices.
- There is no answer key, so the app can tell you a grid is complete but not that the answers are right.

## Run it

```bash
python tools/serve.py 8080
```

Open <http://localhost:8080> in a browser. This server turns caching off so edits show on reload. Add `?nosw` to the address to skip the service worker while developing.

Tests for the pure logic (numbering, clue parsing, layout solver, grid detection):

```bash
node --test tests/
```

## Put it on an iPad

Plain `http://` addresses on a local network work for trying it out, but offline support needs HTTPS. The simplest permanent setup is GitHub Pages:

1. Push this folder to a GitHub repository.
2. In the repository settings, turn on Pages for the main branch.
3. Open the Pages address in Safari on the iPad, tap **Share**, then **Add to Home Screen**.

The first time you import a picture the app downloads the text reader (Tesseract.js), and the first time you open a PDF or the word finder it downloads those libraries. They are cached afterwards. If a download fails, the rest of the app keeps working: paste or type the clues instead.

## How it is built

No build step and no framework: plain ES modules.

| File | Role |
| --- | --- |
| `js/model.js` | Puzzle data, clue numbering, matching clues to words |
| `js/solver.js` | Finds black-square layouts that fit the clue numbers and lengths |
| `js/clueParser.js` | Turns pasted or OCR text into Across and Down clues |
| `js/gridDetect.js` | Grid finding, perspective straightening, size and hint detection (pure, tested) |
| `js/imageImport.js`, `js/ocr.js` | Canvas, PDF and Tesseract wrappers, page orientation |
| `js/clueFinder.js` | Locates the Across and Down lists from word positions (pure, tested) |
| `js/clueReader.js` | Reads the clue lists found by `clueFinder` |
| `js/importFlow.js` | The new-puzzle wizard |
| `js/play.js`, `js/ui/*` | Play screen, grid, clue lists, keyboard, word finder |
| `js/storage.js` | localStorage with an in-memory fallback |
| `sw.js` | Offline cache |
| `version.json`, `js/version.js` | Version number and release time, shown on the home screen (written by `node tools/stamp.mjs`) |

`samples/sample-skeleton.json` is an invented 15 by 11 puzzle in the Sunday Express format (made-up clues, no letter counts, letters that do not form real crossing answers), there to try the features. `node tools/build-sample.mjs` rebuilds it.
