# ccsync

> Sync Claude Code config, conversations, plugins, and active project working trees between machines — via **Syncthing**.

`ccsync` is a thin CLI wrapper around [Syncthing](https://syncthing.net/). It scaffolds the right folder shares, ignore rules, and safety rails so you can switch between a laptop and a desktop and pick up Claude Code with the exact same context: agents, hooks, skills, in-flight conversations, even uncommitted edits in your project working trees.

## Why ccsync

`~/.claude/` already holds the state you want preserved between machines: settings, agents, commands, hooks, rules, custom skills, plugin metadata, and — most importantly — **the conversation transcripts in `~/.claude/projects/`**. Plus you usually want your active project source trees mirrored so an in-flight edit on the desktop is ready on the laptop.

Git is the wrong tool for ~3 GB of mostly-binary state across tens of thousands of files (existing solutions hit `E2BIG` from `git add` spawning past `ARG_MAX`). Syncthing is the right tool for the bytes, but its UI is folder-by-folder and doesn't know what Claude Code looks like.

`ccsync` does the glue:

- One command (`ccsync init`) installs Syncthing, bootstraps a device identity, and scaffolds buckets that match Claude Code's directory layout.
- Sensible **global ignores** out of the box (`.git/index*`, `node_modules`, build artifacts) so you don't corrupt git or thrash on `node_modules`.
- **Toggleable buckets** per machine — opt out of plugin cache or shell history without editing XML.
- **Safe-switch workflow** (`ccsync claim` / `ccsync release`) — block until everything is 100% in-sync before you walk to the other machine.
- **Auto-merge for shell history** — `.zsh_history`, `.bash_history`, and `~/.claude/history.jsonl` conflicts are merged by timestamp, not handed back to you.

## Install

```bash
npm install -g ccsync
# or
pnpm add -g ccsync
# or run ad-hoc
npx ccsync init
```

Requires **Node.js 20+**. Syncthing is installed for you on first run (Homebrew on macOS, apt/dnf/pacman on Linux). Windows: install Syncthing manually then `ccsync init`.

## Quickstart — 2 machines

On **machine A** (e.g. your MacBook):

```bash
ccsync init
# → prints your device ID, e.g. ABCDEFG-HIJKLMN-…
```

On **machine B** (e.g. your Linux desktop):

```bash
ccsync init
ccsync pair ABCDEFG-HIJKLMN-…   # device ID from machine A
ccsync push
```

Back on **machine A**:

```bash
ccsync pair XYZ1234-…           # device ID printed by B's init
ccsync push
```

That's it — both machines now share the default buckets. Watch progress:

```bash
ccsync status              # one-line summary
ccsync status --verbose    # per-folder pending counts
```

## Default buckets

| Bucket | Default | What it syncs |
|---|---|---|
| `claude-config` | ✅ on | `agents/`, `commands/`, `hooks/`, `rules/`, `skills/`, `output-styles/`, `settings.json`, `CLAUDE.md`, `keybindings.json` |
| `claude-conversations` | ✅ on | `~/.claude/projects/` — transcripts and per-project memory |
| `claude-worktrees` | ✅ on | `~/.claude/worktrees/` |
| `claude-plugins` | ❌ off | `~/.claude/plugins/` (reproducible from `installed_plugins.json`) |
| `shell-history` | ❌ off | `~/.zsh_history`, `~/.bash_history`, `~/.claude/history.jsonl` |
| `active-projects` | ⚙ user-defined | Add your project roots in `~/.ccsync/config.yaml` |

Toggle per machine:

```bash
ccsync toggle claude-plugins        # flip the current state
ccsync toggle shell-history --on
ccsync toggle active-projects --off
ccsync push                         # apply
```

Edit config:

```bash
ccsync config                # opens ~/.ccsync/config.yaml in $EDITOR
ccsync config --path         # print the path
```

## Safe switch workflow

Before walking to the other machine:

```bash
ccsync release
# Waits until every bucket reports 0 pending files,
# then prints: ✓ READY TO SWITCH — all buckets in sync, lock released
```

When you start working on a fresh machine, optionally claim it so the other machine knows you've moved:

```bash
ccsync claim
```

## Conflicts

Two machines edited the same file? Syncthing keeps both — yours becomes `<filename>.sync-conflict-<date>-<peer>.<ext>`. Scan and resolve:

```bash
ccsync conflicts              # interactive: keep / take remote / skip
ccsync conflicts --auto       # auto-merge shell history, list the rest
```

Shell-history conflicts (`.zsh_history`, `.bash_history`, `~/.claude/history.jsonl`) are auto-merged by timestamp + deduped, never handed back to you for manual resolution.

## How it works under the hood

- Syncthing is started as a background process with its home at the platform default (`~/Library/Application Support/Syncthing` on macOS, `~/.local/state/syncthing` on Linux).
- `~/.ccsync/config.yaml` is the **source of truth** for which buckets are enabled and which paths each bucket covers.
- `ccsync push` reads that YAML and PUT's the resulting folder/device list to Syncthing's REST API.
- A `.stignore` file is written into every active bucket folder containing **global ignores** (`.git/index*`, `node_modules`, etc.) plus per-bucket ignores.

## Hard-coded safety: ignores you can't accidentally turn off

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

For best merge results, use timestamped history. Add to `~/.zshrc`:

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
- Files Syncthing knows are dangerous (the hard-coded `.git/` index/lock patterns) are ignored, so git won't corrupt.
- `~/.claude/projects/<id>/*.jsonl` are append-only — concurrent writes from both machines produce conflict files which you'll see in `ccsync conflicts`.

If you genuinely need to work on both machines at once, lean on `ccsync claim` to broadcast which is "primary" — it's just a JSON file under `~/.ccsync/active.lock` that syncs along with everything else.

## Commands reference

| Command | What it does |
|---|---|
| `ccsync init [--force] [--machine-name <name>]` | Install Syncthing, bootstrap `~/.ccsync/config.yaml`, start daemon |
| `ccsync pair <device-id> [--name <label>]` | Add a peer |
| `ccsync push` | Apply local config to the running Syncthing daemon, trigger rescan |
| `ccsync status [--verbose]` | Peer + folder sync status |
| `ccsync toggle <bucket> [--on\|--off]` | Enable/disable a bucket on this machine |
| `ccsync config [--path]` | Open config in `$EDITOR`, or print the path |
| `ccsync conflicts [--auto]` | Scan and resolve `.sync-conflict-*` files |
| `ccsync claim` | Mark this machine as active |
| `ccsync release [--timeout <s>]` | Wait until 100% in-sync, then release the active flag |

## Roadmap

- v1: launchd / systemd agent for idle-triggered sync; Claude Code exit hook; hotkey integration; encrypted self-hosted relay option.
- v2: Web UI dashboard; bucket templates (frontend dev, backend dev, etc.).

## License

MIT © trananhhh
