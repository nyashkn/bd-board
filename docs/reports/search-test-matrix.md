# Cmd+K search test matrix

Source of truth: `src/lib/palette-matrix.test.ts` (header + one vitest case per cell id).

```

Cmd+K search correctness matrix (MECE). One test per cell; the cell id leads the test name.
Same matrix, with prose: docs/spec/search-test-matrix.md (this file).

Engine facts the matrix pins down (read from palette-query.ts / palette-search.ts):
 - Free words: lower-cased, AND-ed, order-independent; a hit's score = its WEAKEST word.
 - Per word, best field wins: id (exact 1000 / prefix 850 / part 650), title (prefix 800 / word 640 /
   sub 600 / fuzzy 500), label+assignee (420 prefix / 400), description (310 word / 300), comment 200,
   artifact 180. Comment/artifact-only hits are `late` (own group, after the main rows).
 - Fuzzy (in-order subsequence, span <= 2x length, 3+ chars) applies to the TITLE only.
 - Typo tolerance (behaviour decision, ClickUp-like): letters-only words of 5+ chars tolerate 1 edit, 8+ tolerate 2
   (insert/delete/substitute/adjacent swap) against whole tokens of title, description, labels, assignee. Never ids,
   chip values, comments or artifacts. Scores sit below every real match (title 290, meta 280, description 270).
 - Diacritics and case are folded (behaviour decision, see fold()).
 - Parent-epic title is reachable only through the `epic:` chip, never as a free word.
 - Closed beads sort after open ones, except an exact id. No 7-day window exists in the engine.
 - Scope is always "all projects"; narrowing is the `project:` chip. Read-only is a data-source flag, not engine.

A  FIELD            A1 id exact · A2 id prefix · A3 id substring · A4 title · A5 description · A6 labels
                    A7 assignee · A8 comment · A9 artifact path · A10 parent epic title · A11 none
B  MATCH TYPE       B1 exact · B2 prefix · B3 word-boundary · B4 substring · B5 fuzzy(subsequence, title only)
                    B6 typo: B6a substitution/insertion/deletion · B6b transposition · B6c too short · B6d id never · B6e chip value never ·
                    B6f ranks below real matches · B6g deterministic · B6h accent+typo · B6i highlight = the typo'd token · B7 case fold · B8 diacritic fold · B9 multi-word AND, any order
                    B10 regex-special · B11 unicode/emoji · B12 very long · B13 empty/whitespace
C  CHIPS            C1 status: · C2 type: · C3 label: · C4 epic: · C5 project: · C6 @name · C7 mine · C8 is:ready
                    C9 is:blocked · C10 is:since · C11 combined (AND) · C12 chip without value · C13 unknown key
                    C14 duplicate · C15 chip + free text
D  BEAD STATE       D1 open · D2 in_progress · D3 blocked · D4 deferred · D5 closed (always included, no window)
                    D6 epic · D7 task · D8 molecule · D9 bead with no description/labels/assignee/parent
E  RANK / GROUP     E1 exact id pinned even if closed · E2 title prefix > title word > sub · E3 title > labels
                    E4 labels/assignee > description · E5 description > comment · E6 closed last
                    E7 late group for comment/artifact · E8 stable order on ties · E9 main cap · E10 late cap
                    E11 highlight ranges (multi-word, overlap) · E12 snippet bounds (start/end/middle)
F  CROSS-PROJECT    F1 same text two projects · F2 project: chip · F3 all-scope default · F4 read-only parity · F5 scope pill current vs all · F6 project: chip overrides scope · F7 scope = non-current project · F8 scope cycle order · e2e: pill list, Ctrl+Shift+L, Ctrl+Shift+., Open project
G  INDEX TIMING     G1 before comments · G2 after (late fills, main rows fixed) · G3 failed bead/project
P  PROPERTIES       P1 deterministic · P2 never throws · P3 hit contains terms · P4 chip never adds

```

## Behaviour decisions

- Accents fold both ways (`cafe`↔`Café`).
- Typo tolerance (owner-approved): letters-only words 5+ chars 1 edit, 8+ 2 edits; title/description/labels/assignee; never ids, chips, comments, artifacts; always ranked below real matches; highlight = the whole typo'd token.
- Parent-epic title matches only via `epic:`.
- Closed beads always searchable (no window); last unless exact id.
- Scope pill (owner-approved): default = current project (All on dashboard), Ctrl/Cmd+Shift+. toggles, remembered per session, `project:` chip overrides.

- Project switcher (owner-approved): pill opens a list (All + every project, current marked); arrows/Enter pick, Esc closes only the list, Ctrl/Cmd+Enter also navigates. Ctrl/Cmd+Shift+L opens the list, Ctrl/Cmd+Shift+. cycles current → All → others. Empty state lists `Open project <name>` rows (Enter navigates, Ctrl/Cmd+Enter new tab).
