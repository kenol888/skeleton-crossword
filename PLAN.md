# Skeleton Crossword for iPad — Implementation Plan

## 1. Findings from investigation

- **The puzzle.** A skeleton crossword is printed as a blank square grid (usually 15×15, sometimes 13×13) with **no black squares and no numbers** shown, apart from a few hints: some black squares, some clue numbers and occasionally a few letters may be printed. The black squares are rotationally symmetric (the grid looks the same turned upside down). Clues are listed as numbered Across and Down entries with word lengths, e.g. `7 Large wading bird (5)` or `12 Friendly (4-7)`. The solver has to work out where the black squares go as well as the answers.
- **Fetching it online is not viable.** `express.co.uk/puzzles` redirects to `games.express.co.uk`, which offers Quick, Crusader, Arrow, Cryptic and Classic crosswords but **no Skeleton**. The Skeleton only appears in the printed paper and the e-edition, so there is nothing to scrape. Scraping a paywalled e-edition would also be fragile and raise copyright issues.
- **Decision:** the user brings the puzzle in as a **photo, screenshot or PDF**. The app reads the grid size and any printed hints from the image, gets the clue text by OCR or paste, and then provides the play interface.
- **iPad tip that makes this much easier:** iPadOS Live Text lets the user select and copy clue text straight from a photo. A "paste clues" box is therefore as reliable as OCR, and the app should offer both.
- **Platform decision:** build a **Progressive Web App** (plain HTML/CSS/JS with no build step). The developer machine is Windows, so a native Swift app can't be built or tested here. A PWA runs in iPad Safari, can be added to the Home Screen and run full screen, works offline after the first load, and can be tested in a desktop browser.
- **CDN libraries (all URLs checked, HTTP 200):**
  - OCR: `https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js` (global `Tesseract`)
  - PDF: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js` with worker `.../pdf.worker.min.js` (global `pdfjsLib`)
  - Word list for the word finder: `https://cdn.jsdelivr.net/npm/an-array-of-english-words@2.0.0/index.json` (JSON array, about 3 MB)
  - Load all three **lazily**, only when the feature is first used, and make every feature that depends on them fail gracefully with a clear message.

## 2. Project layout

```
skeleton-crossword/
  index.html              app shell: all screens as <section>s, toggled with el.hidden
  css/styles.css
  js/main.js              boot, screen routing, wires the modules together
  js/model.js             puzzle data structure, numbering, slots, (de)serialise
  js/solver.js            black-square layout solver (pure, no DOM)
  js/clueParser.js        text → {across:[], down:[]} (pure, no DOM)
  js/imageImport.js       file → canvas, PDF rendering, crop, grid detection
  js/ocr.js               lazy Tesseract wrapper
  js/storage.js           localStorage persistence (wrap every call in try/catch)
  js/ui/grid.js           grid rendering + touch/keyboard input
  js/ui/clues.js          clue lists
  js/ui/keyboard.js       on-screen keyboard
  js/ui/wordFinder.js     pattern search panel
  manifest.webmanifest
  sw.js                   cache-first service worker for the app shell
  icons/icon-192.png, icon-512.png, apple-touch-icon.png (180)
  samples/sample-15.json  invented sample puzzle (see §9)
  tests/                  node tests for the pure modules (node:test, no deps)
  README.md               how to run, host and install on iPad
```

Use ES modules (`<script type="module">`). No frameworks. Add `<meta name="apple-mobile-web-app-capable" content="yes">`, `apple-mobile-web-app-status-bar-style`, an `apple-touch-icon` link and `viewport-fit=cover`, and respect the `env(safe-area-inset-*)` insets.

## 3. Data model (`model.js`)

```js
Puzzle = {
  id, title, createdAt, updatedAt,
  size: 15,                          // N; grid is N×N
  cells: [ {                          // length N*N, row-major
    block: false,                     // user's (or given) black square
    givenBlock: false,                // printed in source → locked
    givenNumber: null,                // printed clue number hint → locked
    givenLetter: null,                // printed letter → locked
    letter: '',                       // user's entry
    pencil: false,                    // entry is tentative
  } ],
  clues: { across: [Clue], down: [Clue] },
  // Clue = { number, text, enumeration: "4-7", length: 11, manualDone: false }
  sourceImage: dataURL|null,          // downscaled to ≤1600px long side, JPEG 0.8
  settings: { symmetry: 'rotational' | 'none' },
  elapsedMs: 0,
}
```

Functions:
- `computeNumbering(puzzle)` → `{ numbers: Int[N*N] (0 = none), slots: [{number, dir:'across'|'down', cells:[idx], length}] }`. Standard rule: a white cell gets the next number if it starts an across run (left is a block or the edge, and the cell to the right is white) or a down run (same test using the cells above and below). Runs of length 1 are not slots.
- `matchClues(puzzle, numbering)` → for each clue: `{ slot|null, status: 'ok' | 'length-mismatch' | 'missing' }`, plus `orphanSlots` (slots with no matching clue). This drives the skeleton-specific feedback.
- `mirror(idx)` = `N*N - 1 - idx`.
- `toJSON` / `fromJSON` with a `version: 1` field.

## 4. Layout solver (`solver.js`) — the key skeleton feature

Given N, the clue list (number → across length and/or down length), the given blocks, given numbers and given letters, plus symmetry, find the black-square layouts that are consistent with everything. In practice the numbering and lengths usually pin the layout down to one solution.

Algorithm: depth-first search over cells in reading order, using a tri-state grid (`U` unknown, `W` white, `B` block) and a trail stack so assignments can be undone.

```
state: g[N*N] in {U,W,B}; n = next expected clue number (starts at 1)
A[n] = across length or null; D[n] = down length or null; K = max clue number
givens: givenBlock → B, givenLetter → W, givenNumber m → W and "must be numbered m"

set(i, v): if g[i]==v ok; if g[i]!=U fail; g[i]=v; also set(mirror(i), v) when symmetric

visit(i):
  if i == N*N: success iff n == K+1  (record the solution; stop after 2 to report uniqueness)
  if g[i]==U: try W then B (or B first if the next expected number's start can't be here — optional heuristic)
  if g[i]==B: visit(i+1)
  if g[i]==W:
     leftB  = c==0  || g[i-1]==B          (always decided: it was visited earlier)
     aboveB = r==0  || g[i-N]==B          (always decided)
     acrossOpts: !leftB → [false]; else right cell W → [true]; B/edge → [false]; U → [true,false]
     downOpts:   same using aboveB and the cell below
     for each (a,d) combination:
        if a||d:
           if n > K fail; if givenNumber here and != n fail
           if a != (A[n]!=null) fail; if d != (D[n]!=null) fail
           if a: set cells c..c+A[n]-1 W; set c+A[n] to B unless it's the edge (fail if out of bounds)
           if d: same downward with D[n]
           n++
        else:
           if givenNumber here fail
           if leftB and right exists: set right to B   (horizontal run of 1)
           if aboveB and below exists: set below to B  (vertical run of 1)
        visit(i+1); undo the trail; restore n
```

- Return `{ solutions: [blockMask], unique: bool, nodes }`. Use a node cap (for example 2,000,000) and report "too ambiguous" if it is hit. Run the solver in a **Web Worker created from a `blob:` URL or `new Worker('js/solverWorker.js', {type:'module'})`** so the UI never freezes.
- Make it available through:
  1. **Check my layout** (no spoilers): compares the user's blocks with the clue list via `matchClues` and lists any problems ("14 Across should be 6 letters but the grid gives 4", "Slot 9 Down has no clue", "Clue 22 has no slot"). It also says whether the user's blocks are consistent with at least one full solution, without revealing it.
  2. **Reveal one block** (hint): picks a cell where the unique solution's block differs from the user's grid and fixes it, preferring a cell close to the selected one.
  3. **Reveal layout** (spoiler): asks for confirmation using an in-page dialog (never `confirm()`), then applies the whole solution.
- If there are several solutions, say so and leave the cells they agree on as the hint pool.

## 5. Clue parser (`clueParser.js`)

Input is free text from OCR or a paste. It must cope with:
- Headings `ACROSS` / `DOWN` (any case; may be on the same line as the first clue).
- Lines `12 Clue text (5)`, `12. Clue text (5)`, enumerations `(5)`, `(3,4)`, `(4-7)`, `(2,3,4)`, and clue text that wraps over several lines (join a line to the previous clue when it doesn't start with a number).
- Two columns that OCR has merged into one line: when a line contains two `\d+ … \(\d[\d,\-\s]*\)` patterns, split it.
- Common OCR confusions in numbers and enumerations: `l`/`I`→`1`, `O`→`0`, `S`→`5` inside parentheses, and a missing closing `)`.
- Output `{across, down, warnings}`. `length` = the sum of the digits groups in the enumeration. Sort each list by number and flag gaps or duplicates as warnings.

The import screen shows the parsed result as an **editable table** (number, text, enumeration; add and delete rows), so the user can fix OCR mistakes before playing.

## 6. Image import (`imageImport.js`, `ocr.js`)

Flow on the **New puzzle** screen, as steps on one page:

1. **Source.** `<input type="file" accept="image/*,application/pdf">`. On iPad this offers Photo Library, Take Photo and Files. For a PDF, render page 1 (with a page picker if there are several pages) at scale 2 to a canvas using pdf.js. Downscale everything to at most 2400px on the long side for processing.
2. **Crop the grid.** Show the image with a draggable four-corner quad, pre-filled from auto-detection. Use a perspective warp (compute a homography from the four points and sample with bilinear interpolation into a square canvas of 60px per cell). Photos of newspapers are rarely square-on, so the warp matters.
   - Auto-detection: convert to greyscale, threshold with Otsu's method, find the largest roughly square connected dark-line component (or use row and column dark-pixel projections), and take its bounding corners.
3. **Grid size.** Detect it by projecting dark pixels of the warped grid onto the x and y axes and counting evenly spaced peaks (the grid lines). Pick N from 9–21 whose spacing fits best. Show a stepper so the user can override it (default 15).
4. **Hints.** For each cell, sample the inner 60% of the cell. If more than 70% is dark it's a `givenBlock`. If there is significant ink but it isn't solid, it's a "has mark" cell: offer an OCR pass with Tesseract (`tessedit_char_whitelist` set to A–Z and 0–9, PSM 10 for a single character). Digits become `givenNumber` (small numbers sit top-left, so sample that quadrant separately) and letters become `givenLetter`. Show the detected hints overlaid on the warped grid. The user taps cells to cycle *none → block → number → letter* to correct them.
5. **Clues.** Three options, side by side:
   - **Read from photo**: the user drags a box (or boxes, for multiple columns) over the clue area, then runs Tesseract `eng` on each box, concatenates the text and sends it to the parser.
   - **Paste text**: a textarea, with a hint: *"On iPad, press and hold on the clue text in your photo to select and copy it."*
   - **Type** directly into the editable table.
6. **Title and Start.** Default title: `Skeleton — <date>`. Save and open the play screen.

Also add **Blank puzzle**: pick a size and type the clues. This keeps the app usable even if the image steps fail.

Run Tesseract in its worker and show a progress bar from its `logger` callback. If the CDN fails, show "Couldn't load the text reader. Check your connection, or paste the clues instead."

## 7. Play screen

Layout for iPad. In landscape: the grid on the left (it fills the height), with the Across and Down clue lists stacked in a scrollable column on the right. In portrait: the grid on top and the clue lists side by side underneath. A slim **current clue bar** sits above the grid (number, direction, text, enumeration, and the pattern so far, like `C_T__`). A toolbar holds the controls.

**Grid**
- Render it as CSS-grid `<div>` cells, or as a canvas if performance needs it (a 225-cell DOM is fine). Cells must be at least 44px where space allows.
- Two input modes, switched by a segmented control in the toolbar and by the **`.`** or **`#`** key:
  - **Letters**: tap a cell to select it, tap it again to switch direction. The selected word is highlighted along its slot.
  - **Blocks**: tapping toggles a black square, plus its mirror cell when symmetry is on. Given cells are locked (show a small lock style).
- Dragging in Blocks mode paints blocks, which helps with fast layout work.
- Numbers update live as blocks change.
- Visual states: selected cell, active word, pencil letters (grey italic), given letters (bold, a different ink colour), cells whose across/down slot has a length mismatch (subtle red underline or edge), the mirror of the hovered/selected cell (faint ring) to help with symmetry reasoning.
- An optional "shade likely blocks" aid can wait for later; it isn't needed for v1.

**Input**
- A custom **on-screen keyboard** (A–Z in QWERTY rows, ⌫, Pencil toggle, direction toggle, Block toggle). It avoids the iPad system keyboard covering half the screen. A hidden `<input>` captures hardware keyboard input from an iPad Magic Keyboard too: letters, Backspace, arrows, Tab/Shift+Tab for the next/previous clue, Space to switch direction.
- Typing moves forward within the slot and skips filled cells as an option in settings. Backspace on an empty cell moves back. At the end of a slot it jumps to the next clue.

**Clue lists**
- Each clue row shows its number, text and enumeration, plus a status chip:
  - **Placed** (a slot exists and its length matches) / **Length mismatch** / **No slot yet**. This status only applies while layout feedback is turned on. Default it to off (a "layout feedback" toggle in settings) so it doesn't give the layout away. Hints of this kind always stay opt-in.
- **Automatic crossing off:** when every cell of a clue's matched slot contains a letter (pencil letters don't count), the clue is struck through and dimmed, and it moves to the end of the list if "move solved clues down" is on. Tapping the clue's check circle crosses it off by hand (`manualDone`), for example while still working out blocks.
- Tapping a clue selects its slot. If it has no slot yet, show a toast: "Place the black squares for 12 Across first."
- A counter for each list, e.g. `Across 9/14`.

**Toolbar and menu**
- Undo/Redo: a command stack covering letters and blocks, at least 200 steps.
- Pencil mode.
- Check layout · Reveal one block · Reveal layout (see §4).
- Clear: in-page confirm, with options for letters only, blocks only, or everything apart from the givens.
- Show original: a slide-over panel showing `sourceImage` with pinch-to-zoom, so the user can check the printed clues.
- Word finder (§8).
- Timer: pauses when the tab is hidden; can be shown or hidden.
- Settings: symmetry on/off, layout feedback on/off, skip filled cells, move solved clues down, dark mode follows the system.
- Celebrate (a light confetti or a "Grid complete" banner) when every slot is filled and the layout matches every clue. There is no answer key, so don't claim the answers are correct.

**Persistence**
- Autosave to localStorage, debounced by 500ms, under `skeleton:puzzle:<id>`, plus an index `skeleton:index`. Wrap everything in try/catch. Show a warning if the quota is exceeded (the source image is the large item, so offer to drop it).
- **Library** home screen: cards for saved puzzles with the title, date, progress % (filled cells over white cells), and Resume / Duplicate / Delete (in-page confirm). Add **Export / Import puzzle JSON** for backup, using a share/download through a Blob URL. This works in Safari.

## 8. Word finder (`wordFinder.js`)

- A panel that opens pre-filled with the current slot's pattern, with unknowns as `?` (e.g. `C?T??`). It honours the enumeration: for `(3,4)` it searches two-word answers by splitting the pattern and listing matches for each part.
- Lazy-load the word list JSON once, cache it in memory (the service worker caches it after that), and index it by length. Match with a regex built from the pattern. Show up to 200 results, plus an anagram mode (letters → words of that length that use exactly those letters).
- Tapping a result fills the slot with pencil letters (it can be undone).

## 9. Visual design

- Subject: a Sunday newspaper puzzle page. The design should feel like newsprint and a pencil, but **not** the generic warm-cream-and-serif look. Suggested direction: a cool off-white, slightly blue-grey "newsprint" ground; ink-black grid lines; a single accent of **pencil-graphite blue** for selection and the active word; a muted ochre highlight for the active cell. Use a characterful serif for clue numbers and headings (Google Fonts, e.g. "Newsreader" or "Source Serif 4"), a clean sans for clue text and the UI (e.g. "IBM Plex Sans"), and a sturdy monospace or condensed face for grid letters (e.g. "IBM Plex Mono" bold). Every font gets a system fallback stack.
- Define every colour as a CSS token on `:root`, with a dark theme under `@media (prefers-color-scheme: dark)` (dark slate ground, light grid lines; blocks stay the darkest tone with a light outline so they read clearly).
- Touch targets at least 44px, `touch-action: manipulation` to stop double-tap zoom, `user-select: none` on the grid, and `-webkit-tap-highlight-color: transparent`.
- Respect `prefers-reduced-motion`.

## 10. Sample puzzle and tests

- Write `samples/sample-15.json`: an **invented** 15×15 puzzle with a valid rotationally symmetric layout, simple made-up clues, and a few givens (two blocks, three numbers, two letters). Build it by drawing a symmetric layout, computing its numbering with `computeNumbering`, and writing clues for those slots. Do not copy any real Express puzzle. The Library offers "Try a sample puzzle", so the app opens in a working state.
- `tests/` (run with `node --test tests/`):
  - `numbering.test.js`: numbering and slots for a small known grid.
  - `solver.test.js`: take the sample layout, strip the blocks and keep the clue lengths and givens, and assert that the solver recovers the original layout uniquely within the node cap and in under a second or so. Also: an inconsistent clue list returns 0 solutions, and the "no symmetry" setting still works on a 5×5 example.
  - `clueParser.test.js`: headings, wrapped lines, merged columns, `(4-7)`, `(3,4)`, OCR noise (`(l0)` → 10).
- Keep the pure modules free of DOM references so node can import them.

## 11. Running and installing on iPad (put this in README.md)

1. Local test: `python -m http.server 8080` in `skeleton-crossword/`, then open `http://localhost:8080`.
2. On the iPad on the same Wi-Fi: open `http://<PC-LAN-IP>:8080` in Safari. The service worker won't register over plain http on a LAN IP; everything else works.
3. Recommended for permanent use: push the folder to a GitHub repo and enable **GitHub Pages**, which gives HTTPS so offline mode works. Then in Safari tap **Share → Add to Home Screen** to get a full-screen app icon.

## 12. Build order (execute in this order and verify each step)

1. Scaffold the files, manifest, icons (generate simple PNG icons with a small node/python script: a 3×3 skeleton grid motif) and the empty screens.
2. `model.js` + numbering tests.
3. `clueParser.js` + tests.
4. `solver.js` + worker + tests (with the sample puzzle).
5. Play screen: grid render, selection, letter input, blocks mode with symmetry, live numbering, on-screen keyboard, hardware keys.
6. Clue lists: matching, auto-crossing off, manual crossing off, tap to select, the current clue bar.
7. Undo/redo, persistence, Library screen, sample puzzle, export/import.
8. Layout tools: check, reveal one block, reveal all.
9. Import flow: file/PDF → crop quad + warp → size detection → hint detection → clues (OCR / paste / type) → save.
10. Word finder, timer, settings, show original, celebration.
11. Service worker (cache the app shell; cache CDN responses at runtime).
12. Verify in the browser at iPad sizes (820×1180 portrait, 1180×820 landscape, and 1366×1024): play the sample puzzle end to end, try blocks mode and symmetry, check auto-crossing off, undo, reload persistence, and the import flow with a test image. To make the test image, render the sample grid with its givens and clues onto a canvas, save it as a PNG, and import it. Run `node --test tests/`.
13. Write README.md.

## 13. Non-goals for v1

- Checking answers (there is no answer key).
- Fetching puzzles automatically (not available online; see §1).
- Accounts and cloud sync.
