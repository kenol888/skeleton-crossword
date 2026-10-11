# Skeleton Crossword

An iPad-friendly web app for solving Sunday Express style skeleton crosswords. It runs in Safari, can be added to the Home Screen so it opens full screen, and works offline once it has loaded.

The Sunday Express does not publish its Skeleton crossword online, so the app does not fetch puzzles. You give it a photo, screenshot or PDF of the printed page, and it reads the grid and clues from that.

## What it does

- **Made for the Sunday Express skeleton**: a 15 by 11 grid (any size from 3 to 25 works), black squares that mirror top to bottom and left to right, a few printed black squares and numbers, and clues with no letter counts.
- **Import** a photo, screenshot or PDF of the whole page. Four short steps (Photo, Corners, Grid, Clues), and most of the work is automatic:
  - A sideways page is turned the right way up (there are also Turn left and Turn right buttons).
  - The grid is found on the page (if there is more than one crossword, "Try another grid on the page" cycles through them), straightened, and its columns and rows are counted. Drag the corner handles if the box is off.
  - Printed black squares, clue numbers and letters are detected and read on their own. The marks are see-through (blue stripes for black squares, a frame and a corner badge for numbers and letters, a dashed ? for anything unreadable) so the printed picture shows underneath, and Compare with picture hides them completely. Fix mistakes with the Black square, Number, Letter and Clear tools.
  - The Across and Down clue lists are found next to the grid, read, and sorted into an editable list. If that fails, draw a box round the clues (both lists together is fine), or paste or type them.
  - Letter counts in the clues are optional.
- **Play.** Tap a square, then choose what goes in it: **Letter**, **Number** or **Black square**. Letters and clue numbers are typed on an on-screen keyboard that only appears when you tap a square (a number pad for numbers; both have a Hide button, and Settings can set it to always or never). Only the numbers printed in the puzzle are filled in for you: you place the rest yourself, either by choosing Number on a square and typing it, or by tapping a clue and then the square where it starts. A clue links to its word, highlights it and crosses off automatically once you have numbered its square. Black squares can mirror automatically (mirror, half-turn or none) or, with Mirror black squares for me turned off in Settings, you place every mirror square yourself (the mirror squares are ringed in blue to help). Pencil, undo and redo are in the top bar, with Settings (including Light and Dark appearance, Light by default) and Tools beside them.
- **Crossing off.** A clue is struck through automatically when its word is filled in and its length fits the grid. Tap the circle to cross one off by hand.
- **Word finder.** Pattern search (`C?T??`) and anagrams, honouring multi-word answers like (4,7). Results go into the grid in pencil.
- **Home screen.** One big Import from image button, over a skull drawn as a crossword grid, and a shelf of your puzzles. Each puzzle card shows a live mini picture of its grid and your progress; the ... menu renames, duplicates or deletes it. Puzzles autosave on the device. The home screen also shows the app version and release time, with a Check for updates button and an Update now button when a newer version is published.
- There is no answer key, so the app can tell you a grid is complete but not that the answers are right.

## Run it

```bash
python tools/serve.py 8080
```

Open <http://localhost:8080> in a browser. This server turns caching off so edits show on reload. Add `?nosw` to the address to skip the service worker while developing.

Tests for the pure logic (numbering, clue parsing, layout solver, grid detection):

```bash
node --test
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
| `js/solver.js` | Finds black-square layouts that fit the clue numbers (not used by the app now; kept, tested, and used by `tools/build-sample.mjs`) |
| `js/clueParser.js` | Turns pasted or OCR text into Across and Down clues |
| `js/gridDetect.js` | Grid finding, perspective straightening, size and hint detection (pure, tested) |
| `js/imageImport.js`, `js/ocr.js` | Canvas, PDF and Tesseract wrappers, page orientation |
| `js/clueFinder.js` | Locates the Across and Down lists from word positions (pure, tested) |
| `js/clueReader.js` | Reads the clue lists found by `clueFinder` |
| `js/importFlow.js` | The new-puzzle wizard |
| `js/play.js`, `js/ui/*` | Play screen, grid, clue lists, keyboard (letters and number pad), icons, word finder |
| `js/theme.js` | Light and dark appearance (light by default, chosen in Settings) |
| `js/storage.js` | localStorage with an in-memory fallback |
| `js/homeArt.js` | The skull artwork and puzzle thumbnails for the home screen (SVG) |
| `sw.js` | Offline cache, filled from the file list in `version.json` |
| `version.json`, `js/version.js` | Version number, release time and the list of app files (written by `node tools/stamp.mjs`) |

`samples/sample-skeleton.json` is an invented 15 by 11 puzzle in the Sunday Express format (made-up clues, no letter counts, letters that do not form real crossing answers), there to try the features. `node tools/build-sample.mjs` rebuilds it.

## Standard crosswords

Besides Sunday Express skeletons, the importer reads ordinary numbered crosswords (for example a 15×15 with clues and letter counts). Choose **Standard crossword** on the first import step. The grid, black squares and numbers are read from the picture (numbers are derived from the black squares), clues are read from the columns below or beside the grid, and play uses the same screen with Number and Black disabled. Tightly spaced words in clues can occasionally be joined by the text reader; fix them in the editable clue list.

## Dictionary and thesaurus look-up

Select a word in a clue and tap the **Define** chip, or use Tools → **Look up a word** (it uses the selected word, else the current answer once it is filled, else asks). Definitions come from Wiktionary (dictionaryapi.dev as a back-up) and synonyms from Datamuse (tap one to look it up). Both need a connection; only the word is sent.
