---
phase: 4
title: "Onboarding wizard + pairing"
status: pending
effort: ""
---

# Phase 4: Onboarding wizard + pairing

## Overview

Router-style first-run wizard in the SPA so a non-expert can configure ccsync
from the browser (no CLI, no device/folder IDs), plus friendly machine pairing
(token + copy, no QR) and a directory-tree folder picker.

## Requirements

- Functional: first run (no config / not configured) shows a wizard:
  (1) check/install Syncthing → (2) name this machine → (3) "Create first machine"
  OR paste an invite token → (4) pick code root + tick folders (directory tree) →
  (5) tick which Claude parts to sync → finish → lands on Dashboard.
  "Add machine" modal generates an invite token with Copy + ready-to-paste command.
- Non-functional: no Syncthing internals surfaced; wizard resumable if interrupted;
  folder browse never escapes the user's home (path guard).

## Architecture

> **Red-team corrections:** (C3) pairing only completes if the INVITER runs
> `watchAndAutoAccept` (consumes an invite-store slot + admits the joiner's pending
> device — see `auto-accept.ts`, `interactive.ts:232`). The Control Service does not
> run it today, so a UI-generated invite would leave a pending device nothing
> accepts → sync never starts. (I2) `handleJoin` prompts for `localRoot` via
> `@inquirer/prompts` when the invite carries a `rootProfile` (`join.ts:32`) — that
> hangs in a no-TTY service. `joinWithToken` must take `localRoot` as a param.

- New server endpoints:
  - `GET /api/folders/browse?path=<dir>` → list immediate subdirectories of `path`
    (default home root); guard against traversal; return `{path, entries:[{name,path,isDir}]}`.
  - `POST /api/pair/invite` → reuse `encodeInvite()` + create an invite-store slot →
    `{token, command}`. **Then start `watchAndAutoAccept` for the invite window**
    (see lifecycle below) so the joiner is actually admitted.
  - `POST /api/pair/join {token, localRoot}` → call the extracted
    `joinWithToken(token, { localRoot, ... })` core; `localRoot` comes from wizard
    step 4 (folder pick), never a prompt.
  - `GET /api/state` already reports config presence; add `configured:boolean` +
    `syncthingInstalled:boolean` for wizard gating.
- **Auto-accept lifecycle (C3):** `watchAndAutoAccept` must run on the INVITING
  machine while the slot is open. The ephemeral `ccsync ui` process may exit, so:
  (a) the Control Service runs the watcher in-process for the invite TTL, and
  (b) document that the inviting machine must keep `ccsync ui`/service running until
  the new machine appears (the dashboard shows "waiting for machine to join…").
  Also keep the existing interactive auto-accept (`interactive.ts`) so the CLI path
  still works. (If a always-on background service is desired, that's a Phase-2.5
  follow-up — out of scope here; document the keep-it-open requirement.)
- Client: `ui/src/pages/Wizard.tsx` with step components; `FolderTree` consuming
  `/api/folders/browse`; `AddMachineDialog` (invite token + Copy + "waiting to
  join" status). Route `/` → Wizard when `!configured`, else Dashboard (prefer a
  tiny view-state switch over a router dep — only 2 views).

## Related Code Files

- Create: `src/service/folders.ts` (browse with traversal guard), `src/core/join.ts`
  (extract `joinWithToken` from `src/cli/commands/join.ts`; refactor CLI to reuse).
- Modify: `src/service/server.ts` (folders.browse, pair/invite, pair/join routes;
  extend `/api/state` with `configured`,`syncthingInstalled`).
- Create: `ui/src/pages/Wizard.tsx`, `ui/src/components/{FolderTree,AddMachineDialog,StepNav}.tsx`,
  `ui/src/lib/router.ts` (or add `react-router-dom` as a ui devDep/bundled dep).
- Modify: `ui/src/App.tsx` (route on `configured`).
- Test: `tests/service/folders.test.ts` (browse + traversal guard), `tests/core/join.test.ts`
  (joinWithToken decodes + reconstructs profile, with mocked api), `tests/service/server.test.ts` (pair routes auth).

## Implementation Steps

1. Extract `joinWithToken(token, { localRoot, ... })` core from `join.ts` (localRoot as a PARAM, no prompt); refactor CLI `handleJoin` to pass the prompted value; test decode + profile reconstruction + that no prompt fires when localRoot is supplied.
2. Implement `folders.ts` browse (home-rooted, traversal-guarded); add route; test.
3. Add `pair/invite` (reuse encodeInvite + invite-store + start `watchAndAutoAccept` for the slot TTL) and `pair/join {token, localRoot}` routes; extend `/api/state` with `configured`/`syncthingInstalled`/`pairing` status; test auth + happy paths + that invite triggers the watcher.
4. Build `FolderTree` + wizard steps; route `/`→Wizard when `!configured`.
5. Build `AddMachineDialog` (token + Copy + paste-command).
6. Manual: fresh machine → wizard → create-first; second machine → paste token from AddMachineDialog → joins; both land on Dashboard; pick folders via tree.

## Success Criteria

- [ ] A new machine is fully configured via the browser wizard with no CLI and no visible device/folder IDs.
- [ ] "Add machine" shows a token + working Copy; pasting it on machine B pairs AND machine A's service auto-accepts the pending device (sync actually establishes, not just "token entered"); dashboard shows "waiting to join" → joined.
- [ ] Folder picker browses directories and cannot escape the home root.
- [ ] CLI `setup <token>` still works (shares `joinWithToken`); tests green.

## Risk Assessment

- Router dep: prefer a tiny hand-rolled view-state switch over `react-router-dom` if bundle size matters (only 2 top-level views: Wizard/Dashboard) — decide in step 4, default to no router.
- Folder browse is a read surface on the filesystem → strict traversal guard + home-root confinement; never follow symlinks outside home.
- Syncthing install step from a browser button → reuse `installer.ts`; if non-interactive/needs sudo, show the manual command instead of failing silently.
