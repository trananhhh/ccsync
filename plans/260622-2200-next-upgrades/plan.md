---
title: "ccsync: Prompt UI refresh + .ccsyncignore"
description: "Swap readline for inquirer-style prompts + nanospinner, and add per-folder .ccsyncignore that compiles into .stignore."
status: pending
priority: P2
effort: 1.5d
branch: main
tags: [cli, ux, syncthing, ignore]
created: 2026-06-22
---

# ccsync: Prompt UI refresh + `.ccsyncignore`

## Overview

Two ordered user-facing improvements. Phase 1 swaps `node:readline/promises` for `@inquirer/prompts` + `nanospinner` so pickers and confirm prompts feel modern (`space to toggle` instead of `type-numbers`, animated spinners instead of static `log.step` lines), with a TTY guard so non-interactive runs (CI, pipes, `ccsync setup <token>`) keep current behaviour. Phase 2 adds a per-code-folder `.ccsyncignore` file that is appended as a third layer to the compiled `.stignore`, giving per-project Syncthing ignore control without touching `cfg.globalIgnore`.

## Phases

| Phase | Name | Status | Goal |
|---|---|---|---|
| 1 | Prompt UI refresh | pending | All interactive flows use `@inquirer/prompts` + `nanospinner`; non-TTY fallback preserves today's defaults; Ctrl-C exits cleanly. |
| 2 | `.ccsyncignore` per code folder | pending | `buildStignore()` accepts a `projectIgnore` argument; `applier` reads `<codeFolderRoot>/.ccsyncignore`; soft warning on unanchored `!` negation. |

## Key Decisions

- Use the umbrella **`@inquirer/prompts@^8`** package (one dep) — not per-prompt installs (`@inquirer/checkbox` etc); re-exports dedupe `@inquirer/core`.
- Use **`nanospinner@^1`** (11 kB, picocolors-coloured) — not `ora` (40 kB, chalk) — to stay under ~150 kB total stack weight.
- Hand-roll the `.ccsyncignore` parser (`~30 LOC` in `src/core/ccsyncignore.ts`) — do not add `ignore@7` (63 kB, wrong mental model: `filter()`, not `read()`).
- Compile order is unchanged: **global → bucket → `.ccsyncignore`**; `.ccsyncignore` is the last authority (user intent wins because `.stignore` is first-match-wins).
- Bump `package.json#engines.node` to **`>=20.17.0`** (inquirer `^20.17 || ^22.13 || >=23.5`); keep `>=20.0.0` for the `.ccsyncignore` change.
- `a /path` UX uses a **two-step flow** in Phase 1 — checkbox first, then a secondary `input()` prompt if the user wants to add a custom path. Preserves today's capability without writing a custom `@inquirer/core` prompt.

## Files

### Modify (Phase 1)
- `package.json` — add `@inquirer/prompts`, `nanospinner`; bump `engines.node` to `>=20.17.0`.
- `src/cli/wizard.ts` — rewrite `pickBuckets`, `pickProjects`, `pickCodeFolders` to `checkbox`.
- `src/cli/claude-config-picker.ts` — `pickClaudeConfigPaths` → `checkbox`.
- `src/cli/interactive.ts` — `shortcutPrompt` → `rawlist`; `manualAcceptPrompt` → `confirm`.
- `src/cli/commands/setup.ts` — `configureRootProfile` → `input`; spinner around `printShareInstructions`.
- `src/cli/commands/join.ts` — `promptLocalRoot` → `input`.
- `src/cli/commands/init.ts` — wrap `ensureSyncthing` / `generateHome` / `startDaemon` in `createSpinner`.

### Add (Phase 1)
- `src/lib/prompt-or.ts` — TTY-guarded wrapper: `promptOr(interactive, fallback)`.
- `tests/lib/prompt-or.test.ts` — covers the non-TTY fallback path.

### Modify (Phase 2)
- `src/core/ignores-default.ts` — `buildStignore(bucketIgnore, globalIgnore, projectIgnore?)`.
- `src/core/stignore-writer.ts` — `WriteStignoreInput` gets `codeFolderRoot?: string`.
- `src/core/applier.ts` — pass `codeFolderRoot` for the `code-root` bucket entries.
- `src/cli/commands/setup.ts` — show "N of your code folders have a `.ccsyncignore` — applied automatically" near the picker.
- `src/cli/commands/join.ts` — same nudge after `promptLocalRoot`.
- `README.md` — new **Ignore rules** subsection (`.ccsyncignore`, gitignore-syntactic notes, merge order).

### Add (Phase 2)
- `src/core/ccsyncignore.ts` — `readCcsyncignore(folderPath): Promise<string[]>`.
- `tests/core/ccsyncignore.test.ts` — parser + merge contract.

## Unresolved questions

(See `approach.md` § Unresolved questions — must resolve before Phase 1 starts.)

1. **`a /path` UX** — RESOLVED in-plan: two-step (`checkbox` → `input`), see Key Decisions.
2. **Engine floor bump** — RESOLVED in-plan: `>=20.17.0`, see Key Decisions.

## Validation Summary

**Validated:** 2026-06-22
**Questions asked:** 5
**Result:** all 5 confirmed at Recommended.

### Confirmed Decisions

- **Q1 — TTY fallback policy**: A. `promptOr()` falls back to the values currently in `~/.ccsync/config.yaml` (last-saved buckets + code folders + claude-config picks). Pipe-safe and CI-safe. New `tests/lib/prompt-or.test.ts` must cover this branch.
- **Q2 — `a /path` UX detail**: A. Two-step flow with **one** custom path per session. After the user types a path, the picker auto-closes and the result merges with the prior checkbox selections. No multi-add loop.
- **Q3 — Engine floor**: A. `package.json#engines.node` bumps to `>=20.17.0`. README "Install" section updated with the new minimum.
- **Q4 — Unanchored `!` handling**: A. `.ccsyncignore` patterns emitted verbatim, `findUnanchoredNegations()` returns the offenders, `apply` logs a `log.warn` per occurrence. No silent rewrite, no strict-mode refuse.
- **Q5 — `.ccsyncignore` read errors**: A. Permission-denied or unreadable file → skip that layer, log.warn, continue with global + bucket only. Permission errors stay visible but never block apply.

### Notes for phase-file tightening (apply during phase prep, not retro-committed)

- **phase-01-prompt-ui-refresh.md**: in the Demo transcript and Implementation Steps, replace the generic "two-step with `input()` afterward" wording with "single custom path per session, picker auto-closes after the `input()` resolves".
- **phase-02-ccsyncignore.md**: append one bullet to the Exit state covering Q5 — "If `readCcsyncignore(folderPath)` throws a non-`ENOENT` error (e.g. permission), the writer catches it, logs `log.warn`, and emits no `// Project` section. Add a unit test: `readCcsyncignore returns [] on permission-denied`."

## Validation questions

(Can answer during phase prep.)

3. Shortcut menu: loop (today) vs. break after first action (potentially cleaner)?
4. `codeFolders[].relativePath === "."` affordance: keep, or require explicit per-folder selection?
