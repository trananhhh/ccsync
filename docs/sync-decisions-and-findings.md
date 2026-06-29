# ccsync Sync Decisions and Findings

Last updated: 2026-06-29

## Decisions

- Run Syncthing from a dedicated home at `~/.ccsync/syncthing` with its own device identity, GUI port, and API key, instead of reusing the platform-default Syncthing a user may run themselves. This keeps ccsync fully isolated; legacy configs that still point `syncthing.homeDir` at the shared home are detected on the next run and offered a one-time re-pair migration onto the dedicated home (a new identity, so peers must re-pair).
- Keep one selected code root per profile. Conversation folders are still mapped per project because Claude Code keys history by absolute project path.
- Do not sync the entire `~/.claude` directory as one Syncthing folder. It would overlap with mapped `~/.claude/projects/...` folders and make cross-machine conversation path mapping fragile.
- Treat `claude agents` as background-agent state, not custom agent definitions. Agent definitions live in `~/.claude/agents`; the background-agent list also needs `~/.claude/tasks`, `~/.claude/jobs`, `~/.claude/session-env`, and `~/.claude/file-history`.
- Syncthing folder roots must be directories. Standalone files such as `~/.claude/settings.json`, `~/.claude/CLAUDE.md`, `~/.zsh_history`, and `~/.claude/history.jsonl` need a future file-mirror mechanism; they must not be registered directly as Syncthing folders.
- Older configs should be upgraded on read by adding missing default buckets while preserving user-modified bucket values.

## Findings

- Conversation JSONL files alone are not enough for `claude --resume`; Claude Code also relies on project metadata in `~/.claude.json`.
- Background-agent subagent files under `~/.claude/projects/.../subagents` are not enough for `claude agents --all`; the command reads the agent registry/runtime directories listed above.
- A smoke test between the local machine and `100.116.98.0` proved that copying the four background-agent state directories made the remote `claude agents --json --all` count match the local machine.
- Syncthing logs showed repeated `folder path not a directory` failures for legacy single-file paths. Those failures came from ccsync registering files as folder roots.
- Transport reachability requires both network reachability and a running Syncthing daemon/API. Tailscale reachability alone is not sufficient.

## Fixed

- Added default bucket `claude-agent-state` for `~/.claude/tasks`, `~/.claude/jobs`, `~/.claude/session-env`, and `~/.claude/file-history`.
- Exposed the new background-agent bucket in the setup picker as `Background agents`.
- Removed standalone Claude config files from new `claude-config` defaults.
- Left `shell-history` disabled and empty until a real file-mirror path exists.
- Added a legacy guard so existing configs that still contain known single-file paths do not generate Syncthing folders or `.stignore` targets for them.
- Added config-read upgrade so older installs pick up `claude-agent-state` without requiring a fresh reset.

## Pending

- Productize safe `.claude.json` metadata merging for project/session metadata instead of relying on manual backfill.
- Design a file-mirror mechanism for standalone files if root config files and shell history must be synced.
- Refresh stale `machineName` values on joined machines when the hostname changes.
