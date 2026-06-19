# ccsync

> Sync Claude Code config, conversations, plugins, **and active project working trees** between machines — via [Syncthing](https://syncthing.net/).

`ccsync` is a thin CLI wrapper that scaffolds Syncthing with the right folder shares, ignore rules, and safety rails so you can step away from one machine and pick up Claude Code on another with the exact same context: agents, hooks, skills, in-flight conversations, **and uncommitted edits in your project working trees.**

## Why ccsync

`~/.claude/` already holds the state you want preserved between machines: settings, agents, commands, hooks, rules, custom skills, plugin metadata, and — most importantly — **the conversation transcripts in `~/.claude/projects/`**. Plus you usually want your active project source trees mirrored so an in-flight edit on the desktop is ready on the laptop.

Git is the wrong tool for ~3 GB of mostly-binary state across tens of thousands of files. Syncthing is right for the bytes, but its UI is folder-by-folder and doesn't know what Claude Code looks like. `ccsync` does the glue:

- One command (`ccsync init`) installs Syncthing, bootstraps a device identity, and scaffolds buckets that match Claude Code's directory layout.
- **Hard-coded global ignores** (`.git/index*`, `node_modules`, build artifacts) so you don't corrupt git or thrash on dependencies.
- **Toggleable buckets** per machine — opt in/out of plugin cache, shell history, project working trees.
- **Invite-token join** — share a code from machine A, paste it on machine B, `ccsync accept` on A. Done.
- **Introducer pattern** — third+ machine only needs to join the first one. The mesh fills itself in.
- **Safe-switch workflow** (`ccsync claim` / `ccsync release`) blocks until everything is 100% in-sync.
- **Auto-merge for shell history** by timestamp.
- **Interactive TUI** — just run `ccsync` with no args.

## Install

```bash
npm i -g @trananhhh/ccsync
# or run ad-hoc
npx @trananhhh/ccsync
```

> Published under the `@trananhhh` scope because the bare `ccsync` name on npm is taken by an unrelated project. The installed binary is still called `ccsync`.

Requires **Node.js 20+**. Syncthing is installed for you on first run (Homebrew on macOS, apt/dnf/pacman on Linux). Windows: install Syncthing manually then `ccsync init`.

## Quickstart — 2 machines (invite flow)

On **machine A** (e.g. your MacBook):

```bash
ccsync init
ccsync share
# → prints an invite token like  ccs1_eyJkZXZpY2VJZCI6Ii...
```

On **machine B** (e.g. your Linux desktop):

```bash
ccsync init
ccsync join ccs1_eyJkZXZpY2VJZCI6Ii...
```

Back on **machine A**:

```bash
ccsync accept       # interactively admit machine B
```

Done. Watch progress:

```bash
ccsync status            # one-line summary
ccsync status --verbose  # per-folder pending counts
```

## 3 or more machines (introducer pattern)

The invite token from `ccsync share` marks the issuing machine as an **introducer**. Once peers are connected through it, they auto-discover each other:

```bash
# On machine A — the "hub":
ccsync share        # prints token_A

# Machine B:
ccsync join token_A
# Machine A:
ccsync accept

# Machine C:
ccsync join token_A
# Machine A:
ccsync accept

# → B and C are now connected to each other via A's introduction.
# Adding machine D? Same recipe: D joins via token_A, A accepts.
```

You can also issue `ccsync share` from any machine — it always picks the running machine as the introducer.

## Tracking project working trees

The `active-projects` bucket syncs whole project directories, including uncommitted edits. Default ignores protect `.git/index*` and skip `node_modules`/build outputs.

```bash
# Auto-discover Claude Code projects (decodes ~/.claude/projects/-…)
ccsync project detect

# Add manually
ccsync project add ~/work/myapp
ccsync project add ~/Coding/anby/anby-meeting

ccsync project list
ccsync project remove ~/work/oldproject

ccsync push          # apply
```

The first `add` auto-enables the bucket. Run `ccsync push` to broadcast.

## Default buckets

| Bucket | Default | What it syncs |
|---|---|---|
| `claude-config` | ✅ on | `agents/`, `commands/`, `hooks/`, `rules/`, `skills/`, `output-styles/`, `settings.json`, `CLAUDE.md`, `keybindings.json` |
| `claude-conversations` | ✅ on | `~/.claude/projects/` — transcripts and per-project memory |
| `claude-worktrees` | ✅ on | `~/.claude/worktrees/` |
| `claude-plugins` | ❌ off | `~/.claude/plugins/` (reproducible from marketplace) |
| `shell-history` | ❌ off | `~/.zsh_history`, `~/.bash_history`, `~/.claude/history.jsonl` |
| `active-projects` | ⚙ user | Add via `ccsync project add` |

Toggle per machine:

```bash
ccsync toggle claude-plugins
ccsync toggle shell-history --on
ccsync push
```

Edit config directly:

```bash
ccsync config            # opens ~/.ccsync/config.yaml in $EDITOR
ccsync config --path     # print the path
```

## Interactive mode

Run `ccsync` with no arguments to drop into a numbered menu showing your machine name, peer count, enabled buckets, and daemon status.

## Safe switch workflow

Before walking to the other machine:

```bash
ccsync release
# Waits until every bucket reports 0 pending files,
# then prints: ✓ READY TO SWITCH — all buckets in sync, lock released
```

When you start working on a fresh machine, optionally claim it:

```bash
ccsync claim
```

## Conflicts

If two machines edit the same file, Syncthing keeps both — yours becomes `<filename>.sync-conflict-<date>-<peer>.<ext>`.

```bash
ccsync conflicts              # interactive: keep / take remote / skip
ccsync conflicts --auto       # auto-merge shell history, list the rest
```

Shell-history conflicts are **auto-merged by timestamp** + deduped — never handed back to you for manual resolution.

## Hard-coded safety ignores

These are always added to every bucket's `.stignore`:

```
.git/index, .git/index.lock, .git/HEAD.lock, .git/refs/**/*.lock,
.git/objects/tmp_*, .git/MERGE_*, .git/FETCH_HEAD, .git/ORIG_HEAD,
node_modules, .next, .nuxt, .turbo, .cache, dist, build, out, target,
__pycache__, .venv, .env.local, .DS_Store, Thumbs.db, *.swp, *.swo,
*~, *.log, .pnpm-store, .yarn
```

This prevents the two main classes of disaster:

- **Git index corruption** when both machines touch a working tree concurrently.
- **`node_modules` thrash** that makes Syncthing scan tens of thousands of files for no benefit.

## Recommended shell setup (if you enable `shell-history`)

Add to `~/.zshrc`:

```zsh
setopt INC_APPEND_HISTORY EXTENDED_HISTORY SHARE_HISTORY HIST_IGNORE_ALL_DUPS HIST_REDUCE_BLANKS
HISTSIZE=100000
SAVEHIST=100000
```

For bash, add to `~/.bashrc`:

```bash
HISTSIZE=100000
HISTFILESIZE=200000
HISTTIMEFORMAT="%F %T "
export PROMPT_COMMAND="history -a; history -n"
shopt -s histappend
```

## Running 2 machines at the same time

Syncthing is eventual-consistency, **not file locking**. If both machines edit the same file:

- Data is never lost — the loser becomes a `.sync-conflict-*` file.
- The hard-coded `.git/` index/lock patterns are ignored, so git won't corrupt.
- `~/.claude/projects/<id>/*.jsonl` are append-only; concurrent writes produce conflict files visible in `ccsync conflicts`.

Use `ccsync claim` to broadcast which machine is "primary" — a JSON file under `~/.ccsync/active.lock` that syncs along with everything else.

## Commands reference

| Command | What it does |
|---|---|
| `ccsync` | Interactive menu |
| `ccsync init [--force] [--machine-name <name>]` | Install Syncthing, bootstrap, start daemon |
| `ccsync id` | Print this machine's Syncthing device ID |
| `ccsync share [--no-introducer]` | Emit an invite token |
| `ccsync join <token>` | Pair using an invite token |
| `ccsync accept [<deviceId>] [--all]` | Admit pending devices |
| `ccsync pair <device-id> [--name <label>] [--introducer]` | Low-level pair |
| `ccsync push` | Apply local YAML to Syncthing |
| `ccsync sync` | Force immediate rescan (pull-like) |
| `ccsync status [--verbose]` | Peer + folder sync status |
| `ccsync toggle <bucket> [--on \| --off]` | Enable/disable a bucket |
| `ccsync project add \| remove \| list \| detect` | Manage `active-projects` |
| `ccsync config [--path]` | Open config in `$EDITOR`, or print the path |
| `ccsync conflicts [--auto]` | Scan and resolve `.sync-conflict-*` files |
| `ccsync claim` | Mark this machine active |
| `ccsync release [--timeout <s>]` | Wait until 100% in-sync, release active flag |

## Releasing (for maintainers)

CI publishes to npm automatically when a `v*` tag is pushed. To cut a release:

```bash
# bump version in package.json AND create matching git tag
npm version patch    # or minor / major
git push origin main --follow-tags
```

The publish workflow validates that the git tag matches `package.json` version, runs typecheck + tests + build, then publishes with **npm provenance** signing. A GitHub release is created with auto-generated notes.

Requires `NPM_TOKEN` repo secret (npmjs.com → Access Tokens → "Automation" type so it bypasses 2FA in CI).

## Roadmap

- v0.4: launchd / systemd agent for idle-triggered sync; Claude Code exit hook; hotkey integration.
- v0.5: Web UI dashboard; bucket templates; encrypted self-hosted relay.

## License

MIT © trananhhh
