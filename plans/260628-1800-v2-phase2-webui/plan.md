---
title: "ccsync v2 Phase 2 — Web UI, onboarding, dedicated home, polish"
description: ""
status: pending
priority: P2
branch: "feat/v2-phase2-webui"
tags: []
blockedBy: []
blocks: []
created: "2026-06-28T12:05:49.326Z"
createdBy: "ck:plan"
source: skill
---

# ccsync v2 Phase 2 — Web UI, onboarding, dedicated home, polish

## Overview

Phase 2 of ccsync v2. Phase 1 (merged to `main`) shipped the Control Service
(localhost API), pause/metered, reliability fixes, and `ccsync ui` serving a
placeholder. Phase 2 delivers the real value the user asked for — "config thật
dễ ai cũng dùng được": a React+shadcn Web UI, realtime status via SSE, a
router-style onboarding wizard, friendly pairing, a dedicated Syncthing home
(so ccsync never touches a user's own Syncthing), and server/CLI polish.

Design source: `docs/superpowers/specs/2026-06-28-ccsync-v2-phase2-design.md`.
Supersedes the backlog `docs/superpowers/plans/2026-06-28-ccsync-v2-phase2-backlog.md`.

**Brutal-honest note:** captured as one plan per the user's choice, but the six
phases are independent slices — implement and review them in order, do not land
as one cross-cutting change. The Phase 1 final review caught a CRITICAL bug
exactly because pause/apply was reviewed end-to-end; keep that discipline here
(especially Phase 2's SSE↔state and Phase 5's dual-port).

## Decisions (locked in brainstorm 2026-06-28)

- Realtime = **SSE** (`GET /api/events`), one-way server→client.
- Pairing = **token + Copy button, no QR** (desktop↔desktop; YAGNI).
- SPA write auth = service **injects token into served HTML** (`window.__CCSYNC_TOKEN__`);
  SSE auth = **`?token=` query param** (EventSource cannot set headers).
- Dedicated home migration = **clean re-pair** (no fragile auto-migration).
- UI deps (React/Vite/Tailwind/shadcn) are **devDependencies only**; only built
  static `dist/ui/**` ships. tsup entry stays `src/cli` — no `src/` import of `ui/src`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Build pipeline + SPA shell](./phase-01-build-pipeline-spa-shell.md) | Pending |
| 2 | [SSE realtime feed](./phase-02-sse-realtime-feed.md) | Pending |
| 3 | [Dashboard](./phase-03-dashboard.md) | Pending |
| 4 | [Onboarding wizard + pairing](./phase-04-onboarding-wizard-pairing.md) | Pending |
| 5 | [Dedicated Syncthing home](./phase-05-dedicated-syncthing-home.md) | Pending |
| 6 | [Hardening + CLI cleanup](./phase-06-hardening-cli-cleanup.md) | Pending |

## Dependencies

- Builds on Phase 1 (merged to `main`): Control Service (`src/service/*`),
  `apply`/`applyAndSave`, `SyncthingApi`, `ensureServiceToken`, root-profile.
- Supersedes `docs/superpowers/plans/2026-06-28-ccsync-v2-phase2-backlog.md`.
- No blocking cross-plan relationships (older `plans/260620-*`, `plans/260622-*`
  are superseded prior work).
- Internal phase order: 1→2→3 (UI core), 4 (onboarding, needs SPA shell from 1
  + folder-browse), 5 (infra, independent of UI), 6 (polish, last). 5 may run in
  parallel with 1-4 by a separate implementer (no file overlap with UI).

## New API surface (added this plan)

| Endpoint | Phase | Notes |
|----------|-------|-------|
| `GET /api/events?token=` (SSE) | 2 | one-way status stream |
| `GET /api/conflicts` · `POST /api/conflicts/resolve` | 3 | reuse conflicts-scanner |
| `POST /api/handoff/release` | 3 | reuse `release` logic |
| `GET /api/folders/browse?path=` | 4 | directory tree for picker |
| `POST /api/pair/invite` → `{token}` · `POST /api/pair/join {token}` | 4 | reuse encodeInvite/handleJoin |

All POSTs token-gated (`x-ccsync-token`); SSE uses `?token=`; GETs loopback-only.

## Red-team pass (resolved into the phases)

`--hard` adversarial review verified the plan against actual code and found
blocking gaps; all reconciled in the phase files:

- **C1 (Phase 5):** changing `syncthingHome()` is a no-op for already-configured
  users (runtime reads `cfg.syncthing.homeDir`). Migration is now a real config
  rewrite (regen identity → persist new home/port → re-pair), not a warning.
- **C2 (Phase 5):** probe the free port ONCE for a fresh home, persist to BOTH
  config.xml and config.yaml, never re-probe an existing home.
- **C3 (Phase 4):** UI pairing needs the inviting service to run
  `watchAndAutoAccept`, else the pending device is never admitted. Added + lifecycle
  documented (keep service running during the invite window).
- **C4 (Phase 2/3):** no cross-machine "active machine" source (`active.lock` is
  local/unsynced) → dashboard shows connected peers; `activeMachine` removed from
  the payload.
- **I1 (Phase 2):** SSE payload `folders[].bucket` added so dashboard rows bind to
  live state; payload contract frozen.
- **I2 (Phase 4):** `joinWithToken` takes `localRoot` as a param (no TTY prompt in
  the service).
- **I3/I4 (Phase 5):** default-folder delete moved to after-ping; free-port retry
  on serve bind failure specified.
- **I5 (Phase 6):** `advanced` group already exists — rescoped to readJson
  hardening + the fate of top-level `conflicts/release/diagnose` + README.
- **I6 (Phase 3):** handoff extraction = pure abortable `waitUntilSynced`; lock
  side-effect + exitCode stay in the CLI; abort on request close; no 300s block.
- Nits: stable service port + reuse-running-service (Phase 1), token-inject
  fail-loud, SSE auth threat model recorded.

## Validation Log

### Session 1 (2026-06-29) — critical-questions interview

Verification pass skipped: red-team already verified claims against code (see
"Red-team pass"). 4 open decision points resolved:

1. **Phase 5 migration UX** → AUTO-detect legacy home on next run + confirm prompt,
   then rewrite config + warn re-pair. (Not a separate `migrate` command; not
   "new machines only".) Propagated to phase-05.
2. **Phase 4 auto-accept lifecycle** → accept the constraint that the inviting
   machine keeps `ccsync ui`/service open during the invite window (dashboard shows
   "waiting to join"). No always-on background daemon this phase (that's a possible
   Phase 2.5). Already reflected in phase-04.
3. **Phase 6 CLI** → KEEP `conflicts`/`release`/`diagnose` top-level (headless
   escape hatches; UI is additive). Propagated to phase-06.
4. **Phase 1 service port** → probe a free port ONCE + persist to `service-url`,
   reuse thereafter (no hardcoded default). Propagated to phase-01.

### Whole-Plan Consistency Sweep
Re-read all phase files after propagation. No stale terms / contradictions:
payload contract (frozen, `folders[].bucket`, no `activeMachine`) consistent across
phase-02/03; migration is config-rewrite consistently in phase-05 + plan summary;
port strategy consistent phase-01; CLI fate consistent phase-06. Zero unresolved
contradictions.
