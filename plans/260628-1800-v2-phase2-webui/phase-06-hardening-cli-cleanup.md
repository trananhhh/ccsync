---
phase: 6
title: "Hardening + CLI cleanup"
status: pending
effort: ""
---

# Phase 6: Hardening + CLI cleanup

## Overview

Final polish: harden the Control API surface (proper error codes, body limits,
test coverage gaps from the Phase 1 final review), tidy the CLI to the v2 model
(legacy commands hidden under `advanced`), and update docs. Runs last.

## Requirements

- Functional: malformed JSON → 400, oversize body → 413 + `req.destroy()`;
  legacy CLI commands still work but are grouped under `ccsync advanced`; README
  documents the v2 Web-UI-first model.
- Non-functional: no behavior regressions; the new error codes are tested; the
  primary commands (`ccsync`, `ui`, `setup`, `status`, `service`) stay top-level.

## Architecture

> **Red-team correction (I5):** the `advanced` group ALREADY exists
> (`src/cli/index.ts:81-157` groups `init/id/share/join/accept/pair/push/sync/
> toggle/project/config`). The "move legacy under advanced" headline is largely a
> no-op. The real open question is the fate of three commands still TOP-LEVEL:
> `conflicts`, `release`, `diagnose` — now that the UI covers conflicts + handoff.
> Rescope this phase to: (1) server hardening, (2) decide those three, (3) README.

- `src/service/server.ts`: in `readJson`, on oversize `req.destroy()` and reject
  with a typed error; map malformed JSON → 400, oversize → 413 (instead of the
  catch-all 500). Keep the 1MB cap.
- CLI (`src/cli/index.ts`): audit that all legacy commands sit under `advanced`
  (most already do). **Validated decision: KEEP `conflicts`/`release`/`diagnose`
  top-level** as power-user/headless escape hatches (the UI is additive, not a
  replacement; headless Linux servers have no browser). Do NOT hard-delete anything.
  Keep `ccsync`,`ui`,`setup`,`status`,`service` top-level.
  <!-- Updated: Validation Session 1 - keep conflicts/release/diagnose top-level -->
- README: rewrite the quickstart around `ccsync` → wizard/dashboard; note
  `setup <token>` for headless; mention the dedicated Syncthing home.

## Related Code Files

- Modify: `src/service/server.ts` (400/413 + req.destroy).
- Modify: `src/cli/index.ts` (group legacy under `advanced`; keep primary top-level).
- Modify: `README.md` (v2 model), `docs/sync-decisions-and-findings.md` (note dedicated home).
- Test: `tests/service/server.test.ts` (add: `/api/pause`, 404 fall-through,
  wrong-token, malformed JSON → 400, oversize → 413, SSE endpoint auth).

## Implementation Steps

1. Harden `readJson`: oversize → `req.destroy()` + 413; malformed JSON → 400; add the missing server tests (pause, 404, wrong-token, malformed, oversize).
2. Audit `src/cli/index.ts` (advanced group already exists); KEEP `conflicts`/`release`/`diagnose` top-level (validated); verify `--help` output. No hard-deletes.
3. Update README to the v2 Web-UI-first flow + dedicated-home note.
4. Full gate: `pnpm test`/`typecheck`/`lint`/`build` green; `ccsync --help` sane.

## Success Criteria

- [ ] Malformed JSON → 400, oversize body → 413 (socket destroyed); covered by tests.
- [ ] Server tests cover `/api/pause`, 404, wrong-token, SSE auth.
- [ ] Legacy commands reachable under `ccsync advanced`; primaries top-level; help reads cleanly.
- [ ] README reflects v2; full suite + build green.

## Risk Assessment

- Moving commands under `advanced` could break users' existing scripts → keep them
  reachable (just regrouped), document the change; do not hard-delete this phase.
- Low overall risk — this phase is additive/cosmetic and well-covered by tests.
