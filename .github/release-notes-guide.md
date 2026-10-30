---
name: release-notes
description: Rewrite the newest CHANGELOG.md section of bd-board into the house release-notes layout. Use when drafting or reviewing release notes, or when the release-notes workflow runs on a Release PR.
---

# bd-board release notes

Edit the newest (topmost) version section of `CHANGELOG.md`. Touch nothing else.
release.yml publishes that section as the GitHub release body, so write for a reader who has never seen the repo.

## Sources

- The section release-please just wrote (commit subjects).
- If a `## [Unreleased]` section exists, it holds hand-written entries for the same release. Fold them in, then delete the `[Unreleased]` heading.
- The commit and PR subjects supplied in the prompt. Never invent a feature, number or PR link that is not in these.

## Layout (keep this order)

1. The existing `## [X.Y.Z](compare link) (date)` heading, unchanged.
2. One theme paragraph, 1-3 sentences: what the release is about, how many PRs, any outside contributors.
3. `### What's New`: one `####` subsection per user-visible feature. Heading names the feature, not the PR title. Then 1-4 sentences: the problem before, what changed, what the user sees. End with PR links, `- [#N](url)`.
4. `### Fixes`: bold-titled bullets, one line each, PR link at the end.
5. `### Smaller changes`: bold-titled bullets for anything minor. Drop pure test, chore and docs commits.
6. `### Missed recent releases`: a collapsed `<details>` table of the previous 5 versions, one row each: version link and a comma-separated list of short highlights taken from their sections.

Install instructions are appended by release.yml. Do not write them.

## Voice

- Plain words. Say what it does, in concrete terms.
- Banned: exciting, game-changing, seamless, powerful, robust, leverage.
- No closing zinger. At most two em dashes in the whole section.
- Credit outside contributors with a bare `@username` (not a link) next to their PR.
- No private project names, local paths, hostnames, tokens or internal ticket ids. This repo is public.

## Check before saving

Every PR link and number appears in the supplied text. The version heading and compare link are unchanged. Only `CHANGELOG.md` is edited.
