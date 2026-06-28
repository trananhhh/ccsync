---
phase: 1
title: "Build pipeline + SPA shell"
status: pending
effort: ""
---

# Phase 1: Build pipeline + SPA shell

## Overview

Stand up a Vite + React + Tailwind v4 + shadcn/ui app in `ui/` that builds to
static `dist/ui/`, and make the existing Control Service serve it (replacing the
placeholder) with the service token injected into the HTML. End state: `ccsync ui`
opens a real (near-empty) React app that can already call the existing POST
endpoints using the injected token.

## Requirements

- Functional: `pnpm build` produces `dist/cli.js` + `dist/ui/{index.html,assets/*}`;
  `ccsync ui` serves the SPA at `/`, assets at `/assets/*`, SPA-fallback for client
  routes; injected `window.__CCSYNC_TOKEN__` lets the app POST successfully.
- Non-functional: React/Vite/Tailwind/shadcn are **devDependencies only** (in
  `ui/package.json`); published tarball contains only `dist/**`; no source maps in
  `dist/ui/`; `src/` never imports `ui/src`.

## Architecture

- `ui/` is a standalone nested package (its own `package.json`, NOT a pnpm
  workspace) → keeps the CLI dep graph clean. Root scripts:
  `"build:ui": "pnpm -C ui build"`, `"build": "pnpm build:ui && tsup"`.
- `ui/vite.config.ts`: `base:"/"`, `build.outDir:"../dist/ui"`, `emptyOutDir:true`,
  `sourcemap:false`, `@vitejs/plugin-react`, `@tailwindcss/vite`, alias `@`→`ui/src`.
- Serving (in `src/service/runtime.ts`, replacing `ui-placeholder.ts`): a hand-rolled
  zero-dep static handler reading `dist/ui` relative to `import.meta.url`
  (`path.dirname(fileURLToPath(import.meta.url))/ui`), with a MIME map, path-traversal
  guard, `/assets/*`-miss → 404 (never serve HTML as JS), other miss → index.html.
- Token injection: read index.html once, insert
  `<script>window.__CCSYNC_TOKEN__=${JSON.stringify(token)}</script>` right after
  `<head>` (classic script runs before the deferred module bundle). Cache result.
  **Fail loud** if the marker/`<head>` is absent (throw at startup) rather than
  serving un-injected HTML — otherwise every POST 401s with a confusing cause.
  Token is hex (`token.ts` charset `[0-9a-f]`) so `JSON.stringify` is safe; note
  this invariant so a future token-format change can't enable inline-script injection.
- **Stable service port + reuse running service (red-team nit):** today
  `startControlService` listens on port 0 (random each run), so `service-url`
  changes every invocation — this breaks the Vite dev `/api` proxy AND makes each
  `ccsync ui` spawn a fresh server + (Phase 2) a duplicate Syncthing events loop.
  Fix here: bind a STABLE loopback port (fixed default, e.g. 41384, configurable;
  fall back to probe if taken and persist to `service-url`). `ccsync ui` should
  detect an already-running service (ping `service-url`) and just open the browser
  at it instead of starting a second one. This is the foundation that keeps the
  Phase 2 monitor a true singleton.

## Related Code Files

- Create: `ui/package.json`, `ui/vite.config.ts`, `ui/tsconfig.json`,
  `ui/index.html`, `ui/src/main.tsx`, `ui/src/App.tsx`, `ui/src/index.css`,
  `ui/src/lib/api.ts` (fetch `post()` reading `window.__CCSYNC_TOKEN__ ?? import.meta.env.VITE_CCSYNC_TOKEN`),
  shadcn scaffolding (`ui/components.json`, `ui/src/components/ui/*`).
- Create: `src/service/static.ts` (serveStatic + renderIndex).
- Modify: `src/service/runtime.ts` (use static.ts; serve dist/ui; inject token),
  remove use of `src/service/ui-placeholder.ts` (delete the file).
- Modify: `package.json` (scripts: `build:ui`, `build`, `dev:ui`; ensure
  `files:["dist"]`; confirm UI deps NOT added to root `dependencies`).
- Modify: `.npmignore` / verify `pnpm pack --dry-run` excludes `ui/` & `ui/node_modules`.
- Modify: `ui/vite.config.ts` dev `server.proxy` `/api`→ service URL (read
  `~/.ccsync/service-url`), `define` `VITE_CCSYNC_TOKEN` from `~/.ccsync/service-token`.

## Implementation Steps

1. Scaffold `ui/` Vite React-TS app + Tailwind v4 (`@tailwindcss/vite`) + shadcn init.
   Pin React/Vite/Tailwind/radix in `ui/package.json` devDeps.
2. Configure `vite.config.ts` (base, outDir `../dist/ui`, emptyOutDir, sourcemap:false,
   alias). Add dev `server.proxy` for `/api` (covers SSE later) reading service-url,
   and `define` VITE_CCSYNC_TOKEN from service-token (friendly error if files absent).
3. Build a minimal `App.tsx` that fetches `/api/state` and renders machineName +
   bucket list with a Switch wired to `POST /api/toggle` (proves token injection).
4. Implement `src/service/static.ts` (serveStatic + renderIndex with token inject).
5. Rewire `runtime.ts` to serve `dist/ui` via static.ts; bind a STABLE port +
   reuse-if-running (`ccsync ui` pings `service-url`, opens browser if up else
   starts); delete `ui-placeholder.ts`.
6. Add root `build:ui` + `build` scripts; run `pnpm build`; run `ccsync ui` and
   verify the SPA loads + a toggle round-trips (auto-applies); run `ccsync ui`
   twice → second reuses the first service (no second port).
7. `pnpm pack --dry-run` → confirm tarball = `dist/cli.js` + `dist/ui/**` only.

## Success Criteria

- [ ] `pnpm build` emits `dist/ui/index.html` + hashed `dist/ui/assets/*`, no `.map`.
- [ ] `ccsync ui` serves the React app; deep client route refresh still loads (SPA fallback).
- [ ] A bucket toggle in the UI calls `/api/toggle` with the injected token and auto-applies.
- [ ] `pnpm pack --dry-run` shows no `ui/`, `node_modules`, or UI runtime deps; `pnpm test`/`typecheck`/`lint` green.

## Risk Assessment

- Tailwind v3 vs v4: plan assumes v4 (`@tailwindcss/vite`, no postcss config). If a
  contributor standardizes on v3, swap to postcss + `tailwind.config.js` (config-only).
- ESM `__dirname`: tsup output is ESM — use `fileURLToPath(import.meta.url)`, not `__dirname`.
- Accidental runtime-dep leak: gate with the `pnpm pack --dry-run` check in step 7.
