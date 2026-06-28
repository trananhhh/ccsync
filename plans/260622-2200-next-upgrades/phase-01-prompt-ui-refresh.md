---
title: "Phase 1 — Prompt UI refresh"
description: "Swap readline for @inquirer/prompts + nanospinner across all interactive flows; add a TTY guard so non-interactive runs fall back to defaults."
status: pending
priority: P2
effort: 0.75d
branch: main
tags: [cli, ux, refactor]
created: 2026-06-22
parent: ./plan.md
---

# Phase 1 — Prompt UI refresh

## Overview

Replace every `node:readline/promises` site in `src/cli/**` with `@inquirer/prompts` (`checkbox`, `input`, `confirm`, `rawlist`) and replace static `log.step(...)` lines around IO with `nanospinner`. The interactive flow must feel like a modern CLI installer (`space to toggle`, inline confirm defaults, animated progress) without regressing non-TTY runs (`echo "" | ccsync setup <token>`, CI pipes) — those must take the existing defaults and exit cleanly.

Stays inside one command: no schema changes, no API additions, no migrations. Scope: 4 picker modules + 3 commands touched; 1 helper added.

## Entry state

- `wizard.ts:pickBuckets` uses `readline.createInterface` and a `while (true) { await rl.question("Toggle numbers…") }` loop.
- `wizard.ts:pickProjects` and `pickCodeFolders` support an `a /path` shortcut to add a custom path; same `while` loop pattern.
- `claude-config-picker.ts` mirrors the same loop.
- `interactive.ts:shortcutPrompt` is a hand-rolled `rl.question("> ")` + letter parser.
- `interactive.ts:manualAcceptPrompt` is a manual `[Y/n]` question.
- `setup.ts:configureRootProfile` and `join.ts:promptLocalRoot` use `rl.question("Code root [${suggestedRoot}]: ")`.
- `setup.ts:bootstrap`, `init.ts:handleInit`, `interactive.ts:showDashboard` rely on `log.step(...)` text logs — no spinner.
- `package.json#engines.node` is `>=20.0.0`.

## Exit state

- All four `pickBuckets / pickProjects / pickCodeFolders / pickClaudeConfigPaths` use `@inquirer/prompts`' `checkbox`. Defaults preserved via `checked`.
- `interactive.ts:shortcutPrompt` uses `rawlist` (`s/n/c/r/q`).
- `interactive.ts:manualAcceptPrompt` uses `confirm` with `default: true`.
- `setup.ts:configureRootProfile` and `join.ts:promptLocalRoot` use `input` with `default: suggestedRoot` (renderer omits literal `[bracket]`).
- A new `src/lib/prompt-or.ts` wraps every picker: `promptOr(() => checkbox(...), () => fallback)`. When `process.stdin.isTTY && process.stdout.isTTY` are both false, the fallback runs and the call resolves to today's persisted state (or `[.]`/`""` for empty picker results).
- A top-level `catch (e) { if (e instanceof ExitPromptError) process.exit(0) }` lives in `src/cli/index.ts` so Ctrl-C stays clean across all flows.
- `setup.ts:bootstrap`, `init.ts:handleInit`, and the `apply` calls in `interactive.ts` wear a `createSpinner(...).start()` / `.success()` / `.error()` pair around any IO that can exceed 300 ms — guarded by `process.stdout.isTTY` so non-TTY runs print plain `log.step` text.
- `package.json` adds `"@inquirer/prompts": "^8.0.0"` and `"nanospinner": "^1.0.0"`; `engines.node` is `">=20.17.0"`.
- `pnpm typecheck && pnpm lint && pnpm test` all pass; `pnpm build` produces roughly +140 kB on top of the existing `dist` (recorded in build output).

## Demo

`ccsync setup` on a fresh machine, with `~/.claude/projects/*` already populated — user runs the wizard once:

```
$ ccsync setup
ℹ First time here — let me set things up.
→ Installing Syncthing if needed…
✓ Syncthing: /opt/homebrew/bin/syncthing
⏳ Bootstrapping Syncthing identity…
✓ Syncthing identity ready

What to sync? (space to toggle, enter to confirm)
❯ ◯ Claude config            agents, commands, hooks, rules, skills, settings, CLAUDE.md  ← toggle
  ◯ Conversations           ~/.claude/projects/
  ◯ Worktrees                ~/.claude/worktrees/
  ◉ Plugins                  ~/.claude/plugins/ (reproducible from marketplace)
  ◯ Shell history            .zsh_history, .bash_history, Claude history.jsonl
[Enter]
✓ Buckets saved.

Code root  ~/work
[Enter]
✓ Root profile configured: ~/work
✓ Selected 7 code folder(s)
…
```

Two key behavioural confirmations:
- `echo "" | ccsync setup` exits in <2 s without hanging, preserving today's persisted defaults.
- `Ctrl-C` at any prompt prints `^C` and exits with code 0 (no stack trace).

## Stories

| Story | Outcome | Done when |
|---|---|---|
| S1.1 — `promptOr()` TTY guard | Non-TTY callers fall back to defaults; pickers never hang | `tests/lib/prompt-or.test.ts` covers the non-TTY path; manual smoke `echo "" \| ccsync setup <token>` completes |
| S1.2 — `pickBuckets` rewrite | `checkbox` UX, defaults preserved | Manual smoke; `cfg.buckets` after confirm matches user's toggles |
| S1.3 — `pickClaudeConfigPaths` rewrite | `checkbox` UX, `n`-skip preserved via second `confirm` step | Manual smoke; bucket ends enabled with selected subset |
| S1.4 — `pickProjects` & `pickCodeFolders` rewrite | `checkbox` UX with `a /path` as a second `input` prompt | Manual smoke; custom path lands in `cfg.rootProfile.codeFolders[]` |
| S1.5 — `shortcutPrompt` → `rawlist` | Single-keystroke menu via `rawlist` | Manual smoke in `ccsync` (no-args) interactive shell |
| S1.6 — `manualAcceptPrompt` → `confirm` | `(Y/n)` confirm via inquirer | Manual smoke: pending device with no invite token |
| S1.7 — `input` for `Code root` / `Local root` | `input` with default; bracket omission | Manual smoke: enter accepts the suggested default |
| S1.8 — Spinners on long IO | `nanospinner` around IO >300 ms in `setup.ts`, `init.ts`, `interactive.ts` | Visual check in TTY; non-TTY keeps `log.step` text |
| S1.9 — `ExitPromptError` cleanup | Ctrl-C → `process.exit(0)` in `src/cli/index.ts` | Manual smoke: Ctrl-C at every picker; no stack trace |

## Files

**Modify**
- `package.json`
- `src/cli/wizard.ts`
- `src/cli/claude-config-picker.ts`
- `src/cli/interactive.ts`
- `src/cli/commands/setup.ts`
- `src/cli/commands/join.ts`
- `src/cli/commands/init.ts`
- `src/cli/index.ts`

**Add**
- `src/lib/prompt-or.ts`
- `tests/lib/prompt-or.test.ts`

## Implementation Steps

1. **`package.json`**: add `"@inquirer/prompts": "^8.0.0"` and `"nanospinner": "^1.0.0"` to `dependencies`; bump `engines.node` to `">=20.17.0"`. (`@inquirer/prompts@8` requires `^20.17.0 || ^22.13.0 || >=23.5.0`.) RESOLVED Q1.
2. **`src/lib/prompt-or.ts`** (new): export `promptOr<T>(interactive: () => Promise<T>, fallback: () => T): Promise<T>` — returns `fallback()` when `process.stdin.isTTY === false || process.stdout.isTTY === false`. Also export `tryPrompt<T>(interactive, fallback)` that catches `ExitPromptError` and re-throws after the wrapper handles the exit (see step 3).
3. **`src/cli/index.ts`**: wrap `runProgram()` (or the entry that calls `program.parseAsync()`) in `try { … } catch (e) { if (e instanceof ExitPromptError) process.exit(0); throw e; }`. Imported from `@inquirer/prompts`.
4. **`src/cli/wizard.ts`**:
   - `pickBuckets` — `BUCKET_LABELS` becomes the `choices` of a `checkbox<string>`; `checked: buckets[b.key].enabled`; `description: pc.dim(...hint)`. Wrap in `promptOr(...)` with `fallbackEnabled(buckets)` as fallback.
   - `pickProjects` and `pickCodeFolders` — `checkbox` with defaults from `current`. If user wants a custom path: render a second prompt `input({ message: "Add a path:" })` and merge into candidates. (RESOLVED Q2: two-step.)
   - Remove all `node:readline/promises` imports.
5. **`src/cli/claude-config-picker.ts`**: same `checkbox` rewrite. Move `n` skip-all into a preceding `confirm({ message: "Skip Claude config sync?", default: false })`.
6. **`src/cli/interactive.ts`**:
   - `shortcutPrompt` → `rawlist({ message: "Action", choices: [...], loop: false })`. Drop the `rl.question("> ")` block.
   - `manualAcceptPrompt` → `confirm({ message: "Accept all?", default: true })`.
   - `printInviteAndWait` and `showDashboard`: wrap the long IO (`api.systemStatus()`, `findConflicts()`) with `createSpinner(...).start()` / `.success()` if `process.stdout.isTTY`, else leave `log.step` text.
7. **`src/cli/commands/setup.ts`**:
   - `configureRootProfile`: replace `rl.question("Code root [${suggestedRoot}]: ")` with `input({ message: "Code root", default: suggestedRoot })`.
   - `bootstrap` and `applyConfig`: wrap `generateHome()` and `apply()` with `createSpinner` if TTY.
   - `printShareInstructions`: after `api.systemStatus()`, optionally wrap with a spinner if `api.systemStatus()` exceeds 300 ms.
8. **`src/cli/commands/join.ts`**: `promptLocalRoot` → `input({ message: "Local root", default: canonicalRoot })`.
9. **`src/cli/commands/init.ts`**:
   - Replace each `log.step("…")` block with `createSpinner("…").start()` and resolve with `.success({ text })` or `.error({ text })` when the underlying IO completes.
   - All spinner calls are guarded by `process.stdout.isTTY` — non-TTY falls back to the existing `log.step` text.
10. **`tests/lib/prompt-or.test.ts`** (new): verify `promptOr()` returns the fallback synchronously when `process.stdin.isTTY` is `false`; verify a window where `process.stdin.isTTY === true` actually invokes the interactive branch (mark `it.skip` if your env forces TTY off — see Vitest config).
11. **Verification**:
    - `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
    - Manual smoke: `pnpm build && node dist/cli.js setup` in a TTY; `echo "" | pnpm build && node dist/cli.js setup <token>` to confirm non-TTY fallback cost is sub-second.
    - Ctrl-C test at every picker.

## Todo list

- [ ] Step 1: package.json deps + engine bump
- [ ] Step 2: prompt-or.ts (new helper)
- [ ] Step 3: ExitPromptError handling in cli/index.ts
- [ ] Step 4: wizard.ts three pickers
- [ ] Step 5: claude-config-picker.ts
- [ ] Step 6: interactive.ts (rawlist + confirm + spinners)
- [ ] Step 7: setup.ts (input + spinners)
- [ ] Step 8: join.ts (input)
- [ ] Step 9: init.ts (spinners)
- [ ] Step 10: tests for prompt-or.ts
- [ ] Step 11: typecheck / lint / test / build smoke

## Success Criteria

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.
- `echo "" | ccsync setup <token>` finishes in <2 s (telemetry: prints banner, applies, exits cleanly with no prompts).
- Each picker UX uses space-to-toggle / inline defaults — verified by running `ccsync setup` interactively.
- Ctrl-C at any prompt yields `process.exit(0)`, no stack trace, no dangling readline listener.
- `dist/cli.js` size delta ≤ +150 kB compared to pre-Phase-1 build (recorded in the build log).
- `node --version` constraint read from README: `>=20.17.0`.

## Risk Assessment

(Pulled from `approach.md` § Risks.)

| Risk | Severity | Proof |
|---|---|---|
| inquirer hangs in non-TTY pipes | MED | `tests/lib/prompt-or.test.ts` covers the fallback branch; manual smoke `echo "" \| ccsync setup` <2 s. |
| Engine bump `>=20.17.0` excludes early Node 20 | LOW | Documented in README "Requirements" section; ccsync is personal tooling, download stats acceptable. |
| `a /path` UX regression | MED | RESOLVED in-plan (two-step): after Phase 1 lands, manual smoke confirms both default path and custom path work. |
| Bundle bloat ≈+140 kB | LOW | `pnpm build` size report logged; flag in PR description. |

## Security Considerations

N/A — this phase is UI plumbing only. No new network surface, no new file paths, no privilege boundary moves. Spinner output does not leak environment data; `confirm`/`checkbox`/`input` handle only stdin bytes that the existing readline already received.

## Next steps

After Phase 1 lands and `pnpm build` is green, kick off Phase 2 (`.ccsyncignore`) — `buildStignore()` gets an optional third argument, and the picker modules can use the new `promptOr()` facility to surface "found `.ccsyncignore` in N of your folders" without inventing more interactive chrome.
