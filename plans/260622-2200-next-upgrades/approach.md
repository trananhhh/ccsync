# Approach — ccsync: Prompt UI refresh + `.ccsyncignore`

## Mode and shape

- **Mode:** `standard_feature`. Two ordered user-facing capabilities. No HIGH/*external*/*security* risks. Both phases ship user-visible behavior, no API breakage, no schema migration risk beyond a new section in config (the schema is `z.record(z.string(), …)` so any string key is already accepted).
- **Shape:** two phases, ordered "UI-first" then "ignore-merge" because the UI rewrite touches more files and is easier to validate independently.

## What exists today (verified during brainstorm)

| Surface | File | Status |
|---|---|---|
| Bucket picker | `src/cli/wizard.ts:pickBuckets()` | readline-based, type-numbers |
| Claude config picker | `src/cli/claude-config-picker.ts` | readline, type-numbers, supports `n` skip-all |
| Code folders picker | `src/cli/wizard.ts:pickCodeFolders()` | readline + `a /path`, `n` skip |
| Project picker | `src/cli/wizard.ts:pickProjects()` | readline + `a /path`, `n` |
| Single-line input | `setup.ts:configureRootProfile` and `join.ts:promptLocalRoot` | readline `rl.question("Code root [${suggestedRoot}]: ")` |
| Yes/No confirms | `wizard.ts:pickCodeFolders`, `interactive.ts:manualAcceptPrompt` | manual `rl.question("[Y/n] ")` |
| Shortcut keys | `interactive.ts:shortcutPrompt` | manual `rl.question("> ")` + letter parser |
| Spinner | — | none — only `log.step/success/warn` text logs |
| Ignore compile | `src/core/ignores-default.ts` + `stignore-writer.ts` | hard-coded `GLOBAL_IGNORE_PATTERNS` + `cfg.globalIgnore` + `bucket.ignore[]`, three layers top→bottom |
| Folder count behaviour | `src/core/applier.ts:collectStignoreTargets` | writes one `.stignore` per bucket path or per `rootConversations` entry |

## Recommended approach

### Phase 1 — Lightweight prompt UI refresh

1. Swap `node:readline/promises` for `@inquirer/prompts` (single dep, re-exports `checkbox / input / confirm / rawlist`).
2. Add `nanospinner` for any IO step taking >300 ms.
3. Each picker module wraps in a tiny `promptOr(interactive, fallback)` helper — falls back to "keep current selection" when `process.stdin.isTTY === false`.
4. Catch `ExitPromptError` at the entry of each interactive flow → `process.exit(0)` for clean Ctrl-C.
5. Bump `package.json#engines.node` to `>=20.17.0` (inquirer engine floor).
6. Add tests where feasible: parser-stable (`checkbox`-driven flows are inherently TTY-only, hard to unit test — cover the small `promptOr()` fallback with tests; the rest is verified manually).

### Phase 2 — `.ccsyncignore` per code folder

1. New file `src/core/ccsyncignore.ts` with one function: `readCcsyncignore(folderPath): Promise<string[]>` — hand-rolled, ~10 LOC; comments = `//` only; reject `#`-prefixed (warn); trim whitespace; skip blanks.
2. Extend `src/core/ignores-default.ts:buildStignore()` to accept an optional `projectIgnore: string[]` argument; emit section after bucket section, preserving source order.
3. Extend `src/core/stignore-writer.ts:WriteStignoreInput` to include `codeFolderRoot?: string` — when present, read `.ccsyncignore` from there.
4. In `src/core/applier.ts:collectStignoreTargets`, when iterating `code-root` bucket's `paths`, pass the folder root (the bucket path itself) to the writer.
5. Augment `setup.ts:pickCodeFolders()` and `join.ts:configureRootProfile()` with a single confirmation "I scanned your code folders; I found a `.ccsyncignore` in <N> of them — they'll be applied automatically" — discoverable, no UI change.
6. Auto-warn when an unanchored `!` negation pattern is encountered in `.ccsyncignore`.

### Out of scope for this plan

- Symlink / mirror conversation modes — separate story.
- Syncthing home isolation — separate long-term roadmap item.
- PLG-style TUI dashboard — explicitly rejected by user.

## Risks + proof needed

### Phase 1

| Risk | Severity | Proof needed |
|---|---|---|
| inquirer hangs in non-TTY pipes | MED | Manual smoke: `echo "" \| ccsync setup` (must NOT hang) + unit test for `promptOr` fallback path with `process.stdin.isTTY = false`. |
| Engine bump `>=20.17.0` excludes early Node 20 users | LOW | Verify with the v0.5.x download stats — raising floor is cheap because `ccsync` is personal-tooling. |
| `a /path` add-custom-path feature regression | MED | Either (a) drop the feature, (b) two-step: yes/no → second `input()` prompt. Decision flagged for user before implementation. |
| Bundle bloat (~140 kB) | LOW | Track via `pnpm build` size report. |

### Phase 2

| Risk | Severity | Proof needed |
|---|---|---|
| `.ccsyncignore` semantics confusion (stignore ≠ gitignore — first-match-wins) | MED | Docs: explicit explanation in README added alongside the feature. Manual smoke: write `.ccsyncignore` with negation, observe `.stignore` produced, observe Syncthing behaviour in dry-run. |
| Negation traversal: `!cache/` causes Syncthing to scan the whole tree | MED | Mitigation: emit warnings for unanchored `!` patterns. Proof: hand-trace one example. |
| Bucket-level ignores get overridden by `.ccsyncignore` re-emit | LOW | Compile order is unchanged; `.ccsyncignore` is the last layer. Proof: include a unit test for the merged output against a snapshot fixture. |
| `#` comments treated as pattern (stignore doesn't accept `#` as comment) | LOW | Parser rejects with a soft warning. Proof: unit test fixture. |

## Files likely touched

### Phase 1

- `package.json` — add `@inquirer/prompts`, `nanospinner`; bump engines to `>=20.17.0`.
- `src/cli/wizard.ts` — rewrite 3 pickers (`pickBuckets`, `pickProjects`, `pickCodeFolders`).
- `src/cli/claude-config-picker.ts` — rewrite to checkbox.
- `src/cli/interactive.ts` — `shortcutPrompt` → `rawlist`; `manualAcceptPrompt` → `confirm`.
- `src/cli/commands/setup.ts` — `configureRootProfile` → `input`; `printShareInstructions` → spinner.
- `src/cli/commands/join.ts` — `promptLocalRoot` → `input`.
- `src/cli/commands/init.ts` — replace `log.step(...)` lines with spinner calls.
- `src/lib/prompt-or.ts` *(new)* — TTY-guarded wrapper helper.

### Phase 2

- `src/core/ccsyncignore.ts` *(new)* — `readCcsyncignore(folderPath)`.
- `src/core/ignores-default.ts` — add `projectIgnore?: string[]` to `buildStignore`.
- `src/core/stignore-writer.ts` — extend `WriteStignoreInput` with `codeFolderRoot?`.
- `src/core/applier.ts` — pass `codeFolderRoot` for the `code-root` bucket's folder entries.
- `src/lib/log.ts` *(or new)* — emit soft warning for unanchored `!` patterns.
- `src/cli/commands/setup.ts` / `join.ts` — show discovered-`.ccsyncignore` line in picker.
- `README.md` — new "Ignore rules" subsection explaining `.ccsyncignore`, gitignore conventions, and the merge order.

## Unresolved questions (must answer before Phase 1 starts)

1. **`a /path` add-custom-path UX**: drop / two-step / custom? Affects 2 pickers.
2. **Engine floor bump**: confirm `>=20.17.0`.

## Validation questions (can be answered during phase prep)

3. Should the shortcut menu loop (current: returns to prompt) or break after first action? (Phase 1 user-facing detail.)
4. `codeFolders[]` array: keep current `.` (entire root) as a "select everything" affordance, or require explicit per-folder selection? (Phase 2 picker change — current behaviour preserved, but worth re-checking.)
