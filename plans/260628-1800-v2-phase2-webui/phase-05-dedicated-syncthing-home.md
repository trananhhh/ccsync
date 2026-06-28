---
phase: 5
title: "Dedicated Syncthing home"
status: pending
effort: ""
---

# Phase 5: Dedicated Syncthing home

## Overview

Move ccsync's Syncthing instance off the shared platform-default home onto a
dedicated `~/.ccsync/syncthing` with its own free GUI port, so ccsync never
touches a user's own Syncthing. Switch device-ID discovery to REST (drop the
config.xml regex). Migration is a clean re-pair (no auto-migration). Independent
of the UI phases — can run in parallel.

## Requirements

- Functional: ccsync's daemon runs against `~/.ccsync/syncthing` on a probed free
  loopback port; `--fresh` only ever deletes ccsync's own home (the dangerous
  shared-home confirm prompt from Phase 1 is relaxed/removed); device ID read via
  `GET /rest/system/status.myID`. Existing users are detected and told to re-pair.
- Non-functional: never collide with a user's own Syncthing (default 8384); never
  delete a non-ccsync Syncthing home.

## Architecture

> **Red-team correction (C1):** runtime does NOT read `syncthingHome()` — it reads
> `cfg.syncthing.{homeDir,guiAddress,apiKey}` from `config.yaml` (written at
> `setup.ts:124`; consumed by `ensureConfiguredDaemon`, `ui.ts`, `join.ts`). So
> changing the function alone fixes only NEW `setup`/`--fresh` runs; existing
> configured users keep pointing at the old shared home. Migration MUST rewrite
> config, not just print a warning.

- `src/platform/paths.ts`: `syncthingHome()` → `~/.ccsync/syncthing` becomes the
  DEFAULT used when bootstrapping a fresh home. Runtime still trusts
  `cfg.syncthing.homeDir`.
- **Free port (C2 — probe-once, persist to BOTH):** probe a free loopback port
  ONLY when generating a fresh home (bind `net.createServer()` to `127.0.0.1:0`,
  read `.address().port`, close). Persist the chosen address into BOTH the home's
  `config.xml` `<gui><address>` AND `config.yaml` `syncthing.guiAddress`. NEVER
  re-probe an existing home (re-probing would stale `config.yaml.guiAddress` and
  break every REST call: `apply`, the Phase 2 monitor, `/api/metered`, `release`).
- Bootstrap (`syncthing-bootstrap.ts`): after `generate --home`, write
  `<gui><address>127.0.0.1:<port></address>` + keep `<gui><apikey>` into the
  dedicated home's config.xml before `serve`.
- **Default-folder removal (I3 — ordering):** REST `DELETE /rest/config/folders/default`
  requires the daemon running, so do it AFTER ping (post-`ensureDaemonRunning`),
  NOT before serve. First verify empirically whether current `syncthing generate`
  even creates a default folder (`syncthing generate --home=<tmp>` + inspect);
  skip the delete if absent.
- **Free-port retry (I4):** `ensureDaemonRunning` only pings + throws after 15s; it
  cannot tell "serve failed to bind the GUI port" from "slow start". Add: capture
  the `serve` child exit / bind error → if bind failed, re-probe a new port,
  rewrite config.xml + config.yaml, restart. Cap retries (e.g. 3).
- Identity: keep config.xml parse ONLY for pre-start `apiKey`+`guiAddress` (needed
  to make the first REST call); read `deviceId` from `GET /rest/system/status.myID`
  post-start (drop the device-ID regex). (Addresses spec E5.)
- `--fresh` / `fresh-reset.ts`: now wipes only `~/.ccsync` (which contains
  `syncthing/`); since it's ccsync-owned, relax the typed-confirm to a normal
  step. Still stop the daemon first.
- **Migration (C1 — config rewrite; validated: AUTO-on-next-run + confirm):** on the
  next startup after upgrade, if `cfg.syncthing.homeDir` points at the legacy shared
  home (≠ `~/.ccsync/syncthing`), AUTO-detect and prompt the user to confirm
  migration (clearly stating it changes device identity + forces re-pair). On
  confirm, run a real migration: stop the old daemon → `generate` a fresh home at
  `~/.ccsync/syncthing` (new identity) → probe+persist new port/apiKey/homeDir into
  `config.yaml` → re-bootstrap → warn the user clearly that device identity changed
  and they must re-pair (keep the invite-token flow for fast re-pair). Do NOT copy
  old keys (no fragile identity migration).
  <!-- Updated: Validation Session 1 - migration = auto-detect on next run + confirm -->

## Related Code Files

- Modify: `src/platform/paths.ts` (`syncthingHome()` → `~/.ccsync/syncthing`).
- Modify: `src/core/syncthing-bootstrap.ts` (free-port probe; write gui address/apikey
  to config.xml; delete default folder; `readIdentity` keeps apiKey+guiAddress regex,
  deviceId via REST `myID`).
- Create: `src/core/free-port.ts` (probe a free loopback port).
- Modify: `src/core/fresh-reset.ts` + `src/cli/commands/setup.ts` (relax shared-home
  confirm; reset only ccsync-owned home).
- Modify: any caller using `deviceId` from `readIdentity` before daemon start —
  reorder to fetch `myID` after start (e.g. invite generation in `setup.ts`).
- Test: `tests/core/free-port.test.ts`, `tests/core/syncthing-bootstrap.test.ts`
  (config.xml gui-address write; deviceId-via-REST path with mocked api),
  `tests/platform/paths.test.ts` (new syncthingHome).

## Implementation Steps

1. Add `free-port.ts` (probe-once) + test.
2. Point `syncthingHome()` default at `~/.ccsync/syncthing`; update `paths.test.ts`.
3. Update bootstrap for a FRESH home: probe port once, write `<gui>` address+apikey into config.xml before serve, AND persist `guiAddress`/`homeDir`/`apiKey` into `config.yaml`. Empirically check `syncthing generate --home=<tmp>` for a default folder; if present, `DELETE /rest/config/folders/default` AFTER ping.
4. Add free-port retry: detect serve bind failure → re-probe + rewrite both configs + restart (cap 3).
5. Switch deviceId to REST `myID`; keep apiKey+guiAddress pre-start parse; remove device-ID regex; test.
6. Implement migration (C1): detect legacy `homeDir` in config → stop old daemon → generate fresh home → persist new identity/port to `config.yaml` → re-bootstrap → clear re-pair warning. Gate behind confirmation. Test the config-rewrite logic with mocked fs/api.
7. Relax `--fresh` confirm (ccsync-owned home now); ensure daemon stop-before-wipe still holds.
8. Manual: (a) run ccsync alongside a user's own Syncthing on 8384 → no collision, distinct device IDs, user's home untouched; (b) `--fresh` wipes only `~/.ccsync`; (c) simulate a legacy config → migration rewrites config.yaml + warns re-pair.

## Success Criteria

- [ ] ccsync's daemon uses `~/.ccsync/syncthing` on a probed free port; a user's own Syncthing on 8384 is unaffected.
- [ ] `--fresh` deletes only `~/.ccsync` (never the user's Syncthing home).
- [ ] Device ID comes from REST `myID`; config.xml device-ID regex removed.
- [ ] Legacy users are MIGRATED (config.yaml rewritten to the new home/port/identity) with a clear re-pair warning — not just messaged; tests green.
- [ ] Port is probed once for a fresh home and persisted to BOTH config.xml and config.yaml; existing homes are never re-probed; serve bind failure re-probes (capped).

## Risk Assessment

- **Highest edge-case risk in this plan** (dual-port). Free-port TOCTOU → retry on
  bind failure; confine to loopback.
- Existing paired users WILL need to re-pair (identity changes) — this is the
  accepted decision; make the message unmistakable, don't silently break sync.
- "Default folder" auto-creation varies by Syncthing version — verify empirically
  (step 3) before relying on the DELETE.
- Touches bootstrap shared with all flows — run the full suite + a real pairing
  smoke before merge.
