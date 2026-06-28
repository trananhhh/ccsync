# ccsync v2 — Phase 2 backlog

Carried over from Phase 1 (control service + reliability). Each item gets a real
plan when Phase 2 starts.

## Web UI (the main Phase 2 deliverable)
- Replace the placeholder page (`src/service/ui-placeholder.ts`) with the
  React + shadcn/ui SPA built by Vite into `dist/ui/`; the runtime already
  serves `/` and forwards `/api/*` on one port.
- SSE `GET /api/events`: poll Syncthing `connections` + per-folder
  `folderStatus` + `/rest/events`; stream throughput, active machine, new
  conflicts, pause/metered changes.
- Dashboard: bucket/project toggles, ⏸ Pause all [hotspot], status bar,
  conflict indicator, "Safe to switch machine" (release handoff).
- Setup wizard (router-style) + pairing QR + folder-browse endpoint
  (`GET /api/folders/browse`).

## Dedicated Syncthing home (decided 2026-06-28)
Move ccsync off the platform-default SHARED Syncthing home to its own
`~/.ccsync/syncthing`, so `--fresh` and the daemon never touch a Syncthing
instance the user runs for other folders.
- Touches: `src/platform/paths.ts` (`syncthingHome()`), `syncthing-bootstrap.ts`,
  fresh-reset, and the GUI port (must not collide with a user's own daemon).
- Migration: device identity moves → existing pairings must re-pair. Provide a
  one-time migration or clear messaging.
- Interim mitigation already shipped in Phase 1: `--fresh` now asks for typed
  confirmation before deleting the Syncthing home (`setup.ts`).

## Reliability follow-ups (from final review)
- `src/service/server.ts`: `req.destroy()` on oversize body; return 400/413 for
  malformed JSON / oversize instead of 500; add tests for `/api/pause`, the 404
  fall-through, wrong-token, and malformed JSON.
- `mergeDevices` preserves foreign devices only on non-pause applies; `applyPause`
  sweeps all devices including foreign. Decide whether foreign devices should be
  exempt from metered pause.
- `applyFolderPause` + `setFolderPaused` (`sync-control.ts`) are built but unused
  — wire them when per-folder pause lands in the UI; cover with tests then.
- Replace the `config.xml` regex identity scrape (spec E5) with a robust read.

## CLI cleanup (spec D, deferred from Phase 1)
- Once the Web UI covers daily use, remove the legacy commands
  (`init/pair/share/accept/claim/push/sync/toggle/project/id/config`); keep
  `ccsync` / `ui` / `setup <token>` / `status` / `service`.
- Update README to the v2 model.
