# `.ccsyncignore` Design Research

**Project:** `ccsync` v0.5.9 — TypeScript ESM, Node ≥20, Vitest + Biome.
**Authors of relevant code seen:** `GLOBAL_IGNORE_PATTERNS` (hard-coded 30 lines), `buildStignore()` (one-shot concat), `stignore-writer.ts` (per-folder `.stignore`), `applier.collectStignoreTargets()` (writes one `.stignore` into every `bucket.paths` entry and into each `rootProfile.conversations` path). `rootProfile.codeFolders[]` lives under `src/core/config-schema.ts` (each entry `{ relativePath }`) and is consumed by `src/core/code-folders.ts`.

## 1. **Where the file lives** — `.ccsyncignore` in each code-folder root

**Recommended:** `.ccsyncignore` placed in the code-folder root (i.e. the directory referenced by a `codeFolders[].relativePath` entry, resolved against `rootProfile.localRoot`). For the `claude-config` / `shell-history` buckets there is no project root → no `.ccsyncignore` lookup; for `codeFolders` there is.

| Location | Discoverability | Git-integrable | Fits existing 3-layer model |
|---|---|---|---|
| `.ccsyncignore` in code-folder root | ★★★ users know where they are; sits next to `.gitignore` | **Yes**, ship with the project | New layer per-folder, sits *below* bucket |
| `~/.ccsync/ignore` (global) | ★ hidden; users forget it | No | Collides with existing global |
| Per-bucket YAML only | ★ users edit config schema, friction | Yes iff bucket entry is committed | Already exists; no new file |

`codeFolders` are project directories (they're the ones `code-folders.ts` scans for `.git`); so users already think in terms of *"this project, this ignore list"*. The 3-layer model becomes **global → bucket → `.ccsyncignore`** (4 layers if you count `cfg.globalIgnore` separately, but conceptually it's user-extended global). The file IS the project's `.stignore` so users can read syncthing's docs and copy patterns.

## 2. **Gitignore semantics vs Syncthing**

Syncthing's `.stignore` is **NOT** gitignore. Cite: <https://docs.syncthing.net/users/ignoring.html> (Syncthing v2.1.0 docs).

**Supports (subset of gitignore we can adopt):**
- `*`, `?`, `[a-z]`, `{a,b}`, `**` (`**` matches `/` like git)
- Leading `/` = root-anchored
- `!`-prefix = negate (`first matching pattern decides fate` — see below)
- `// line` comment, blank lines, UTF-8
- Auto-ignore of `.syncthing.*` and `~syncthing~*` prefixes (per `users/syncing.html`)

**Does NOT translate cleanly:**
- **Order is reversed:** `.stignore` is *first-match-wins*; gitignore is *last-match-wins*. Quote: *"The first pattern that matches will decide the fate of a given file."* — so `**/foo` then `!**` does NOT un-ignore everything; you need `!**` *before* `**/foo`. This is the #1 foot-gun.
- **Negations force directory traversal:** quote: *"Negated patterns that can match items below the folder root will cause Syncthing to traverse otherwise ignored directories."* Mitigation: anchor negations at root (`!/path`) instead of using `!foo`.
- **No gitignore re-include rule** where patterns can re-include a parent that an earlier pattern excluded if the re-include is on a *file* and the parent was already traversed; caveat in docs is identical to negation traversal.
- **Windows path separator** — Syncthing accepts `\` literally; cross-platform projects must emit `#escape=\` at the top.
- **No comments except `//`** — `#` is not a comment (treats as pattern error). Some gitignore dialects use `#`; reject.
- **Case-insensitivity** automatic on macOS/Windows — `(`.gitignore` semantics are case-sensitive everywhere`)`. Always emit `(?..

## 3. **Parser choice** — hand-roll, opinionated

Pick: **hand-rolled ~30-line splitter**, do not pull a package.

Candidates surveyed (current registry):
- `ignore@7.0.5` (kaelzhang, used by eslint) — unpacked ~63 KB. Mature, but encodes gitignore's last-match-wins semantics in its `.check()` API. Wrong mental model for our compile step; we'd only use its reader API and discard semantics.
- `gitignore-parser@0.0.2` — last published 2015, 6 lines of main, no TypeScript types, unmaintained. **Reject.**
- `picomatch@4.0.4` (~91 KB unpacked) — pure glob matcher, no comment/regex awareness; also wrong tool.

Rationale: the actual hard problem is **merge order across 3 sources** (not glob parsing). `ignore` solves a problem we don't have (the filtering side). Glob syntax in `.ccsyncignore` is consumed by Syncthing verbatim — ccsync only needs to (a) read lines, (b) drop comments, (c) trim whitespace, (d) preserve order. That's ~one regex per concern. Adding 63 KB to a project whose entire `dist` weight dominates `bin` to ship a thin CLI is a poor trade.

```ts
export function readCcsyncignore(text: string): string[] {
  return text.split(/\r?\n/).map(l => l.replace(/\s+$/, ""))
    .filter(l => l.length > 0 && !l.startsWith("//"));
}
```
Bonus: hand-rolled = we own the output format, can add a header warning if user writes `# commented-git-style` (which stignore would treat as a pattern named `#`).

## 4. **Merge order** — global / bucket / `.ccsyncignore`

`.stignore` is first-match-wins so the compile order **is** the precedence order: a pattern emitted **earlier** wins. We want *user intent* to win over *csg defaults*, so user-side patterns go **last** (they are evaluated only if no earlier pattern matched).

Concrete compile order written top→bottom of the generated `.stignore`:
1. Banner comment (`// Generated by ccsync`)
2. Header (`#escape=\`) if any user pattern uses backslash
3. `// Global protections` → `GLOBAL_IGNORE_PATTERNS` (hard-coded, ~30 entries)
4. `cfg.globalIgnore` (user customisation, free-form)
5. `// Bucket: <name>` → `bucket.ignore[]`
6. `// Project (.ccsyncignore)` → contents of `<codeFolderRoot>/.ccsyncignore`, if present

So: **`.ccsyncignore` is the most-specific and therefore the LAST authority**. The catch for `**/foo`: if `.ccsyncignore` has `**/foo`, we want it to suppress `node_modules/foo` even though `node_modules` (in GLOBAL_IGNORE_PATTERNS) matches earlier — that's fine, `node_modules` already ignores the whole tree. The win is for files *inside* tree-shaped ignores the user wants to keep anyway, e.g. `.ccsyncignore: !coverage/lcov.info` to preserve coverage output across machines. That works because `!**` coming *later* is only evaluated if `coverage` (no current pattern) didn't match first — and the previous patterns don't cover `coverage/lcov.info`, so the negation wins → not ignored → syncs. **Declared answer:** `.ccsyncignore` is the winning scope; global is the preventative floor; bucket is the mid-grain.

## 5. **Edge cases / gotchas**

1. **`.ccsyncignore` in non-git project.** `findCodeFolderCandidates()` already auto-discovers any dir with `.git`. For non-git dirs the user explicitly listed under `codeFolders[]`. Auto-add `.ccsyncignore` *only* for user-listed entries, never for git-detected ones (treat git-detected as read-mostly).
2. **Comments / blank lines.** Only `//` line-prefix and fully-blank lines are skipped. Reject lines starting with `#` (NOT a stignore comment) and warn.
3. **Symlinks.** Syncthing does NOT follow symlinks for `.stignore` purposes (`.stignore` is at folder root; matches are by name not by link target). Document: `.ccsyncignore` matches symlink *names*, not their targets. A user trying to ignore a symlinked dir must use the symlink name.
4. **Missing trailing newline.** Handled by split-on-`\n` (works); do NOT require POSIX-eol.
5. **Empty file == missing file.** If `readCcsyncignore` returns `[]`, behave identically to "file absent" — emit no `// Project` section at all.
6. **Hidden files.** Syncthing does NOT auto-ignore dotfiles (unlike git). Keep emitting dotfile paths normally. Auto-ignore is reserved for the `.syncthing.*` / `~syncthing~*` namespaces per `users/syncing.html`.
7. **Negation conflict with bucket-level ignores.** If bucket has `cache/` and `.ccsyncignore` writes `!cache/important.bin`, Syncthing traverses `cache/` (negation forces traversal) and may be expensive. **Policy:** when emitting user-controlled `.ccsyncignore` lines that start with `!`, re-emit them with root anchor if possible (`!/cache/important.bin`) per the Syncthing docs' safe-negation footnote. If a line is unanchored, log a `soft warning` to the apply output.

## 6. **Tests**

Unit tests for `ccsyncignore.ts` (parser + merge):
1. `readCcsyncignore` strips `//` comments, blank lines, trailing whitespace, CRLF.
2. `readCcsyncignore` rejects `#`-prefixed lines (warns but doesn't drop syntactically valid `.stignore` programs — actually treats as pattern with a user warning).
3. `buildStignore(folder, cfg)` with `.ccsyncignore` present → output contains the section header + lines after bucket section.
4. `.ccsyncignore` content is emitted AFTER global + bucket patterns, in exact source order, untouched by ccsync.
5. Empty `.ccsyncignore` ≡ missing → no section emitted.
6. Negation in `.ccsyncignore` is preserved verbatim (we do NOT resolve it).
7. `#escape=\` is auto-prepended if and only if `.ccsyncignore` contains a backslash.

**Smoking-gun end-to-end:** extend `tests/core/applier.test.ts` to (a) write a temp dir tree containing a `.ccsyncignore`, (b) call `apply(cfg)` against a mocked `SyncthingApi`, (c) assert the mocked filesystem contains `.stignore` with the merged content, and (d) spin up the real `~syncthing~` namespace check — assert the produced `.stignore` parses with `readCcsyncignore` round-trip (everything except what we stripped). A second E2E that boots an actual Syncthing instance against a temp dir would be ideal but heavyweight; gate behind an env flag.

## 7. **Schema/UX example**

`/Users/trananhhh/work/projects/my-saas/.ccsyncignore` (committed):

```
// Don't sync huge lockfiles — regenerate locally
// Comments use // per Syncthing .stignore convention
pnpm-lock.yaml
package-lock.json
yarn.lock

// Keep coverage output — useful across machines
!/coverage/lcov.info
!/coverage/coverage-summary.json

// Next.js scratch
.next/cache

// Per-machine editor cruft
.vscode/*
!.vscode/launch.json
!.vscode/settings.json
```

After `ccsync apply`, `/Users/trananhhh/work/projects/my-saas/.stignore`:

```
// Generated by ccsync — do not edit manually

// Global protections
.git/index
... (29 GLOBAL_IGNORE_PATTERNS entries) ...

// User global (cfg.globalIgnore)

// Bucket: code-root

// Project (.ccsyncignore) — /Users/trananhhh/work/projects/my-saas
pnpm-lock.yaml
package-lock.json
yarn.lock
!/coverage/lcov.info
!/coverage/coverage-summary.json
.next/cache
.vscode/*
!.vscode/launch.json
!.vscode/settings.json
```

The negation lines are emitted with root anchor and re-anchored from `.vscode/*` so the safe-negation guidance takes effect — `.vscode/launch.json` and `settings.json` are root-anchored before `.vscode/*` re-emit (note: order in the user's file vs. order in the output matters; we emit them in source order and log a `soft warning` if any `!` line is unanchored).

---

## Open questions / could-not-verify
- `dist/cli.js` exact byte delta vs. hand-rolled parser vs. `ignore` — needs a build to measure.
- `ignore@7.0.5` security audit status in ccsync's supply-chain policy — not checked.
- Deep-subtree behaviour of root-anchored negation `!/path` — docs only cover the top-level case; should be tested against a real Syncthing instance.
