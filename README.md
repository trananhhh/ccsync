# ccsync

> Sync Claude Code config, conversations, plugins, and active project working trees between machines. **One command.**

```bash
npm i -g @trananhhh/ccsync
ccsync
```

That's it. `ccsync` figures out what to do:

- **First time?** Installs Syncthing, sets up your identity, detects your Claude Code projects, asks one question (`Sync them? [Y/n]`), prints a single command for the next machine.
- **Another machine wants to join?** Asks `Accept? [Y/n]`, applies the config.
- **Everything synced?** Shows a one-line dashboard.

## Quickstart — 2 machines

**On machine A:**

```bash
$ ccsync
First time here — let me set things up.
✓ Syncthing installed
✓ Identity bootstrapped
✓ Daemon started

Detected 3 Claude Code project(s):
  • /Users/you/work/myapp
  • /Users/you/Coding/anby/anby-meeting
  • /Users/you/work/other
Sync them? [Y/n] y
✓ Added 3 project(s)

✓ Ready — you're "macbook-pro"

To add another machine, run this on it:
  npx @trananhhh/ccsync setup ccs1_eyJkZXZpY2VJZCI6Ii...
```

**On machine B**, paste the line you saw on A:

```bash
npx @trananhhh/ccsync setup ccs1_eyJkZXZpY2VJZCI6Ii...
```

**Back on A**, just run `ccsync` again:

```bash
$ ccsync
1 machine(s) want to join:
  linux-desk H7NYZAB-TW67FJW…
    address=tcp://192.168.1.42:22000  seen=…

Accept all? [Y/n] y
✓ Accepted linux-desk
```

Done. They're syncing.

## After setup, `ccsync` shows a dashboard

```
$ ccsync

macbook-pro  •  1/1 peers online  •  4 buckets
✓ All in sync

  [s] status detail  [n] add a machine  [c] conflicts  [r] release & switch  [q] quit
>
```

Press one key, that's it.

## Adding a 3rd, 4th, Nth machine

Same recipe. On any existing machine, press `n` in the dashboard (or run `ccsync` and choose `n`) — it prints a new invite line. Run it on the new machine. Approve on the first one. The first machine acts as an **introducer**, so the new machine discovers all the others automatically.

## What gets synced (defaults)

| Bucket | Default | Files |
|---|---|---|
| `claude-config` | ✅ on | agents, commands, hooks, rules, skills, settings, CLAUDE.md, keybindings |
| `claude-conversations` | ✅ on | `~/.claude/projects/` — transcripts and per-project memory |
| `claude-worktrees` | ✅ on | `~/.claude/worktrees/` |
| `claude-plugins` | ❌ off | reproducible from marketplace |
| `shell-history` | ❌ off | `~/.zsh_history`, `~/.bash_history`, Claude Code history |
| `active-projects` | auto | populated from your Claude Code project list during setup |

To toggle later: `ccsync advanced toggle <bucket>`.

## Before switching machines

Make sure everything has reached the other side:

```bash
ccsync release
# → waits, then: ✓ READY TO SWITCH — all buckets in sync
```

## Safety rails (always on)

- `.git/index`, `.git/index.lock`, `.git/HEAD.lock` etc. are **never** synced — protects your git index from corruption when two machines edit the same repo.
- `node_modules`, `.next`, `dist`, build artifacts skipped — no thrashing.
- Shell-history conflicts (zsh / bash / JSONL) auto-merge by timestamp + dedupe.

## Concurrent editing on 2 machines

Syncthing is eventual-consistency. If both machines edit the same file:

- No data loss — the loser becomes a `.sync-conflict-…` file.
- `ccsync conflicts` auto-merges shell history; for everything else it prompts you to keep local / take remote / skip.

## All commands

```text
ccsync                         # smart dispatch — run this
ccsync setup [token]           # bootstrap a machine
ccsync status [--verbose]
ccsync conflicts [--auto]
ccsync release [--timeout <s>]

ccsync advanced …              # low-level commands
  init, id, share, join, accept, pair, push, sync,
  toggle, project add|remove|list|detect, config, claim
```

## Releasing (for maintainers)

```bash
npm version patch
git push origin main --follow-tags
```

GitHub Actions verifies tag matches `package.json`, runs tests, then publishes to npm with provenance signing and creates a GitHub Release.

Requires `NPM_TOKEN` repo secret (npm.com → Access Tokens → "Automation" type to bypass 2FA in CI).

## License

MIT © trananhhh
