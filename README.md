# Skeleton Crossword

An iPad-friendly web app for solving Sunday Express style skeleton crosswords. It runs in Safari, can be added to the Home Screen so it opens full screen, and works offline once it has loaded.

The Sunday Express does not publish its Skeleton crossword online, so the app does not fetch puzzles. You give it a photo, screenshot or PDF of the printed page, and it reads the grid and clues from that.

## What it does

- **Import** a photo, screenshot or PDF. Drag four corner handles onto the grid (they start in the right place for clean pages) and the app straightens it, works out the grid size (5 to 25) and spots any printed black squares, clue numbers and letters.
- **Clues** are read from the picture (draw a box round a column of clues), pasted in (on iPad, press and hold the text in your photo and choose Copy), or typed. They are sorted into Across and Down and shown in an editable list so OCR slips are easy to fix.
- **Solves the layout.** Clue numbers and letter counts usually fix the black-square pattern completely. The app uses that for three opt-in tools: *Check my layout* (tells you whether your squares fit, without revealing anything), *Hint* (places one square and its mirror) and *Reveal whole layout*.
- **Play.** Letters mode and Squares mode, symmetric black squares, live clue numbers, pencil entries, undo and redo, an on-screen keyboard (hardware keyboards work too, with Tab for the next clue and Space to switch direction).
- **Crossing off.** A clue is struck through automatically when its word is filled in and its length fits the grid. Tap the circle to cross one off by hand.
- **Word finder.** Pattern search (`C?T??`) and anagrams, honouring multi-word answers like (4,7). Results go into the grid in pencil.
- **Library.** Puzzles autosave on the device. Duplicate, export (JSON) and import to back up or move between devices.
- There is no answer key, so the app can tell you a grid is complete but not that the answers are right.

## Run it

```bash
python -m http.server 8080
```

Open <http://localhost:8080> in a browser. Add `?nosw` to the address to skip the service worker while developing.

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
| `js/imageImport.js`, `js/ocr.js` | Canvas, PDF and Tesseract wrappers |
| `js/importFlow.js` | The new-puzzle wizard |
| `js/play.js`, `js/ui/*` | Play screen, grid, clue lists, keyboard, word finder |
| `js/storage.js` | localStorage with an in-memory fallback |
| `sw.js` | Offline cache |

`samples/sample-15.json` is an invented puzzle (made-up clues, letters that do not form real crossing answers), there to try the features.
