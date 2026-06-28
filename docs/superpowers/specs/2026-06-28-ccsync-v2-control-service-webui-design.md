# ccsync v2 — Control Service + Web UI

Status: approved (brainstorm 2026-06-28)
Owner: trananhhh

## Problem

ccsync's *engine* (root-profile path remapping, layered `.stignore`, REST-driven
Syncthing folder management) is solid. The *interaction layer* is the pain:

- ~20 commands, most of them low-level plumbing exposed as UI.
- Three overlapping pairing paths (`setup <token>`, `advanced join`, `pair` +
  `share`/`accept`) — two mental models coexist (legacy `init/pair/push` vs
  modern `setup/token`).
- Mutations (`toggle`, `project add`, `pair`) do not apply themselves — the user
  must remember to run `ccsync push`. Forgettable, feels dumb.
- No daemon stop / uninstall; `fresh-reset` leaves an orphaned daemon + Syncthing
  home.
- `apply` blindly overwrites the daemon's whole `folders`+`devices` array.
- Silent `catch {}` everywhere → hard to diagnose (hence a whole `diagnose` cmd).
- Dead `shell-history` stub (Syncthing cannot sync single files).
- No way to pause transfers when on a metered/hotspot connection.
- Choosing which folders / which Claude parts to sync is rough on the CLI.

User-stated needs:

- Sync Claude Code config (skills, memories, conversations, agents, settings).
- Sync working repos including uncommitted/untracked changes.
- Near-realtime, 2–3 machines, stop on one machine → continue on another with
  everything intact.
- Config must be easy enough that anyone can use it.
- Toggle sync per folder and per Claude-part, on/off.
- Pause sync (e.g. on mobile hotspot to save data).
- macOS + Linux at minimum.

## Build-vs-reuse decision (researched 2026-06-28)

No existing OSS tool covers Claude config **+** live working trees w/ uncommitted
changes **+** near-realtime **+** easy multi-machine pairing together. The market
splits into snapshot-based Claude-config tools (no realtime, no working trees) and
realtime engines that are Claude-agnostic. Syncthing is the correct engine and is
already in use. Syncthing ships its own web UI plus menubar wrappers
(syncthing-macos, syncthingtray) — so we do **not** build a Syncthing replacement
or a generic folder/device manager.

ccsync's durable value (the moat) is the opinionated orchestration layer:
Claude-aware include/exclude, working-tree-safe `.git` handling, and one-action
multi-machine pairing that hides device/folder IDs. v2 doubles down on that layer
and makes it friendly.

## Approach

Keep the core. Introduce a **UI-agnostic Control Service** that owns all business
logic and exposes a localhost Control API. The Web UI, the slim CLI, and a future
TUI are all thin clients of that one API. Decision form-factor: **local web UI**
(`ccsync ui` → opens browser), router-style setup wizard.

## Architecture (3 layers)

```
CLIENTS (thin, replaceable)
  Web UI (React + shadcn/ui, bundled static)   [now]
  Slim CLI (setup / ui / status / service)     [now]
  TUI                                          [future]
        │  HTTP localhost  (Control API: JSON + SSE)
CONTROL SERVICE (new) — the single brain
  - read/write config.yaml, call applier, control pause/metered
  - stream realtime status (polls Syncthing /rest/events)
        │  reuses unchanged
CORE (kept) — config-io · applier · syncthing-api · root-profile ·
              stignore · history-merge · invite-token …
        │  REST :8384
SYNCTHING (P2P, fs-watch realtime)
```

Principle: all behavior lives in the Control Service. Clients never talk to
Syncthing directly; they call the Control API. This is what leaves room for a TUI
later without rewriting logic.

## Control API (localhost only)

Bind to `127.0.0.1` on an ephemeral/config port. Auth with a local token stored in
`~/.ccsync` (sent as a header); reject cross-origin writes. Endpoints:

- `GET  /api/state` — config + status of every bucket/folder/peer.
- `GET  /api/events` (SSE) — realtime stream: progress, ↑/↓ bytes, which machine is
  active, new conflicts, pause/metered state changes.
- `POST /api/toggle` `{target, on}` — enable/disable a bucket or folder **and
  auto-apply immediately** (no separate `push`).
- `POST /api/pause` `{scope: "all"|"folder", target?, on}` — pause/resume transfers
  (daemon stays running; transfers stop).
- `POST /api/metered` `{on}` — hotspot mode: one action pauses all transfers,
  remembers state, drives a warning badge in the UI.
- `POST /api/pair/invite` → `{token, qr}`; `POST /api/pair/join` `{token}`.
- `GET  /api/folders/browse?path=` — directory tree for click-to-select folders.
- `POST /api/conflicts/resolve` `{file, action}`.
- `POST /api/handoff/release` — safe-to-switch barrier (wait until synced).

All mutating endpoints auto-apply and return the new state. Errors are returned as
structured JSON (no silent swallowing) and surfaced in the UI.

## Web UI (router-style)

- `ccsync` (no config) or `ccsync ui` → start the service + open
  `http://127.0.0.1:<port>`.
- **Setup wizard** (first run, like configuring a router): (1) check/install
  Syncthing → (2) name this machine → (3) paste a token *or* "Create first machine"
  → (4) pick the code root + tick folders via a directory-tree picker → (5) tick
  which Claude parts to sync. No folder/device IDs shown.
- **Dashboard**: list of buckets/projects with on/off toggles; a
  **⏸ Pause all [hotspot]** control; a status bar with ↑/↓ throughput and "which
  machine is active"; a conflict indicator; a "Safe to switch machine" (release
  handoff) button.
- **Pairing**: "Add machine" → shows the token + a QR code to scan/paste on the
  other machine.

## Slim CLI (after cleanup)

Keep only:

- `ccsync` / `ccsync ui` — open the dashboard.
- `ccsync setup <token>` — headless pairing for a Linux server with no browser.
- `ccsync status` — quick terminal view (headless/CI).
- `ccsync service start|stop` — manage the daemon (fills the current "no stop" gap).

Remove the legacy commands: `init`, `pair`, `share`, `accept`, `claim`, `push`,
`sync`, `toggle`, `project`, `id`, `config`. Their behavior is absorbed by the
Control Service (auto-applied) and reachable via the Web UI / slim CLI.

## Reliability fixes (folded in — addresses the "trust" pain)

1. Auto-apply on every mutation; eliminate the manual `push` step.
2. `apply` merges only ccsync-owned folders (those with the `ccsync-` id prefix);
   it preserves folders the user added in Syncthing's own GUI instead of wiping
   them.
3. A real daemon stop; `fresh-reset` also cleans the Syncthing home + any orphaned
   daemon.
4. Drop the dead `shell-history` single-file stub (or convert it to sync the
   containing directory).
5. Replace `config.xml` regex scraping with reading identity via REST after start.
6. Surface errors (no silent `catch {}`) — show them in the UI and in `status`.

## Build & packaging

- Web UI lives in a separate Vite project (`ui/`); `pnpm build:ui` bundles static
  assets into `dist/ui/`.
- React / shadcn / Vite are **devDependencies only**. The runtime CLI just serves
  static files + runs a small HTTP server using Node built-ins — no heavy runtime
  dependency added.
- Realtime via SSE from the service; the service polls Syncthing `/rest/events`.

## Testing

- Core: keep existing tests (applier, config-io, syncthing-config, …) green.
- Control Service: unit-test API handlers against a mocked Syncthing API.
- Web UI: component tests for toggle + wizard (Vitest + Testing Library); one e2e
  happy-path (pair → toggle → pause).

## Phasing

- **Phase 1** — Control Service + Control API + CLI cleanup + reliability fixes (E).
- **Phase 2** — Web UI dashboard + pause/metered.
- **Phase 3** — setup wizard + pairing QR + folder browser.

## Out of scope (YAGNI)

- Native menubar/tray app (Syncthing wrappers already exist; revisit only if the
  web UI proves insufficient).
- Replacing Syncthing's own management UI.
- Windows install automation (manual install remains supported).
- TUI client (architecture leaves room; not built now).
