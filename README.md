# ccsync

Sync one Claude Code workspace root, selected Claude Code config, and matching conversations across multiple machines.

`ccsync` is built for the case where you move between laptops/desktops and want Claude Code to keep working with the same projects, even when the local workspace path differs per machine.

## Current Model

The important rule: **code sync is root-based**.

You choose one local root on each machine:

```text
Machine A: /Users/alice/work
Machine B: /Users/bob/Coding
```

If both contain a project at the same relative path:

```text
ccsync
```

then ccsync treats them as the same logical project:

```text
Machine A: /Users/alice/work/ccsync
Machine B: /Users/bob/Coding/ccsync
```

Claude Code conversations are mapped to each machine's local Claude project path. This avoids raw-syncing conversation folders for the host machine's absolute path, which can make Claude Code miss conversations on another machine.

## Install

```bash
npm i -g @trananhhh/ccsync
ccsync
```

Node.js 20+ is required.

## First Machine Flow

Run:

```bash
ccsync
```

The setup flow:

1. Installs or verifies Syncthing.
2. Creates a ccsync config at `~/.ccsync/config.yaml`.
3. Starts Syncthing if needed.
4. Asks for one code root to sync.
5. Detects existing Claude Code conversation projects under that root.
6. Configures a stable root profile.
7. Prints an invite command for the next machine.

Example:

```text
Choose one code root to sync.
Code root [/Users/alice/work]: /Users/alice/work

Root profile configured: /Users/alice/work
Mapped 3 Claude conversation project(s)

To add another machine, run this on it:
  npx @trananhhh/ccsync setup ccs1_...
```

## Second Machine Flow

Run the invite command from machine A:

```bash
npx @trananhhh/ccsync setup ccs1_...
```

The join flow:

1. Installs or verifies Syncthing.
2. Adds the host as a peer.
3. Shows the host canonical root.
4. Asks where this root should live on the new machine.
5. Creates the same logical root profile with the new local path.
6. Applies Syncthing folders using stable folder IDs.

Example:

```text
Host canonical root: /Users/alice/work
Choose where this root should live on this machine.
Local root [/Users/alice/work]: /Users/bob/Coding

Root profile mapped to /Users/bob/Coding
```

## Why Conversation Path Mapping Exists

Claude Code stores conversations under `~/.claude/projects/` using the project path as identity.

If machine A opens:

```text
/Users/alice/work/ccsync
```

Claude uses a conversation folder similar to:

```text
~/.claude/projects/-Users-alice-work-ccsync
```

If machine B opens:

```text
/Users/bob/Coding/ccsync
```

Claude expects:

```text
~/.claude/projects/-Users-bob-Coding-ccsync
```

So ccsync does not rely on raw absolute-path conversation folders. It keeps stable logical project IDs from the path relative to the selected root, then maps them to each machine's local Claude path.

## What Gets Synced

| Bucket | Default | Purpose |
| --- | --- | --- |
| `code-root` | on after setup | The one selected code root |
| `claude-config` | on | agents, commands, hooks, rules, skills, settings, CLAUDE.md, keybindings |
| `claude-conversations` | on | conversation folders mapped from relative project paths |
| `claude-worktrees` | on | `~/.claude/worktrees/` |
| `claude-plugins` | off | plugin install state; cache should be reproducible |
| `shell-history` | off | zsh/bash/Claude history |
| `active-projects` | legacy | older per-project path bucket |

## Ignore Rules

The root bucket is protected from common heavy or unsafe paths:

```text
node_modules
.next
.turbo
dist
build
out
.venv
.git/index
.git/*.lock
*.log
.env.local
```

Future work: add `.ccsyncignore` as the user-facing ignore file and compile it into Syncthing `.stignore`.

## Pairing More Machines

Run `ccsync` on an existing machine and choose add-machine from the dashboard, or use:

```bash
ccsync advanced share
```

Then run the printed setup command on the new machine. The invite includes:

- host device ID
- host machine name
- introducer flag
- root profile ID
- canonical root
- project relative paths

The new machine still chooses its own local root.

## Commands

```text
ccsync                         # smart dispatch
ccsync setup [token]           # bootstrap or join
ccsync status [--verbose]      # sync status
ccsync conflicts [--auto]      # conflict resolution
ccsync release [--timeout <s>] # wait until safe to switch

ccsync advanced init
ccsync advanced share
ccsync advanced join <token>
ccsync advanced accept [deviceId]
ccsync advanced push
ccsync advanced sync
ccsync advanced toggle <bucket>
ccsync advanced project add|remove|list|detect
ccsync advanced config
ccsync advanced claim
```

## Current Gaps

- The setup is still prompt-based, not a polished full-screen TUI.
- `.ccsyncignore` is not implemented yet.
- Symlink and mirror conversation adapter modes are not implemented; default direct mapping avoids symlinks.
- Existing Syncthing config ownership is still broad; ccsync should move toward an isolated ccsync Syncthing home/profile.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Do not run `pnpm run dev` if another terminal already owns the dev watcher.

## Release

```bash
npm version patch
git push origin main --follow-tags
```

GitHub Actions verifies the package version, runs tests, publishes to npm, and creates a GitHub Release.

## License

MIT © trananhhh
