# Root Profile Sync Plan

---
status: completed
created: 2026-06-20
scope: ccsync one-root sync and Claude conversation path mapping
---

## Overview

Implement the foundation for one selected code root per ccsync profile. Machines may use different local root paths while sharing one stable logical root and stable per-project conversation folders.

## Phases

| Phase | Status | Goal |
| --- | --- | --- |
| 1 | completed | Add root profile primitives and tests |
| 2 | completed | Wire stable Syncthing folder generation |
| 3 | completed | Carry profile metadata through invite/setup |
| 4 | completed | Update README with current architecture and flow |
| 5 | completed | Verify tests, typecheck, build, and scoped lint |

## Key Decisions

- Default mode avoids symlinks.
- Code sync uses one logical root folder with per-machine local path.
- Claude conversations use stable project relative paths, but each machine maps them to its own `~/.claude/projects/<encoded-local-project-path>`.
- Symlink/mirror mode remains future fallback only.

## Files

- Modify: `src/core/config-schema.ts`
- Modify: `src/core/syncthing-config.ts`
- Modify: `src/core/invite-token.ts`
- Modify: `src/cli/commands/setup.ts`
- Modify: `src/cli/commands/join.ts`
- Modify: `README.md`
- Add: `src/core/root-profile.ts`
- Add: focused tests under `tests/core/`

## Success Criteria

- Root profile creates stable IDs from profile ID and project relative paths.
- Syncthing folders use the same IDs across machines with different local paths.
- Invite tokens can carry profile metadata from host to joiner.
- Existing tests still pass.
- README documents the new one-root flow and why path mapping is needed.

## Verification

- `pnpm test` passed: 14 files, 58 tests.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm build` passed.
