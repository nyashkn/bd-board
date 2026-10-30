# Assessment B — detector + browser evidence (bd-board @ localhost:3111)

Screenshots + raw detector JSON live beside this file (`screenshot-*.jpg`, `detect.json`).
Map: -0 board dark · -1 bead modal (bug) · -2 board light · -3 hierarchy light · -4/-5 knowledge · -6 epic modal · -8 modal in 900px iframe.

## 1. Detector (`impeccable detect --json src/routes src/components`, exit 2)
**1 finding total** (src/routes + src/components only):
- `side-tab` (slop, warning) — `src/components/bead-card.tsx:178`, `border-l-2` on epic cards.
- Verdict: weak / near false positive. It is a 2px marker on epic cards only (`epic && 'rounded-l-[4px] border-l-2 border-l-primary-text'`), carries meaning (epic vs task), and is not the thick-stripe-on-every-card pattern. Fine to keep or swap for the existing EPIC badge; low priority.
- Everything else (colors, fonts, motion, layout rules) came back clean. The detector does not see the real problems below (it is markup-only).

## 2. Browser measurements
Caveat: window resize did not change the viewport (innerWidth stayed 1880x1081). 1440/900 were measured by loading the routes in same-origin iframes of that width; the board/hierarchy iframes did not always hydrate in time, so 1440/900 tap-size counts are partial. Main-viewport numbers (1880) are solid.

| Check | Result |
|---|---|
| Horizontal overflow | None on home, board, hierarchy, knowledge, modal at 1880 / 1440 / 900 (scrollWidth == innerWidth). |
| Modal at 900 | 768px wide, fits, no overflow. At 1880 modal is fixed 1080x930. |
| Tap targets <24px | Board: 14 (theme radios 30x22, Light/Dark/System; group/closed-window radios 28–39 x 24; Collapse sidebar 24x24; home link 89x24). Hierarchy: 42. Knowledge: 181 (every bead-id chip in the comment list is 60–67 x 24; every control is 24px tall, i.e. at the floor, none comfortably above). Modal: none under 24. |
| Text ≤11px | 77 text elements on hierarchy; bead ids/labels/meta are 10–11.5px throughout. |
| Accessible names | No unnamed buttons/inputs/links in DOM scan. read_page shows ~30 board buttons with no name (cards, epic-band chevrons `ref_40…60`): content-derived only, no aria-label. Radix dialog has `aria-labelledby` (auto id), main gets `aria-hidden` while open. |
| i18n slip | Epic band toggle `aria-label="Recolher faixa"` (Portuguese) in an otherwise English UI, x3+ on board. |
| Console | No errors (tracking began after first load; one reload pass clean). |
| Contrast, dark | Only failures: empty-column placeholder "—" 1.86:1 (11px, x30); sidebar count "183" 4.43:1. |
| Contrast, light | "—" 1.6:1 (x30); count "183" 3.89:1; P1 badge 10px 3.96–4.4:1 (x25); "Done · took 38h" 4.32:1 (10px). Knowledge: author "KN" 4.47:1 x352, comment ref 4.47:1 x176 (marginal). |

### Focus / keyboard (15 Tab stops from body)
Order: Skip to content → logo → Collapse sidebar → Home → project → Ready → Blocked → assignee select → Board/Hierarchy/Knowledge tabs → Keyboard shortcuts → **Theme (div)** → System radio → **Group by (div)** → Epics …
- Focus is visible everywhere via ring (box-shadow, outline:none), good.
- **Defect:** `radiogroup` containers (Theme, Group by, Closed window) have `tabindex=0` AND the checked radio has `tabindex=0` → each group costs two Tab stops, and the container stop shows **no ring** (box-shadow none) = focus appears lost for one keypress, three times.
- Page has ~145 tab stops before/through the board; there is a skip link, but only one (no skip past filters to columns).
- After closing the modal (Esc) focus goes to `<body>`, not back to the card that opened it.
- Cards are real `<button>`s (good), reachable by Tab.

## 3. URL / history / reload
- Bead is deep-linkable: `/p/<project>?bead=<id>`; direct load opens the modal (tested ex-1, ex-2).
- Open → Back closes modal; Forward reopens. Works.
- Esc/close **pushes** a new history entry (length 4→5) instead of popping, so Back after closing reopens the bead; history fills with modal open/close pairs.
- Links inside a modal (subtasks, parent epic, dependencies) navigate in place (`?bead=` swaps, one dialog), and Back returns to the previous bead. Good chain navigation.
- **One bead at a time**: single Radix dialog, rest of page aria-hidden/inert, no pin/split/compare/second-tab affordance. Two beads open only via two browser tabs. The comment list on Knowledge shows bead-id chips; they open the same single modal.
- The modal "Edges" counters (0 / 2 / 1) are plain numbers; the lists are lower in the body, not linked from the sidebar.
- Survives reload (all in URL): `tab`, `closed`, `nested`, `q`, `ready`, `view`, `bead`; group/sort/priority filter by same mechanism. Theme in `bd-board:theme`; hierarchy expand state in `bd-board:hierarchy-expanded:<project>` (localStorage).
- **Lost on reload:** board epic-band collapse (aria-expanded flipped back to true; not stored) and scroll position (page/board scroll reset to 0; only tanstack `scroll-restoration` key present in sessionStorage, did not restore).
- Knowledge page: sidebar Ready/Blocked counts render 0/0 during first load then 26/27 (flash of wrong counts); page first paints 4 empty skeleton columns even though the content is a search + list. Empty-state copy "No knowledge recorded yet" appears above a list of 176 comments (comments exist but none carry a knowledge prefix) — reads as contradictory.

## 4. Priorities (from evidence)
1. Radiogroup double tab-stop + invisible container focus (a11y, 3 groups).
2. Muted placeholder "—" and 10px badges below 4.5:1 in light (cheap token fix).
3. Esc pushes history instead of replace/pop; focus not restored to opener.
4. Epic-band collapse + scroll not persisted.
5. Portuguese aria-label.
6. Single-bead modal (design question, not defect).
7. Detector side-tab: ignore.
