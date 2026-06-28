# ccsync

> **One-command sync for Claude Code across every machine you touch.**
> Sync your Claude config, skills, hooks, conversations, commands, and active project working trees between laptops and desktops — without dragging paths around by hand.

`ccsync` is built for the case where you move between machines and want Claude Code to keep working the same way everywhere, even when the local workspace path differs on each machine.

- One CLI, one daemon (Syncthing), one config file per machine.
- Pair a new machine with a single token. No central server.
- `node:fs` aware: uncommitted edits, untracked files, dirty working trees all sync — because Syncthing doesn't know about git.

---

## Why ccsync exists

If you use Claude Code on more than one machine, you've probably hit at least one of these:

- **Path-bound conversations.** Claude Code stores history under `~/.claude/projects/<hash-of-absolute-path>/`. Move a project from `/Users/alice/work/foo` to `/Users/bob/Coding/foo` and Claude Code suddenly shows an empty conversation list on machine B.
- **Drifted config.** A skill you wrote on Monday isn't there on Wednesday's laptop. A hook is installed on one box but not the other. `settings.json` quietly falls out of sync.
- **Manual pairing tax.** Syncthing works but has to be configured per device, per folder, with stable folder IDs — too much YAML surgery for a casual weekend project.
- **Cache bloat.** Syncthing happily syncs `node_modules`, `dist`, `.venv`, `.next` if you forget `.stignore`. Multiply by 3 machines and the bandwidth pain is real.

`ccsync` is the thin layer that fixes all four:

1. **Root-based sync, not path-based.** You declare one workspace root per machine (`~/work`, `~/Code`, …). Projects under the same relative path are considered the same logical project across machines. Conversation IDs are derived from the *relative* path, not the absolute one.
2. **One setup, one token.** `ccsync setup <token>` joins a new machine in under a minute. The token encodes the host's identity, machine name, root profile, and the project list.
3. **Bucket-by-bucket control.** Buckets are named groups of paths (Claude config, conversations, worktrees, code root, …). Each bucket has its own ignore list and versioning policy.
4. **Cache ignored by default.** `node_modules`, `dist`, `.venv`, `.cache`, `__pycache__`, and friends are excluded at the global level. You can add more via `.ccsyncignore`.

---

## Quickstart

### Install

```bash
npm i -g @trananhhh/ccsync
ccsync --version
```

Requires Node.js 20.17+. Syncthing is auto-detected on first run; if missing, `ccsync` installs via your system package manager (macOS: `brew`, Linux: `apt` / `dnf` / `pacman`). Windows and other platforms: install Syncthing manually from [syncthing.net/downloads](https://syncthing.net/downloads/) and `ccsync` will pick it up.

### First machine

```bash
ccsync
```

With no arguments `ccsync` does the right thing: on a brand-new machine it walks
you through guided setup, and afterwards it drops you into a status dashboard.
Prefer a browser? `ccsync ui` serves a local **web dashboard + onboarding
wizard** (pairing, bucket toggles, conflict and handoff views) from the control
service — no terminal UI required.

> **Headless / no browser?** On a server with no display, skip the wizard
> entirely: pair with a single command, `ccsync setup <token>` (see
> [Second machine](#second-machine-and-third-fourth-)). Power-user escape
> hatches stay on the CLI too — `ccsync status`, `conflicts`, `release`, and
> `diagnose` all run headless.

The guided flow:

1. Verifies / installs Syncthing.
2. Generates a ccsync config at `~/.ccsync/config.yaml`.
3. Detects existing Claude conversation projects under your cwd.
4. Asks for **one code root** to sync (e.g. `~/work`).
5. Asks which code folders under that root to include.
6. Picks buckets (Claude config, conversations, worktrees, …).
7. Prints a one-line invite command — copy it to the next machine.

Example session:

```text
✓ Syncthing ready
Choose one code root to sync.
Code root [/Users/alice/work]: /Users/alice/work

Discovered 4 code folders under /Users/alice/work:
  [✓] ccsync
  [✓] hermes
  [ ] my-archive
  [✓] web

What to sync?
  [✓] Claude config (agents, commands, hooks, rules, skills, output styles)
  [✓] Conversations  (~/.claude/projects/)
  [✓] Background agents (~/.claude/tasks, jobs, session-env, file-history)
  [✓] Worktrees      (~/.claude/worktrees/)
  [ ] Plugins        (reproducible from marketplace)
  [ ] Shell history  (single-file mirror pending)

✓ Root profile configured: /Users/alice/work
✓ Mapped 3 Claude conversation project(s)

To add another machine, run this on it:
  npx @trananhhh/ccsync setup ccs2_eyJ2ZXJzaW9uIjoxLCJkZXZpY2VJZCI6…
```

The CLI stays open waiting for joiners. Any machine that runs the invite command within 10 minutes is auto-accepted.

### Second machine (and third, fourth, …)

Run the invite command — copy/paste is fine:

```bash
npx @trananhhh/ccsync setup ccs2_eyJ2ZXJzaW9uIjoxLCJkZXZpY2VJZCI6…
```

The join flow:

1. Installs / verifies Syncthing.
2. Reads the host root profile from the token.
3. Asks: *where should this root live on the new machine?*
4. Creates local Syncthing folders using stable folder IDs (so existing peers see them instantly).
5. Hands control back to the host's interactive prompt — auto-accept fires.

```text
Host canonical root:    /Users/alice/work
Choose where this root should live on this machine.
Local root [/Users/bob/Coding]: /Users/bob/Coding

✓ Root profile mapped to /Users/bob/Coding
✓ 4 folder(s) configured
```

The same machine *can also* be a host. From any dashboard:

```bash
# inside the main ccsync interactive prompt
[n]   # → add a new machine — prints a fresh invite token
```

There is no "primary" host. Whoever you happen to be sitting at, when you want to onboard a new laptop, just generate a token there.

### Daily use

```bash
ccsync                       # guided setup, then terminal dashboard + shortcuts
ccsync ui                    # open the web dashboard in your browser
ccsync status                # quick sync status
ccsync conflicts             # resolve file clashes
ccsync release               # wait until 100% in sync before switching machines
ccsync diagnose              # deep dump — peers, folders, paths, hints
```

---

## How it works

```
+--------------------+        +--------------------+
|   machine A        |        |   machine B        |
|  ~/work/ccsync     |        |  ~/Coding/ccsync   |
|                    |        |                    |
|  ccsync  ───┐      |        |      ┌─── ccsync   |
|             ▼      |        |      ▼             |
|       Syncthing ───┴════════┴─── Syncthing       |
|       (P2P, no central server)                   |
+--------------------+        +--------------------+

  ~/.claude/                    ~/.claude/
    ├── skills/*        ◀═══════▶   ├── skills/*
    ├── jobs/*          ◀═══════▶   ├── jobs/*
    └── projects/                  └── projects/
         -Users-alice-work-           -Users-bob-Coding-
         ccsync     ◀═══════▶            ccsync
                                       (same logical id,
                                        different path)
```

`ccsync` is a thin orchestration layer on top of [Syncthing](https://syncthing.net/). It:

- Runs a **dedicated Syncthing instance** out of its own home at `~/.ccsync/syncthing`, with its own device identity, GUI port, and API key. ccsync never touches a Syncthing you run yourself — the two stay fully isolated. (Configs from older ccsync versions that shared the platform-default Syncthing are detected on the next run and offered a one-time migration onto the dedicated home.)
- Builds **stable Syncthing folder IDs** from a hash of `<bucket> + <root-profile-id> + <relative-path>` so adding a machine mid-stream is a no-op for existing peers.
- Writes a **`.stignore` per folder** that combines a global hard-coded exclude list + bucket-level ignore + per-folder `.ccsyncignore` (forward-looking).
- Translates **Claude Code conversation projects** between machines using the *canonical* (host) root as the anchor. The machine where you work from is the local root; the project identity follows the relative path.

### Concepts

#### Root profile

A root profile is the unit of "what do these machines have in common?"

```yaml
rootProfile:
  id: profile-a3f1…            # stable hash of canonicalRoot
  canonicalRoot: /Users/alice/work     # host's path — the source of truth
  localRoot: /Users/bob/Coding        # this machine's path — derived
  conversationMode: direct             # direct | symlink | mirror  (direct today)
  codeFolders:                         # which sub-trees to sync
    - { relativePath: ccsync }
    - { relativePath: hermes }
  projects:                            # mapped Claude conversation projects
    - { relativePath: ccsync }
    - { relativePath: hermes }
  conversations:                       # explicit conversation directory identity
    - { encodedName: -Users-bob-Coding-ccsync, relativePath: ccsync }
```

The `id` is the fingerprint — it's how Syncthing folder IDs, invite tokens, and config files all agree without coordination.

#### Buckets

Buckets are named groups of paths sharing one ignore list + one versioning policy.

| Bucket                 | Default | What it syncs                                                                 |
| ---------------------- | :-----: | ------------------------------------------------------------------------------ |
| `claude-config`        | on      | `~/.claude/{agents,commands,hooks,rules,skills,output-styles}`                         |
| `claude-conversations` | on      | `~/.claude/projects/` — but mapped per machine via the root profile            |
| `claude-agent-state`   | on      | `~/.claude/{tasks,jobs,session-env,file-history}` for `claude agents --all`     |
| `claude-worktrees`     | on      | `~/.claude/worktrees/`                                                        |
| `claude-plugins`       | off     | `~/.claude/plugins/` — cache is intentionally not synced                       |
| `shell-history`        | off     | Pending a safe single-file mirror; Syncthing folder roots must be directories  |
| `code-root`            | on      | The selected workspace root, scoped to `codeFolders[]`                        |
| `active-projects`      | legacy  | Older per-project bucket — superseded by `code-root`                          |

See [docs/sync-decisions-and-findings.md](docs/sync-decisions-and-findings.md) for the current decisions, smoke-test findings, and known gaps behind these buckets.

Toggle at runtime:

```bash
ccsync advanced toggle shell-history --on
ccsync advanced toggle code-root --off
```

#### Conversation path mapping

The killer feature, and the reason `ccsync` exists instead of "just use Syncthing":

If you `cd /Users/alice/work/ccsync` on machine A and open Claude Code, Claude stores conversations in:

```text
~/.claude/projects/-Users-alice-work-ccsync/
```

If you `cd /Users/bob/Coding/ccsync` on machine B, Claude *expects*:

```text
~/.claude/projects/-Users-bob-Coding-ccsync/
```

— a different folder, even though it's the "same" project. Result: machine B shows no conversations from machine A.

`ccsync` solves this by anchoring the project identity to the *relative* path:

```text
project path relative to root profile → canonical id
ccsync                                 → "ccsync"
                                       → conversation ID is the same on A and B
                                       → the folder on each machine just lives at
                                          its own absolute path
```

The conversation mapping happens in `src/core/root-profile.ts` (`rootConversations`, `rootConversationPath`). Set `rootProfile.conversationMode` to:

- `direct` — Claude Code finds its folder at the expected absolute path. Works as long as you open the project from the canonical root.
- `symlink` — *(planned)* each remote conversation folder is symlinked into the local expected path. Lets you cheat on iCloud/Linux edge cases.
- `mirror` — *(planned)* bidirectional copy between the local expected path and the synced canonical path.

Direct is the only mode implemented today.

#### Ignore rules

Three layers, compiled into one `.stignore` per Syncthing folder at apply time:

1. **Hard-coded global patterns** (`src/core/ignores-default.ts`):
   ```text
   node_modules  .next  .nuxt  .turbo  .cache  dist  build  out  target
   __pycache__  .venv  .env.local  .DS_Store  *.log  *.swp
   .git/index  .git/*.lock  .pnpm-store  .yarn
   ```
2. **Bucket-level ignore** in `~/.ccsync/config.yaml`:
   ```yaml
   buckets:
     claude-config:
       ignore: ["*.log", "*.lock", "*.bak-*"]
     claude-conversations:
       ignore: ["*.tmp"]
   ```
3. **Per-folder `.ccsyncignore`** — gitignore-style file at the root of any synced
   code folder. Read at apply time and appended to the resulting `.stignore`
   *after* the bucket section, so project-specific rules win.

##### .ccsyncignore quick example

`/Users/me/work/my-saas/.ccsyncignore`:

```text
// Don't sync huge lockfiles — regenerate locally
pnpm-lock.yaml
package-lock.json

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

`ccsync apply` then writes a `.stignore` into `/Users/me/work/my-saas` (excerpt):

```text
// Generated by ccsync — do not edit manually

// Global protections
.git/index
… (29 GLOBAL_IGNORE_PATTERNS entries) …

// User global (cfg.globalIgnore)

// Bucket: code-root

// Project (.ccsyncignore) — /Users/me/work/my-saas
pnpm-lock.yaml
package-lock.json
!/coverage/lcov.info
!/coverage/coverage-summary.json
.next/cache
.vscode/*
!.vscode/launch.json
!.vscode/settings.json
```

##### Semantics — read this before writing your first .ccsyncignore

- **`.stignore` is first-match-wins**, not gitignore's last-match-wins. Order in
  the merged file *is* precedence: the pattern earlier in `.stignore` that
  matches a path wins.
- **`#` is NOT a comment**. Use `//` like in the example above. Lines starting
  with `#` are valid Syncthing patterns and will be treated as `ignore` rules,
  not notes.
- **Root-anchor every `!` (negation)** with `/`. `!coverage/` matches any
  `coverage/` anywhere in the tree and forces Syncthing to traverse the whole
  tree to evaluate it. `!/coverage/` matches only at the synced root and is
  cheap. ccsync detects unanchored negations at apply time and prints a soft
  warning per offender.
- **Windows-on-Windows projects**: if any line in `.ccsyncignore` contains a
  backslash (`\`), ccsync prepends `#escape=\` to the compiled `.stignore` so
  Syncthing treats backslashes as literal characters.
- **Missing `.ccsyncignore` is fine** — ccsync silently skips the layer.
- **Permission denied → skip and warn**, never crash. `apply` keeps running on
  the global + bucket layers only and prints a single `log.warn` line.

This is why `node_modules` etc. are not in bucket-level config: keeping them in
the global layer means you can enable / disable any bucket without accidentally
re-syncing cache bloat.

---

## Commands

### Day-to-day

```text
ccsync                            # smart dispatch → dashboard or setup
ccsync setup [token]              # bootstrap or join via invite
ccsync status   [--verbose]       # one-screen sync overview
ccsync conflicts [--auto]         # merge shell history, prompt the rest
ccsync release [--timeout <s>]    # block until safe to switch machines
ccsync diagnose                   # deep dump: peers, folders, paths, hints
```

### Advanced

```text
ccsync advanced init
ccsync advanced share
ccsync advanced join <token>
ccsync advanced accept [deviceId] | --all
ccsync advanced pair <deviceId> [--introducer] [-n <name>]
ccsync advanced push
ccsync advanced sync
ccsync advanced toggle <bucket> [--on | --off]
ccsync advanced project add|remove|list|detect <path>
ccsync advanced config [--path]
ccsync advanced claim         # mark this machine active (shell-history coordination)
ccsync advanced id            # print Syncthing device id
```

### Pairing model

- **Invite token** — primary path. One machine prints `ccs2_<token>` (deflate + base64url), the other runs `ccsync setup <token>`. Expires in 10 minutes.
- **Manual pair** — `ccsync advanced pair <deviceId>` if you already have the device id from `ccsync advanced id` on the host.
- **Auto-accept** — when an incoming connection matches a fresh invite, the host's interactive prompt accepts without manual confirmation.
- **Manual accept** — if no fresh invite exists, the host prompts on next `ccsync` run: `Accept all? [Y/n]`.

There is no "first machine" or "primary host". Any machine can invite any other machine.

---

## State of features

| Area                              | Status        | Notes                                                              |
| --------------------------------- | :-----------: | ------------------------------------------------------------------ |
| Syncthing bootstrap + identity    | stable        | macOS (`brew`) and Linux (`apt`/`dnf`/`pacman`) handled automatically. Windows + others require manual install; `ccsync` picks up any `syncthing` on `PATH`. |
| Bucket picker + Claude config picker | stable     | Line-based interactive prompts.                                    |
| Workspace root + .git auto-detect | stable        | Scans `cwd` and `~/.claude/projects/` for project hints.           |
| Code-folder picker                | stable        | Detects `.git` directories to depth 5, skips heavy/unsafe names.   |
| Conversation path mapping         | stable        | `direct` mode. Symlink + mirror are stubbed.                       |
| Invite token encode/decode        | stable        | `ccs2_*` deflate + base64url; `ccs1_*` legacy support.             |
| Auto-accept via fresh invite      | stable        | ~10 minute window.                                                 |
| Manual pairing                    | stable        | `pair <deviceId>` for manual-out cases.                            |
| Conflict scanner                  | stable        | Detects Syncthing conflict files; auto-merges shell history.       |
| Status / diagnose                 | stable        | Read-only inspection; useful for QA.                               |
| Syncthing home isolation          | **gap**       | Today ccsync shares the platform default Syncthing home. Full isolation (`~/.ccsync/syncthing/` + dedicated API/GUI) is on the roadmap but not done. |
| **Lightweight prompt UI**         | **next**      | Replace `node:readline` with `@inquirer/promises` family for nicer checkbox/select UX. Will not become a full-screen TUI — Hermes/OpenClaw-style simplicity wins. |
| **`.ccsyncignore` per folder**    | **next**      | Gitignore syntax, per code folder. Compiled into `.stignore` alongside global + bucket ignore. |
| **Better dashboard**              | **next**      | Live progress during transfer; per-bucket toggle from dashboard; clearer "add a machine" affordance. |
| Skill/plugin post-install         | not planned   | Cache is ignored at sync time; rebuild on use is the contract.     |
| Symlink / mirror conversation modes | not planned today | Direct mode covers the common case; revisit if user-facing gaps appear. |

---

## Roadmap

Near-term, ordered by leverage:

1. **Prompt UI refresh.** Swap `readline/promises` for `@inquirer/promises` (`checkbox`, `input`, `select`, `confirm`). Add a `nanospinner`-based step indicator for any IO that takes more than ~300 ms. Zero new behavioural surface — same questions, same answers, just nicer.
2. **`.ccsyncignore` per folder.** Gitignore syntax. Walk up from each `codeFolders[]` entry to find the closest `.ccsyncignore`. Merge into `.stignore` per synced folder, alongside global and bucket patterns.
3. **Dashboard affordances.** Make "add a machine" a single top-level menu item rather than a hidden shortcut. Show per-bucket bytes in vs. out. Surface "synced N files just now" toast on watcher events.
4. **Cache contracts for skills and plugins.** Today cache patterns are silently dropped by global ignore. Document this behavior in the README and bucket descriptions so the user understands: *skills are portable, their caches are not — they will rebuild on demand on each machine.*
5. **Conversation mode experiments.** Symlink mode as opt-in (lets a second machine share conversations via a thin overlay, not a full copy).

Long-term (only if needed):

- Dedicated Syncthing home isolation at `~/.ccsync/syncthing/` plus a separate API port and GUI. Today the platform default is reused — a ccsync user who already runs Syncthing will see ccsync folders appear inside their existing GUI. Isolation will remove that surprise.
- Config UI for non-CLI users (probably a Tauri/Electron "Settings" panel — wait until CLI proves itself).
- Removing the legacy `active-projects` bucket after one more release of deprecation warnings.

---

## Development

```bash
pnpm install
pnpm test          # vitest run — 18 test files
pnpm typecheck     # tsc --noEmit
pnpm lint          # biome check
pnpm build         # tsup → dist/
```

`pnpm run dev` runs a tsup watcher — only run it in one terminal at a time.

Tests cover the core models (config schema, root profile, syncthing folder layout, invite token encoding, bucket defaults, ignore compilation) but **not** the interactive CLI. If you're wiring pickers, tests are the wrong place — exercise them manually with `ccsync` against a sandbox.

---

## Release

```bash
npm version patch
git push origin main --follow-tags
```

GitHub Actions verifies the package version, runs tests, publishes to npm, and creates a GitHub Release.

---

## License

MIT © trananhhh
