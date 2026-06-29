# ccsync v2 Phase 2 — Web UI + Onboarding + Dedicated Home + Polish

Status: approved (brainstorm 2026-06-28)
Owner: trananhhh
Supersedes the backlog at `docs/superpowers/plans/2026-06-28-ccsync-v2-phase2-backlog.md`.

## Problem

Phase 1 shipped the Control Service (localhost API), pause/metered, reliability
fixes, and `ccsync ui` serving a placeholder page. The user's core goal —
"config thật dễ ai cũng dùng được" (anyone can configure it easily) — is not yet
delivered: there is no real UI, no realtime status, no friendly onboarding, and
`--fresh` still wipes the shared system Syncthing home (mitigated by a confirm
prompt only).

## Scope decision

The user chose to capture all of Phase 2 in ONE spec (warned: large). To keep
implementation reviewable, this spec is internally decomposed into six ordered
workstreams (A→F). The plan MUST phase by workstream and review each slice;
do not implement as one undifferentiated change.

## Decisions (brainstorm 2026-06-28)

- **Realtime:** Server-Sent Events (`GET /api/events`). One-way server→client is
  enough; all mutations already go through POST. Not WebSocket (overkill), not
  bare polling (wasteful).
- **Pairing UX:** token + Copy button + ready-to-paste command. **No QR** — this
  is desktop↔desktop for 2-3 machines; QR adds no value without a mobile
  companion (YAGNI).
- **SPA auth for writes:** the service injects the service token into the served
  HTML (`window.__CCSYNC_TOKEN__`) since it is localhost-only and the user
  already has filesystem access to the token. The SPA reads it; the user never
  pastes anything.
- **Dedicated-home migration:** clean re-pair. Moving to `~/.ccsync/syncthing`
  changes the device identity; existing pairings die. No fragile auto-migration —
  warn clearly and let the user re-pair (keep the token for speed).

## Tech stack

- `ui/` workspace: Vite + React + Tailwind + shadcn/ui. Built static into
  `dist/ui/`. React / shadcn / Vite / Tailwind are **devDependencies only**; the
  runtime CLI serves static files (no new runtime dependency).
- Client data: `EventSource` for the SSE feed + a thin `fetch` API client. Keep
  state minimal; add TanStack Query only if genuinely needed.
- `package.json` `build` = `build:ui && tsup`; dev = `vite dev` with `/api`
  proxied to the running service.

## Workstreams

### WS-A — Build pipeline + SPA shell
- Create `ui/` (Vite + React + Tailwind + shadcn). `pnpm build:ui` → `dist/ui/`.
- `runtime.ts`: serve `dist/ui/index.html` (replacing `ui-placeholder.ts`) +
  `dist/ui/assets/*`; inject `window.__CCSYNC_TOKEN__` into the HTML at `/`
  (read via `ensureServiceToken`). Keep the single-port `/api/*` forwarder.
- Acceptance: `ccsync ui` opens the real SPA; POST works via the injected token.

### WS-B — SSE realtime feed
- `GET /api/events` (SSE): poll Syncthing (`connections`, per-folder
  `folderStatus`, `/rest/events`) and stream
  `{throughput, activeMachine, folderStates, conflicts, metered}` at ~1s.
  Backpressure-safe; clean up on client disconnect.
- Client `EventSource` hook drives live dashboard updates.
- Acceptance: a state change on another machine reflects in the dashboard in
  under ~2s without reload.

### WS-C — Dashboard (the heart)
- Main screen: list of buckets + projects with on/off toggles (`POST /api/toggle`,
  auto-apply); **⏸ Pause all [hotspot]** (`POST /api/metered`); status bar with
  ↑/↓ throughput and which machine is active; a conflicts indicator + resolve
  (needs `GET /api/conflicts` + `POST /api/conflicts/resolve`); a "Safe to switch
  machine" button (`POST /api/handoff/release`, reusing the existing `release`
  logic).
- shadcn: Card, Switch, Dialog, Badge, Sonner (toasts).
- Acceptance: toggle each Claude part and each project by click; one-button
  hotspot pause; clear view of what is syncing.

### WS-D — Onboarding wizard + pairing
- First-run wizard (router-style) in the SPA: (1) check/install Syncthing →
  (2) name this machine → (3) "Create first machine" or paste a token →
  (4) pick the code root + tick folders via `GET /api/folders/browse?path=`
  (directory tree) → (5) tick which Claude parts to sync.
- Pairing: "Add machine" modal → `POST /api/pair/invite` returns the token →
  show token + Copy + ready-to-paste command (no QR). Join via
  `POST /api/pair/join {token}` (reuse `handleJoin`).
- Acceptance: a new machine is configured without ever seeing device/folder IDs.

### WS-E — Dedicated Syncthing home (re-pair)
- `syncthingHome()` → `~/.ccsync/syncthing`; bootstrap/serve use it; pick a
  dedicated GUI port (probe for a free one so it never collides with a user's own
  Syncthing daemon).
- `--fresh` now only touches ccsync's own instance (the dangerous shared-home
  confirm prompt can be relaxed/removed).
- Migration: clean re-pair — detect an old home, warn clearly ("identity changes,
  re-pair required"), keep the token for a fast re-pair. No auto-migration.
- Acceptance: a user running their own Syncthing for other folders is never
  touched by ccsync.

### WS-F — Hardening + CLI cleanup
- Server: `req.destroy()` on oversize body; return 400/413 instead of 500 for
  malformed/oversize input; add tests for `/api/pause`, the 404 fall-through,
  wrong-token, malformed JSON, and the SSE endpoint.
- CLI: move legacy commands (`init/pair/share/accept/claim/push/sync/toggle/
  project/id/config`) under a hidden `advanced` group (do not hard-delete yet —
  avoid breaking muscle memory); update README to the v2 model.
- Replace the `config.xml` regex identity scrape with a REST read after start
  (spec E5).

## New API surface (added this phase)

- `GET /api/events` (SSE)
- `GET /api/conflicts` ; `POST /api/conflicts/resolve {file, action}`
- `POST /api/handoff/release`
- `GET /api/folders/browse?path=`
- `POST /api/pair/invite` → `{token}` ; `POST /api/pair/join {token}`

All POSTs remain token-gated; GETs stay loopback-only.

## Risks

- shadcn/Tailwind add a build toolchain (PostCSS, Tailwind config) — acceptable
  (static output) but more to maintain. Stack chosen in Phase 1; kept.
- Dual-port (WS-E) free-port probing is the most edge-case-prone piece.
- "One spec" is large — the plan MUST phase A→F and review each slice. This is
  the explicit mitigation for the kind of cross-cutting bug the Phase 1 final
  review caught.

## Success criteria

- A non-expert can open `ccsync ui`, run the wizard, pair a second machine, and
  toggle/pause sync — without touching the CLI or seeing Syncthing internals.
- Stopping work on machine A and resuming on machine B shows everything synced,
  with a clear "safe to switch" signal.
- `--fresh` and the daemon never affect a user's non-ccsync Syncthing setup.

## Out of scope

- Mobile companion app / QR pairing.
- Hard-deletion of legacy CLI commands (only hidden under `advanced` this phase).
- Per-folder pause UI (bucket/project-level toggle is enough for MVP).
- Windows install automation.
