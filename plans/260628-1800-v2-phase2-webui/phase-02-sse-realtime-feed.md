---
phase: 2
title: "SSE realtime feed"
status: pending
effort: ""
---

# Phase 2: SSE realtime feed

## Overview

Add a realtime status stream so the dashboard updates live. The service runs a
Syncthing events long-poll loop + periodic status sampling, derives a compact
state object, and pushes it to connected SPA clients over SSE.

## Requirements

- Functional: `GET /api/events?token=<t>` returns `text/event-stream`; on connect
  it pushes an initial snapshot, then pushes updates whenever sync state changes
  (≤~1-2s latency).
- **FROZEN payload contract (consumed verbatim by Phase 3 — do not drift):**
  ```
  {
    throughput: { up: number, down: number },          // bytes/sec, computed by diffing totals
    devices: [{ id, name, connected: boolean, paused: boolean }],
    folders: [{ id, bucket: string, label, state, completion: number, needBytes }],
    conflicts: number,
    metered: boolean
  }
  ```
  - `folders[].bucket` (I1): the owning bucket/project name, derived from the
    folder id (`ccsync-<bucket>-<idx>` / `ccsync-root-*` / `ccsync-code-*` /
    `ccsync-conv-*` → map back to the config bucket). This is how Phase 3 binds
    live folder state to its bucket/project toggle rows. Provide a helper
    `bucketForFolderId(id, cfg)` in `applier.ts`/`syncthing-config.ts`.
  - **No `activeMachine` field (C4):** "which machine is actively being worked on"
    is `active.lock`, a LOCAL file in `~/.ccsync` that is NOT in any synced bucket,
    so no machine can know another's lock. The dashboard uses **connected peers**
    (`devices[].connected`) instead. A real cross-machine "active" signal (sync the
    lock into a bucket, or write a heartbeat file under a synced root) is a
    follow-up, explicitly out of scope here.
- Non-functional: heartbeat keep-alive; cleanup on client disconnect (no leaked
  timers/loops); a single shared Syncthing poll feeding all clients (don't open one
  events loop per client).

## Architecture

- New `src/service/sync-monitor.ts`: a singleton-ish monitor that
  (a) long-polls `GET /rest/events?since=<id>&timeout=30&events=FolderSummary,StateChanged,DownloadProgress,DeviceConnected,DeviceDisconnected,FolderPaused,FolderResumed`
  tracking the max `id` (re-baseline with `?limit=1` after daemon restart / globalID gap),
  (b) samples `GET /rest/system/connections` (per-device `connected/paused/in,outBytesTotal` + `total`)
  and `GET /rest/db/completion?folder=` (`completion` %) + `GET /rest/db/status?folder=` (`state`,`needBytes`,`pullErrors`),
  (c) computes throughput rate by diffing `total.in/outBytesTotal` across two samples / time delta,
  (d) counts conflicts via the existing filesystem `conflicts-scanner.ts` (no REST endpoint exists),
  (e) emits a derived state object to subscribers.
- New `src/service/sse.ts`: `openSse(req,res)` → sets `text/event-stream`,
  `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`; writes `:ok\n\n`;
  `send(event,data)` writes `event:..\ndata:JSON\n\n`; 15s `:hb\n\n` heartbeat;
  clears interval + unsubscribes on `req.on("close")`.
- `server.ts`: add `GET /api/events` branch BEFORE the JSON 404 fallthrough; auth via
  `url.searchParams.get("token") === deps.token` (EventSource can't send headers) → 401 else;
  subscribe the connection to the monitor, push initial snapshot.
- Extend `SyncthingApi` (`src/core/syncthing-api.ts`): add `events(since,timeout,types)`,
  `completion(folderId,deviceId?)`; extend `ConnectionInfo` with `paused,isLocal,type` +
  parse `total`; extend `FolderStatus` with `pullErrors,needDeletes`.

## Related Code Files

- Create: `src/service/sse.ts`, `src/service/sync-monitor.ts`.
- Modify: `src/core/syncthing-api.ts` (events/completion methods; widen interfaces).
- Modify: `src/service/server.ts` (`/api/events` route + token query auth).
- Modify: `src/service/runtime.ts` (instantiate the monitor, pass to server deps; stop on close).
- Test: `tests/service/sse.test.ts` (SSE framing: headers, `data:\n\n`, heartbeat, close cleanup),
  `tests/service/sync-monitor.test.ts` (throughput diff math, derived-state shape, re-baseline on gap),
  `tests/core/syncthing-api.test.ts` (events/completion request URLs via fetch mock).

## Implementation Steps

1. Extend `SyncthingApi` with `events()` + `completion()` and widen `ConnectionInfo`/`FolderStatus`; test request URLs + parsing via fetch mock.
2. Implement `sse.ts` `openSse` writer; unit-test framing + heartbeat + close cleanup with a fake `ServerResponse`.
3. Implement `sync-monitor.ts`: poll loop + status sampling + throughput diff + derived-state emit; inject `SyncthingApi` + a scanner fn for testability; test the pure derivation (throughput rate, gap re-baseline).
4. Wire `GET /api/events` in `server.ts` (query-token auth) + subscribe to monitor; push initial snapshot.
5. Start/stop the monitor in `runtime.ts`; ensure one shared loop, stopped on server close.
6. Manual smoke: open `ccsync ui`, `curl -N "http://127.0.0.1:<port>/api/events?token=<t>"` → see initial + heartbeat; toggle a bucket → see a state push.

## Success Criteria

- [ ] `GET /api/events?token=` streams an initial snapshot + heartbeats; wrong/missing token → 401.
- [ ] A state change (toggle, pause, peer connect) pushes an updated payload within ~2s.
- [ ] Throughput up/down rates are computed (not raw totals); folder `completion` % present.
- [ ] Client disconnect stops its heartbeat; only one Syncthing events loop runs regardless of client count.
- [ ] New tests green; `pnpm typecheck`/`lint` clean.

## Risk Assessment

- Proxy/compression buffering breaks SSE → `no-transform`, no compression layer (ccsync has none), `X-Accel-Buffering:no`.
- Missing trailing `\n\n` → client never fires; covered by sse.test.
- Events `since`/`globalID` gap after daemon restart → re-baseline via `?limit=1`.
- Default Syncthing events filter excludes Local/RemoteChangeDetected — fine (we use FolderSummary/completion, not change events).
- SSE auth threat model: token in `?token=` is non-constant-time compared and lives
  in the URL — acceptable because the service is loopback-only and the token file is
  `0600`; `EventSource` requests don't leak the URL to referer/history. Record this
  rationale; revisit only if the service ever binds beyond 127.0.0.1.
