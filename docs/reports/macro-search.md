# How Macro does search, and what bd-board should take from it

Researched 2026-10-30. Read-only. Source: `macro-inc/macro` at commit `fb7ca4b7` (2026-10-29), shallow clone in `/tmp/macro-search-ro`. I only read files. I ran, built and installed nothing. All paths below are relative to that repo unless they start with `bd-board:`. `bd-board:` paths point to branch `fork/feat/search-tests`.

## TL;DR

- Macro has two separate search systems:
  - **Cmd+K (name search):** runs on the client and works offline. A small hand-written scorer runs over a cached list of names. It does not use an inverted index.
  - **Full-text search:** runs on a server (Rust + OpenSearch).
- The Rust in the client exists because Macro's whole GraphQL cache is a Rust engine (WASM in a worker for the browser, native for Tauri). Search adds about 500 lines on top of it. Rust was not chosen for search.
- Their matching is weaker than bd-board's:
  - no typo tolerance;
  - no accent folding on the client;
  - full-text results are sorted by `updated_at`, not by relevance.
- What they do better is **UX**:
  - recency blended into ranking;
  - Tab cycles result categories;
  - commands in the menu, ranked by when you last used them;
  - fallback rows when nothing matches;
  - opening a hit at the exact place it matched.
- Verdict: **keep bd-board's hand-written engine**. Demote the MiniSearch spike to "only if p95 > 16 ms". If you ever want a library, use uFuzzy, which Macro ships.

## 1. Architecture (end to end)

```
 Cmd+K pressed
   apps/web/src/components/app/GlobalHotkeys.tsx:310-320   registerHotkey 'cmd+k' -> CommandState.toggle()
        │
        ▼
 CommandState (singleton signals)                          apps/web/src/features/command/state.ts:78-243
   query, selectedIndex, categoryFilter, commandScope, hint
   onMenuOpen clears query + selection (193-196); onMenuClose clears query/scope (183-191)
        │
        ▼
 CommandMenu / CommandSearchMenu                           apps/web/src/features/command/CommandMenu.tsx
   category tabs All·Commands·Agents·Files·Tasks·Projects·Channels·People   71-120
   query = debouncedDependent(query, 60 ms)                 430   (util: lib/core/util/debounce.ts:18-24)
   keys: ↓/Ctrl+J 608, ↑/Ctrl+K 629, Enter 642, Esc 657 (backs out of a sub-scope first),
         Backspace-on-empty = back 678, Tab / Shift+Tab = next/prev category 702/718
   ≥3 words or ≥24 chars -> promote to AI "universal input" composer   core/universal-input-mode.ts:1-13, CommandMenu.tsx:217-255
        │
        ▼
 useCommandItems(query, category)                           apps/web/src/features/command/useCommandItems.ts:356-469
   commands  = active hotkey commands; searchText = tags+keywords+description; recency from
               localStorage 'command-recency-v1'            159-205, recency.ts:4-21
   entities  = useEntitySearch(...)                         queries/entity-search.ts:42-170
               category -> Quick Access buckets             18-30
               people + projects join "All" only when typed 66-73
   'All' = merge(entities, commands) by recency             396-403
   query ≤3 chars in All: top 3 matching commands first     426-447
   + "Search for <q>" row (opens full-text view); if 0 hits also "Ask AI" row   441-458
        │                                  │
        │ cache search (local)             │ "Search for <q>" (server, full text)
        ▼                                  ▼
 createProjectedList                       useSearchSoupQuery              lib/queries/soup/search.ts
  lib/core/context/quickAccess/            ≥3 chars or no request 35-38; AbortSignal 59;
  projected-list.ts:50-255                 keepPreviousData 85; cursor pages 63-73
  request fencing: `current !== request`   facets compiled once: next-soup/core/search-query.ts:57-127
   146,154; cache revision != new search   Cmd+K category -> facet seed: command/category-search-filters.ts:17-39
   196-210; keep old matches while              │
   pending 223-227; limit 500 / browse 50       ▼
   34-35,139                               search_service (Rust/axum)
        │                                    split terms, keep "quoted phrases"  crates/search_service/src/api/search/terms.rs:14-38
        ▼                                    drop punctuation-only terms        terms.rs:40-58
 CacheHost.search(...)                       ≤50 terms, ≤80 chars/term           simple/simple_unified.rs:138-159
   browser: Worker -> WASM                       │
     lib/graphql-cache/host/worker-host.ts:1401  ▼
     crates/client/cache-wasm/src/shell.rs:1443 opensearch_client: one bool.should per index (docs, email,
   desktop: Tauri command                        channels, chats, calls, projects, calendar)
     host/tauri-host.ts:358-362                  crates/opensearch_client/src/search/unified.rs:731-830
     apps/web/tauri/src-tauri/src/lib.rs:392     per term: match_phrase_prefix (≥3 chars) else match_phrase;
     graphql_cache_plugin/src/engine.rs:600      quoted -> phrase   search/documents.rs:25-41,347-363
        │                                        name matches all terms OR content chunks match all terms 200-210
        ▼                                        sort = updated_at desc, entity_id asc (NOT score)
 cache-core Engine::search  (same Rust both hosts)   unified.rs:850, search/builder.rs:61-76
   crates/client/cache-core/src/engine.rs:1192-1271  collapse by entity_id 847; page_size+1 cursor 844
   empty query -> indexed recency browse per bucket  highlight <macro_em>, content 1 fragment, names whole 855-875
   typed query -> lazily load bucket catalog, then   index analyzer: standard + icu_folding (content only)
   LINEAR SCAN of every doc, no inverted index         infra/stacks/opensearch/helpers/scripts/create_indices.ts:388-397
        │                                        name-only search: Postgres ILIKE + Rust highlight
        ▼                                          crates/name_search/src/chat.rs:56, highlight.rs:21-55
 search.rs scoring                                      ▲
   doc = {bucket, search_text (lowercased names),       │ indexed by
          timestamp_ms viewed-first, source_hash}      services/search_processing_service (Kafka + SQS
   75-88, 192-244, 315-361                              consumers, backfill jobs; README.md:1-60)
   per token: substring 1.0 at word start, 0.9 inside,
   else ordered subsequence n/span clamped 0.1-0.8   431-456
   score = 0.7*avg(token) + 0.3*exp(-0.5*age/30d), DM x1.8   405-429
   bounded top-K heap (limit+1 refs)                 search/ranking.rs:38-81
   incremental: catalog.update on each record write  search/catalog.rs:46-63
        │
        ▼
 back in JS: rankCommandSearchItems                 features/command/rank-command-search-items.ts:53-101
   createFreshSearch (uFuzzy) over item.searchText   lib/core/util/freshSort.ts:325-419
   1) nameMatchRank: exact label 2 > label prefix 1 > rest 0     146-152, 308-311
   2) combined = fuzzyWeight 0.7 + timeWeight 0.7, normalized = 50/50; gap penalty 0.4,
      start decay 0.2, channel x3, DM x1.8, fuzzy<0.1 -> x0.1    182-232, 289-296, rank-command-search-items.ts:63-78
   3) tie: recency, then id                          rank-command-search-items.ts:23-27, 80-87
   server/cache hits the fuzzy matcher misses are appended, not dropped   88-100
   people regrouped: internal before CRM contacts    38-50
        │
        ▼
 CommandResults: flat virtualized list, load-more near end, scroll selected into view
   features/command/views/command-results.tsx:26-127  (no section headers, no match highlight in Cmd+K rows)
 Select: open in place; openInNewSplit variant       CommandMenu.tsx:525-603
 Full-text hit: open AT the match (message / md node / pdf page + highlight terms, fresh seek id per click)
   features/next-soup/search-navigation.ts:33-126
```

## 2. Ranking and matching, side by side

| Aspect | Macro Cmd+K (client) | Macro full text (server) | bd-board palette (`bd-board:src/lib/palette-search.ts`) |
|---|---|---|---|
| Candidate set | Lazily loaded per-bucket catalog in memory, **linear scan** (`cache-core/src/engine.rs:1237-1271`) | OpenSearch inverted index | All docs in memory, linear scan with chip pre-filter (`searchDocs`, 544-606) |
| What is searched | Names only: title, name, email, domains, sender. Bodies are never indexed (`search.rs:203-217`, test `email_projection_..._never_bodies`) | Content chunks (parent/child join) plus names | id, title, labels, assignee, description, comments, artifacts |
| Multi-word | Every token must match. Score is the **average** of the token scores (`search.rs:411-415`) | Every term must match (bool.must per term, `documents.rs:200-217`) | Every word must match. Score is the **weakest** word |
| Match kinds | Substring at word start 1.0, inside a word 0.9, subsequence n/span 0.1-0.8 (`search.rs:431-456`). Then uFuzzy (`freshSort.ts:182-232`) | `match_phrase_prefix` (≥3 chars), `match_phrase`, regexp, quoted phrase | id exact/prefix/part, title prefix/word/sub/fuzzy, meta, description, comment, artifact (`WEIGHT` 31-49) |
| Field weights | None. Rows are typed by bucket and get bucket boosts (channel ×3, DM ×1.8) | None (`bool.should` per index) | Explicit per-field tiers, 1000 → 180 |
| Exact name first | `nameMatchRank` 2/1/0 on the visible label, before everything else (`freshSort.ts:146-152`) | No | `idExact` pinned even when closed; `titlePrefix` 800 |
| Recency | **Blended into the score**: 30% of the Rust cache score, 50% of the JS re-rank (weights 0.7/0.7, `rank-command-search-items.ts:69-70`), exponential decay over 30 days, viewed-first timestamp (`search.rs:315-347, 416-423`; `freshSort.ts:111-128`) | **Primary sort** (`builder.rs:61-76`) | Tiebreak only: `updatedMs` after score (`compareHits` 533-542). Closed beads last |
| Typos | **None.** uFuzzy runs with defaults (`fuzzy.ts:9`), and no `fuzziness` appears anywhere in the repo | None | Edit-distance budget: 5+ letters 1 edit, 8+ letters 2. Only on title, description, labels and assignee, and always ranked below real matches |
| Case and accents | Lowercase only on the client (`search.rs:307-313`) | `icu_folding` on content (`create_indices.ts:392-397`) | `fold()`: lowercase + strip accents, length-preserving |
| Quoted phrase | No | Yes (`terms.rs:14-38`) | No |
| Punctuation-only word | n/a | Dropped (`terms.rs:40-58`, bug "OOO - therapy") | Kept: `-` must appear in some field, otherwise the bead drops out |
| Highlights | uFuzzy ranges → `<macro_em>` (`fuzzy.ts:11-12, 127-129`). Cmd+K rows show none | OpenSearch plain highlighter, 1 content fragment, names whole (`unified.rs:855-875`). Windowed client-side (`searchHighlight.tsx:219`) | Own ranges + `makeSnippet` with word-boundary cut, ranges merged |
| Grouping | Flat list. Category tabs narrow buckets. People regrouped internal-first | Typed rows | "Beads" plus a separate "In comments and artifacts" late group, so main rows never move |
| Determinism | `now_ms` passed in the request (`search.rs:106-107`). Ties broken by timestamp, then key (`search.rs:391-396`). Test `scores equal timestamps equally when time advances` (`freshSort.test.ts:36`) | Ties broken by `entity_id` | Ties broken by `updatedMs`, then key (E8) |
| Limits | Query ≤512 bytes, limit ≤500, buckets validated (`search.rs:154-181`) | ≤50 terms, ≤80 chars per term | 200 chars, 8 words, 50 + 20 rows |

What this means: bd-board's matcher is already richer than Macro's on every relevance axis (fields, typos, accents, snippets). The one ranking idea Macro has that bd-board lacks is **recency as a signal**, not only as a tiebreak.

## 3. UX patterns worth copying (ranked)

| # | Pattern (Macro evidence) | Effort | bd-board file |
|---|---|---|---|
| 1 | **Recency inside match tiers.** Exact or prefix name always wins. Within the same tier, recently *viewed* beats merely updated (`freshSort.ts:308-311`, `search.rs:332-347`). For bd-board: add an optional `recent: Map<docKey, rank>` to `SearchOptions` and use it in `compareHits` before `updatedMs`. Do not let it cross score tiers. Pass `now` in, never call `Date.now()` inside | S (~1 h + 2 cells) | `src/lib/palette-search.ts` (`compareHits`, `SearchOptions`), `src/lib/palette-recent.ts` |
| 2 | **Tab / Shift+Tab cycle result categories** with a visible tab row. A category is just a preset chip, the same way Macro maps a category to its facet seed (`CommandMenu.tsx:702-732, 855-860`; `category-search-filters.ts:17-39`). For bd-board: All · Tasks · Epics · In comments. Each one maps to an existing `type:` chip or to the `late` group | M (half day) | `src/components/command-palette.tsx`, `src/lib/keyboard.ts` |
| 3 | **Zero-result fallback rows instead of a dead end.** Macro shows "Search for q" plus "Ask AI" when nothing ranks (`useCommandItems.ts:452-458`). The default selection lands on a real result, never on a fallback (`core/default-result-index.ts:1-6`). For bd-board: when scoped and empty, show "Search all projects"; when chips are present and empty, show "Remove `status:closed`" | S (~2 h) | `src/components/command-palette.tsx` |
| 4 | **Open a hit at the match.** A comment or description hit opens the bead with that comment scrolled into view and highlighted. Each click gets a fresh seek id so re-clicking the same hit scrolls again (`search-navigation.ts:33-126`) | M (half day) | `src/components/command-palette.tsx` (`openBead`), the bead modal component |
| 5 | **Actions ranked by last use, shown with their shortcut.** Command search text = tags + keywords + description. Last-used time is stored in localStorage. For queries of 3 chars or fewer, the top 3 matching commands come first (`useCommandItems.ts:159-205, 426-447`; `recency.ts`). This extends bd-board's existing "Jump to" section | M (half day) | `src/components/command-palette.tsx`, new tiny `src/lib/palette-actions.ts` |
| 6 | **Drop punctuation-only words** before AND-ing, so `fix - login` still finds `fix: login` (`terms.rs:40-58`, and their real bug report in the doc comment). One line in `buildQuery` plus matrix cell **B14** | S (~30 min) | `src/lib/palette-query.ts` |
| 7 | **"Quoted phrase" = one word** with spaces, matched as an exact substring (`terms.rs:14-38`, `documents.rs:347-363`). Add to `buildQuery` tokenizing, plus matrix cell **B15** | S (~1 h) | `src/lib/palette-query.ts` |
| 8 | **Unresolved filters never widen a search.** `@nobody` must return nothing, never everything (`universal-input/core/search.ts:4-53`; e2e `global-search.browser.e2e.ts:132`). bd-board already does this (P4 "chip never adds"). Keep it as a named e2e cell, not a code change | S (test only) | `e2e/specs/fixture/palette.e2e.ts` |

Suggested new matrix cells (they keep the matrix MECE):
- **B14:** a punctuation-only word is ignored.
- **B15:** a quoted phrase is matched as one word.
- **E13:** recent-view breaks ties and never crosses a score tier.
- **P5:** with an injected clock, results are deterministic across calls.

## 4. Not worth copying, and why

- **The OpenSearch index and indexing pipeline** (`services/search_processing_service`, `crates/opensearch_client`, `infra/stacks/opensearch`): Kafka/SQS consumers, advisory leases, parent/chunk join indices, ACL filters, backfill jobs. This solves a team-scale, multi-tenant corpus that does not fit in the client. bd-board's corpus is about 5k beads already in memory.
- **The Rust/WASM cache engine** (`crates/client/cache-wasm`, `cache-turso`, `turso-opfs`): this is the whole normalized GraphQL cache with SQLite on OPFS (`crates/client/README.md`). Search is about 500 lines riding on it.
  - Adopting Rust just for search means a wasm build step (`apps/web/package.json:8` `just ensure-cache-wasm`), an async worker init and a second language.
  - Macro also pays a drift tax for having two matchers: the TS pending filter must copy the Rust subsequence rule (`quickAccess/entity-search.ts:12-14`), and ranking has to append hits the uFuzzy pass misses (`rank-command-search-items.ts:88-100`). That is the parity problem `search-libs.md` predicted for option (b).
- **Their matcher:** no typos, no client-side accent folding, and full text sorted by date instead of relevance. bd-board is ahead. Do not regress to it.
- **AI composer promotion and LLM filter extraction** (`universal-input-mode.ts`, `queries/extracted-search.ts`): this needs an agent service, and it competes with bd-board's explicit chip grammar. Revisit only if bd-board grows an LLM backend.
- **The 3-character minimum, cursor pagination and virtualized list** (`lib/queries/soup/search.ts:35-38`, `command-results.tsx`): these exist because of server round trips and lists of 500+ rows. bd-board searches locally and caps at 50 + 20 rows.
- **Bucket boosts (channel ×3, DM ×1.8) and CRM people regrouping:** these are specific to Macro's domain.
- **Facet-only filters (no `kind:value` text grammar):** bd-board's typed chips are faster for keyboard users. Keep them.

## 5. Does this change the earlier recommendation?

It changes the order, not the direction:
- **Keep the hand-written engine.** This is now the primary recommendation.
- **The MiniSearch spike becomes optional.** Run it only if the 5k-bead WKWebView benchmark misses p95 < 16 ms.

Evidence:
- A funded product with Rust engineers ships Cmd+K as a hand-written scorer doing a linear scan with no inverted index (`engine.rs:1237-1271`, `search.rs:405-456`). It is tuned by tests, not by a library.
- Where they do use a JS library, it is **uFuzzy**, the runner-up in `search-libs.md`. They use it for display ranking and highlight ranges (`freshSort.ts`, `fuzzy.ts`). If bd-board ever wants a library, try uFuzzy for title ranges before MiniSearch.
- Their Rust exists for the cache, not for search. **Rust stays "no"** for bd-board unless bd-board someday gets a persistent local store shared by Tauri and web.
- The matrix-as-acceptance-suite approach matches theirs. Their ranking rules are pinned by named unit tests (`rank-command-search-items.test.ts:114-373`, `freshSort.test.ts`, Rust `search/test.rs`). They also have e2e tests for filter behaviour.

## 6. What I could not access or did not read

- **Not run:** I did not run anything from the repo. Latencies, bundle sizes and the live app are unmeasured, and I did not log in to Macro's hosted app, so the UX observations come from code only.
- **Read only partly:** `QuickAccessSource.tsx` (1,413 lines, grepped only), `Launcher.tsx` (a create menu, not search), mobile search (`features/command/mobile/*`), the email and channel query builders (`opensearch_client/src/search/emails.rs`, `channels.rs`) and `search_service` endpoints other than `terms.rs` and `simple_unified.rs`.
- **Unverified:** whether Cmd+K rows render highlights anywhere else. `CommandItem.tsx` has none.
- **Firecrawl:** not used. The clone answered every question, and I did no web lookups.
