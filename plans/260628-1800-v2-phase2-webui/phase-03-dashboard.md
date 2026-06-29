---
phase: 3
title: "Dashboard"
status: pending
effort: ""
---

# Phase 3: Dashboard

## Overview

Build the main dashboard screen — the daily-use surface. Lists buckets + projects
with toggles, a hotspot pause button, a live status bar, conflict handling, and a
"safe to switch machine" action. Consumes the SSE feed (Phase 2) for live state.

## Requirements

- Functional: toggle each bucket/project on/off (auto-applies); one-click
  **Pause all [hotspot]**; status bar with ↑/↓ throughput + **connected peers**
  (NOT "active machine" — see C4 below); per-row live sync state bound via
  `folders[].bucket`; conflict indicator that lists conflicts and lets the user
  resolve each; a "Safe to switch machine" button that waits until 100% in-sync
  then signals OK.

> **Red-team corrections:** (C4) there is no cross-machine "active machine" data
> source (`active.lock` is local, unsynced) — the status bar shows connected peers
> from `devices[].connected` instead. (I1) bind each dashboard row to live state
> via the FROZEN Phase-2 payload `folders[].bucket` field; do not invent a mapping.
> (I6) the handoff extraction has side-effects + a 300s loop — see Architecture.
- Non-functional: state is driven by the SSE feed (no polling); actions are
  optimistic-then-reconciled by the next SSE push; accessible (keyboard, reduced motion).

## Architecture

- New server endpoints (in `server.ts`, all reuse existing core):
  - `GET /api/conflicts` → reuse `conflicts-scanner.ts` to list `.sync-conflict-*` files.
  - `POST /api/conflicts/resolve {file, action:"keep-local"|"keep-remote"|"skip"}` → reuse `conflicts.ts` resolve logic.
  - `POST /api/handoff/release` → reuse the `release` wait logic. **I6:** the
    extraction must (a) SEPARATE the `removeActiveLock()` side-effect + `exitCode`
    from the pure wait loop (the endpoint should not touch `process.exitCode`),
    (b) NOT block the request thread for the full 300s — return quickly and let the
    SPA poll, or stream progress over SSE, with a bounded timeout, and (c) abort the
    wait loop on `req.on("close")` so a closed tab leaves no running loop.
- Client (`ui/src/`):
  - `useEventSource("/api/events?token=…","state")` hook → drives the whole screen.
  - `api.ts` `post()` for toggle/metered/pause/conflicts/handoff.
  - Components (shadcn): `BucketList` (Card + Switch), `MeteredButton` (toggle → `/api/metered`),
    `StatusBar` (throughput + connected-peer Badges from `devices[].connected`), `ConflictsPanel` (Dialog + list + resolve),
    `HandoffButton` (calls release, shows progress, Sonner toast on safe).
- shadcn components to add: card, switch, dialog, badge, button, sonner.

## Related Code Files

- Create: `ui/src/hooks/useEventSource.ts`, `ui/src/components/{BucketList,MeteredButton,StatusBar,ConflictsPanel,HandoffButton}.tsx`, `ui/src/pages/Dashboard.tsx`.
- Modify: `ui/src/App.tsx` (route to Dashboard when configured), `ui/src/lib/api.ts`.
- Modify: `src/service/server.ts` (conflicts + handoff routes).
- Create: `src/service/handoff.ts` (extract release-wait logic shared with CLI `release`), refactor `src/cli/commands/release.ts` to reuse it (DRY).
- Test: `tests/service/server.test.ts` (new routes incl. auth), `tests/service/handoff.test.ts` (release-wait with mocked folderStatus).

## Implementation Steps

1. Extract the `release` WAIT loop into `src/service/handoff.ts` as a pure
   `waitUntilSynced(api, { timeoutMs, signal })` (no lock side-effect, no exitCode,
   abortable); refactor CLI `release.ts` to call it AND keep its `removeActiveLock()`
   + exitCode behavior in the CLI layer; test the wait loop with mocked folderStatus + an abort.
2. Add `GET /api/conflicts`, `POST /api/conflicts/resolve`, `POST /api/handoff/release` to server; test (auth + happy path).
3. Build `useEventSource` hook + wire `Dashboard.tsx` to render live state.
4. Build `BucketList` + `MeteredButton` (toggle/metered POST, reconcile via SSE).
5. Build `StatusBar` (throughput, connected peers) + `ConflictsPanel` (list + resolve) + `HandoffButton`.
6. Manual: two-machine smoke — toggle on A reflects on B's dashboard; create a conflict, resolve via UI; pause hotspot; release shows "safe".

## Success Criteria

- [ ] Toggling any bucket/project and the hotspot pause work from the UI and auto-apply.
- [ ] Status bar shows live ↑/↓ + connected peers, updating from SSE without reload; each row's sync state is bound via `folders[].bucket`.
- [ ] Conflicts are listed and resolvable from the UI; resolution reflects on next push.
- [ ] "Safe to switch" reports when 100% in-sync; server endpoints token-gated; tests green.

## Risk Assessment

- Optimistic UI vs SSE reconcile drift → treat SSE as source of truth; actions only fire POST, never mutate local state directly.
- Conflict resolve is destructive → confirm in a Dialog before applying; never auto-resolve non-history conflicts.
- Handoff endpoint can be long-running → stream progress or return quickly with a poll, don't block the request thread indefinitely (cap with a timeout like the CLI `--timeout`).
