# Plannotator DX/UX review, for bd-board

Date 2026-10-30. Plannotator CLI 0.28.x (local), repo backnotprop/plannotator (~9.7k stars), org github.com/plannotator.

## Could not access
- npmjs.com profile page (not tried past the registry; used `registry.npmjs.org` search by maintainer instead, which worked).
- plannotator.ai / docs.plannotator.ai pages: not fetched. Keyboard shortcuts, command palette, sidebar/tab and theming details of the annotation UI are NOT verified. Only found: Vim-controls spec (`docs/vim-controls.md`: opt-in, default off, never fires in inputs/dialogs, keyboard annotations go through the same pipeline as pointer ones), inbox search is ⌘K, and Amp has a command palette.
- Did not run the UI or open the Inbox window. Everything below is from `plannotator --help`, `plannotator inbox --help` (the long agent guide), the repo README, `apps/hook/README.md`, and the byoa / artifact-server READMEs.

## What Plannotator is
A local browser review surface plus a local Inbox. Plan review, `annotate <file|url|folder>`, `review` (diffs/PRs), `annotate-last`, guided reviews (`guide export|share`), `sessions`, `archive`.

## (1) Two-way interaction: evidence
- **Plan review via hooks.** Claude Code: `PermissionRequest` hook with matcher `ExitPlanMode` runs `plannotator` (stdin JSON). Approve lets the agent proceed on the exact approved text; deny sends annotations back as the reason (apps/hook/README.md).
- **Non-blocking mode (Claude Code >= 2.1.287).** Review does not make Claude wait: the turn ends and the decision arrives later as a new message (`PLANNOTATOR_CLAUDE_MOD=0` restores the old flow). This is the key trick: the human answers on their own time.
- **Gate flags on annotate/review:** `--gate` adds an Approve button; `--json` emits a decision JSON; `--hook` emits hook-native block/pass JSON; `--require-approval` exits 1 unless approved (exit 2 on usage errors); `--result-file <path>` atomically publishes the JSON. So a script or a Stop hook can gate on a human.
- **Inbox.** One local window per machine (`plannotator inbox`, binds 127.0.0.1; optional `--tailscale`). MCP tools: `send_message`, `read_thread`, `search`, `resolve_message`, `wait_for_reply`, `get_guide_brief`, `submit_guide`. Data in `~/.plannotator/inbox`.
  - Thread model: `reply_to` message id, else named `thread`, else the session's own thread. Resolved = done; next message opens a new thread.
  - Structured asks in markdown blocks: `:::question` (pick one), `:::question-multi`, `:::question-text`, with `Recommended:`, `Stopped:` (agent cannot go on), `Holds up:` (what waits), `Replaces:` (supersede an old question). `:::action` is for a human-only blocker (`Where:`, `Run:`, `Watching:`). The list groups threads under "Stopped on you" and "Holding up work".
  - Reply return path: the reply is injected as the session's next turn, starting `Plannotator Inbox: <subject> (<reply id>)`, ending with a `[thread … · cursor …]` line. Claude Code, Pi, OpenCode 2, Codex (`codex queue`), Qwen get it automatically; others use `wait_for_reply` (50 s long poll with a cursor).
  - Reply content: person's words, then "Answers to your questions" (per question: Answer / Other / Skipped / Note), then quoted-selection comments on the agent's own text, then file annotations, then attached files by path.
  - Small states: 👍 "Looks good" ack (no reply needed), Re-ask, "set aside for now", Done / Can't do it on action items, `@agent` tagging to hand a thread to another session.
- **Other bidirectional pieces:** BYOA (plannotator/byoa: a web app's chat talks to your running Claude Code/Pi/OpenCode session, the app exposes tools to it, `/byoa connect <url>` pairing code). Artifact Server (plannotator/artifact-server: MCP server with versions, comment threads, `dispatch_inbox` claim/delivered/failed; `@plannotator/artifact-server-claude-channel` pushes annotation bundles into an opted-in Claude Code session and closes them via comment API).

## (2) UI/UX seen in docs
- Annotate-by-selection (comment on exact words), file/folder/URL/HTML annotation, side-by-side diff review with file tree, "Ask AI" about what you review, 👍 one-click ack, per-thread "Send now" while the agent is mid-turn, Undo window (~10 s) before an ack reaches the agent, ⌘K message search, opt-in Vim keys (default off, never in inputs), light/dark Inbox art. Share links: small markdown in URL fragment, large payloads AES-256-GCM ciphertext with key in the fragment (PrivateBin model), 7-day expiry, `PLANNOTATOR_SHARE=disabled`; now moving to hosted "Workspaces" (deprecated OSS sharing).

## (3) DX
- One command: `curl -fsSL https://plannotator.ai/install.sh | bash` installs the binary, detects agents, writes hooks/skills/slash commands. `--minimal` = binary only.
- Claude Code: `/plugin marketplace add backnotprop/plannotator` then `/plugin install`. Manual `settings.json` hook snippet also documented.
- The Inbox auto-connects found agents (adds a `plannotator-inbox` MCP entry), never re-adds one you removed, prints what it added on stderr; `PLANNOTATOR_INBOX_CONNECT=0` skips. `inbox --notes <ids>` adds a note to agent instruction files only with the person's yes.
- `inbox status [--json]` with meaningful exit codes (0 running, 1 not, 2 not answering); `stop` verifies the pid is really that Inbox before killing.
- `plannotator update [--check]`, `uninstall [--purge] [--yes] [--dry-run]`: safe default keeps data; purge needs typing `purge`; refuses roots/home/symlinked dirs.
- `plannotator inbox --help` IS the agent guide (what/when/not-when, tools, thread rules, reply format). No separate docs needed for agents. `AGENTS.md`, `adr/`, `spec/`, `docs/` in repo.
- Privacy section states exactly what hits the network; no telemetry.

## Map to bd-board

What bd-board has today (README, src/lib): board/hierarchy/knowledge tabs, bead modal with comments (writes via `bd comment`, author via `BD_BOARD_AUTHOR`), the honest note that "an agent sees a comment only when it next reads the bead", copyable `agent-deck session send` nudge, "Comment and reopen", artifacts panel (markdown/HTML sandbox, `spec_id`, `artifacts` metadata), "Since you last looked" band, events journal (`bd events tail --follow`) for live updates, Knowledge tab from `LEARNED:/DECISION:` comment prefixes, keyboard j/k/Enter/Esc/`?`, `desktop:install`, readonly shim. No push to agent, no ask/answer model, no approve.

### Ranked ideas

1. **Ask / answer on a bead (a "question" comment convention) — value HIGH, effort S-M. BEST.**
   Borrow the `:::question` + `Stopped:` + `Holds up:` model, but store it as plain bead comments so no new backend: agent writes `bd comments add ID "QUESTION: … \n- [ ] A\n- [ ] B\nRecommended: A\nStopped: yes"`. Board parses it like the existing `DECISION:` prefix (src/lib/knowledge.ts), shows radio buttons in the modal, answer posts `ANSWER(Q1): A` via `bd comment`. Add an "Asks you" lane/filter ("Stopped on you" first, then "Holding up N beads" from blockers) on the dashboard. Fixes the stated gap: today the owner types prose and hopes the agent reads it. Exists: comments, knowledge prefix parser, `since-band`, events journal for live refresh.
2. **Nudge-on-answer (the return path) — value HIGH, effort S.**
   Plannotator's reply lands as the agent's next turn. bd-board already offers a copyable `agent-deck session send`. Make it one click: after an answer/comment, run the nudge (if the bead has an assignee/session mapping or a configured `AGENT_DECK_SESSION`), with a pre-formatted body like `bd-board: <bead> (<comment id>) — answer to Q1: A`, and a closing line with bead id for `reply_to`-style threading. Keep the copy button as fallback and say plainly when the nudge could not be sent. Needs a config for bead -> session; S if via env var / per-project registry field.
3. **Approve / deny gate on a bead — value MED-HIGH, effort M.**
   Mirrors `--gate --json --require-approval`. A `needs-approval` label (or `gate:` metadata) makes the card show Approve / Request changes; result written as a label change plus a structured comment. Also expose a CLI-friendly shape agents can poll: `bd show ID --json` already works, so document "wait until label approved" in the README "For agents" section. Exists: label filter, status drag, "Comment and reopen". Possible overlap with `bd` own gates/human-wait features (not checked): confirm before building.
4. **Annotate an artifact, return as a comment bundle — value MED, effort M-L.**
   Artifacts panel already renders markdown/HTML. Add select-text -> comment (quote + note) stored as one comment `ANNOTATION artifact=docs/plan.md: "quoted text" -> note`, with a "Send N annotations" button that posts them as one comment (plus nudge). Matches Plannotator's quoted-selection feedback. Sandboxed iframe HTML makes selection harder (L for HTML, M for markdown only). Start with markdown only.
5. **One-command setup + doctor + `--json` status — value MED, effort S.**
   `bd-board doctor` (bd version >= 1.3.0, events-journal on, registry valid, nudge session reachable) with exit codes like `inbox status` (0/1/2) and `--json`; `bd-board uninstall --dry-run`. README "For agents" conventions (artifacts, `LEARNED:`, new `QUESTION:`) printed by `bd-board --help` so the CLI is the agent guide, as `plannotator inbox --help` is. The app already has a diagnostic card and `desktop:install`; this is wiring them to a CLI.
6. **Small UX polish: 👍 ack, Undo window, ⌘K search — value LOW-MED, effort S.**
   A "Seen" one-click ack comment (`ACK:`) that tells the agent no reply is needed; 5-10 s Undo before a nudge is sent; ⌘K palette (search beads + jump to project) next to the existing `/` and `?`. Opt-in vim keys only if wanted: Plannotator ships them default-off and never inside inputs, which bd-board's existing keyboard.ts already respects.

### Not worth borrowing
Hosted Workspaces/sharing (bd-board is local-first; share links are even being deprecated upstream), Tailscale publishing, multi-agent MCP auto-registration, guided reviews.

### Open questions
- Does `bd` already have gate/human-wait primitives? Check before idea 3.
- Which session id does the nudge target per bead? Needs a mapping (assignee -> agent-deck session).
