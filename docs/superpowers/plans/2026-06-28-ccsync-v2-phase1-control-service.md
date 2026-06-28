# ccsync v2 — Phase 1: Control Service + Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the UI-agnostic Control Service (localhost HTTP API) plus the reliability fixes that make ccsync trustworthy, so the Web UI (Phase 2) and a future TUI become thin clients over one brain.

**Architecture:** Keep the existing `core/` engine untouched in behavior. Add a `core/sync-control.ts` (pause/metered) and a `src/service/` HTTP server that wraps `core` and exposes a JSON Control API on `127.0.0.1`. Mutations auto-apply (no more manual `push`). `apply` stops wiping foreign Syncthing folders. The daemon gains a real stop path.

**Tech Stack:** TypeScript (ESM, `node:` built-ins only at runtime), Node `http` for the server, Vitest for tests, Biome for lint/format, Zod for config. No new runtime dependencies.

## Global Constraints

- Node `>=20.17.0`; ESM modules; all local imports use the `.js` extension.
- Runtime code uses only existing deps + `node:` built-ins. No new runtime dependency in `package.json` `dependencies`.
- Server binds to `127.0.0.1` only. Every mutating endpoint requires a valid `X-Ccsync-Token` header.
- ccsync owns only Syncthing folders whose id starts with `ccsync-` (verified: `bucketToFolders` → `ccsync-<bucket>-<idx>`; root folders → `ccsync-root-`/`ccsync-code-`/`ccsync-conv-`). Never touch foreign folders.
- Test command: `pnpm test` (Vitest). Lint: `pnpm lint`. Typecheck: `pnpm typecheck`.
- Conventional commits, no AI references in messages.
- Pause ≠ disable: pause keeps the Syncthing folder/device but stops transfers; disable removes the folder from Syncthing config.

## Scope & spec coverage

This plan implements spec sections: Control Service + Control API (subset: `/api/state`, `/api/toggle`, `/api/pause`, `/api/metered`), and Reliability fixes E1 (auto-apply), E2 (preserve foreign folders), E3 (daemon stop + fresh-reset), and the slim-CLI additions `ccsync ui` / `ccsync service start|stop`.

**Deferred to later plans (Phase 2/3):** SSE `/api/events`, pairing/QR endpoints, folder-browse endpoint, the React+shadcn UI (Phase 1 ships a placeholder page), removal of legacy CLI commands (`init/pair/share/...`), dropping the `shell-history` stub (E4), and replacing the `config.xml` regex identity scrape (E5). These are non-blocking; the legacy commands keep working in the meantime.

---

### Task 1: Preserve foreign Syncthing folders in `apply`

**Files:**
- Modify: `src/core/applier.ts`
- Test: `tests/core/applier.test.ts`

**Interfaces:**
- Produces: `export const CCSYNC_FOLDER_PREFIX = "ccsync-"`; `export function isCcsyncFolder(id: string): boolean`; `export function mergeFolders(remote: SyncthingFolder[], owned: SyncthingFolder[]): SyncthingFolder[]`.
- Consumes: `SyncthingFolder` from `./syncthing-api.js`.

- [ ] **Step 1: Write the failing test**

Add to `tests/core/applier.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
	CCSYNC_FOLDER_PREFIX,
	isCcsyncFolder,
	mergeFolders,
} from "../../src/core/applier.js";
import type { SyncthingFolder } from "../../src/core/syncthing-api.js";

function folder(id: string): SyncthingFolder {
	return { id, label: id, path: `/tmp/${id}`, type: "sendreceive", devices: [] };
}

describe("mergeFolders", () => {
	it("keeps foreign folders and replaces only ccsync-owned ones", () => {
		const remote = [folder("user-photos"), folder("ccsync-claude-config-0")];
		const owned = [folder("ccsync-claude-config-0"), folder("ccsync-root-abc")];
		const merged = mergeFolders(remote, owned);
		const ids = merged.map((f) => f.id).sort();
		expect(ids).toEqual(["ccsync-claude-config-0", "ccsync-root-abc", "user-photos"]);
	});

	it("drops ccsync folders that are no longer owned", () => {
		const remote = [folder("ccsync-stale-0"), folder("keep-me")];
		const merged = mergeFolders(remote, []);
		expect(merged.map((f) => f.id)).toEqual(["keep-me"]);
	});

	it("recognises every ccsync folder id prefix", () => {
		expect(isCcsyncFolder("ccsync-conv-x")).toBe(true);
		expect(isCcsyncFolder("user-photos")).toBe(false);
		expect(CCSYNC_FOLDER_PREFIX).toBe("ccsync-");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- applier`
Expected: FAIL — `mergeFolders`/`isCcsyncFolder`/`CCSYNC_FOLDER_PREFIX` not exported.

- [ ] **Step 3: Add the helpers and use them in `apply`**

In `src/core/applier.ts`, add near the top (after imports):

```typescript
export const CCSYNC_FOLDER_PREFIX = "ccsync-";

export function isCcsyncFolder(id: string): boolean {
	return id.startsWith(CCSYNC_FOLDER_PREFIX);
}

export function mergeFolders(
	remote: import("./syncthing-api.js").SyncthingFolder[],
	owned: import("./syncthing-api.js").SyncthingFolder[],
): import("./syncthing-api.js").SyncthingFolder[] {
	const foreign = remote.filter((f) => !isCcsyncFolder(f.id));
	return [...foreign, ...owned];
}
```

Then in `apply`, replace the merge block:

```typescript
	const remote = await api.getConfig();
	const merged = {
		...remote,
		folders: mergeFolders(remote.folders, folders),
		devices,
	};
	await api.putConfig(merged);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- applier`
Expected: PASS (all applier tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: no errors.

```bash
git add src/core/applier.ts tests/core/applier.test.ts
git commit -m "fix(applier): preserve user-added Syncthing folders on apply"
```

---

### Task 2: Pause / resume / metered control (`core/sync-control.ts`)

**Files:**
- Modify: `src/core/syncthing-api.ts` (add `paused?` field)
- Modify: `src/core/config-schema.ts` (add `metered`)
- Create: `src/core/sync-control.ts`
- Test: `tests/core/sync-control.test.ts`

**Interfaces:**
- Consumes: `SyncthingApi.getConfig()` / `putConfig()`; `CCSYNC_FOLDER_PREFIX`, `isCcsyncFolder` from `./applier.js`.
- Produces:
  - `pauseAllTransfers(config: SyncthingConfig): SyncthingConfig` (pure: sets every device `paused: true`)
  - `resumeAllTransfers(config: SyncthingConfig): SyncthingConfig` (pure: sets every device `paused: false`)
  - `setFolderPaused(config: SyncthingConfig, folderId: string, paused: boolean): SyncthingConfig` (pure)
  - `applyPause(api: SyncthingApi, action: "pause-all" | "resume-all"): Promise<void>`
  - `applyFolderPause(api: SyncthingApi, folderId: string, paused: boolean): Promise<void>`

- [ ] **Step 1: Add `paused?` to the Syncthing config interfaces**

In `src/core/syncthing-api.ts` add `paused?: boolean;` to both `SyncthingFolder` and `SyncthingDevice` interfaces (one line each, at the end of each interface body).

- [ ] **Step 2: Add `metered` to the ccsync config schema**

In `src/core/config-schema.ts`, inside `ConfigSchema = z.object({ ... })`, add after `globalIgnore`:

```typescript
	metered: z.boolean().default(false),
```

- [ ] **Step 3: Write the failing test**

Create `tests/core/sync-control.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
	applyPause,
	pauseAllTransfers,
	resumeAllTransfers,
	setFolderPaused,
} from "../../src/core/sync-control.js";
import type { SyncthingApi, SyncthingConfig } from "../../src/core/syncthing-api.js";

function baseConfig(): SyncthingConfig {
	return {
		version: 1,
		folders: [
			{ id: "ccsync-a", label: "a", path: "/a", type: "sendreceive", devices: [] },
		],
		devices: [
			{ deviceID: "D1", name: "self", addresses: ["dynamic"] },
			{ deviceID: "D2", name: "peer", addresses: ["dynamic"] },
		],
	};
}

describe("sync-control pure transforms", () => {
	it("pauseAllTransfers pauses every device, leaves folders running", () => {
		const out = pauseAllTransfers(baseConfig());
		expect(out.devices.every((d) => d.paused === true)).toBe(true);
		expect(out.folders[0].paused).toBeUndefined();
	});

	it("resumeAllTransfers unpauses every device", () => {
		const paused = pauseAllTransfers(baseConfig());
		const out = resumeAllTransfers(paused);
		expect(out.devices.every((d) => d.paused === false)).toBe(true);
	});

	it("setFolderPaused toggles one folder", () => {
		const out = setFolderPaused(baseConfig(), "ccsync-a", true);
		expect(out.folders[0].paused).toBe(true);
	});
});

describe("applyPause", () => {
	it("reads config, transforms, writes it back", async () => {
		let written: SyncthingConfig | undefined;
		const api = {
			getConfig: async () => baseConfig(),
			putConfig: async (c: SyncthingConfig) => {
				written = c;
			},
		} as unknown as SyncthingApi;
		await applyPause(api, "pause-all");
		expect(written?.devices.every((d) => d.paused === true)).toBe(true);
	});
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test -- sync-control`
Expected: FAIL — module `src/core/sync-control.ts` not found.

- [ ] **Step 5: Implement `src/core/sync-control.ts`**

```typescript
import type { SyncthingApi, SyncthingConfig } from "./syncthing-api.js";

export function pauseAllTransfers(config: SyncthingConfig): SyncthingConfig {
	return { ...config, devices: config.devices.map((d) => ({ ...d, paused: true })) };
}

export function resumeAllTransfers(config: SyncthingConfig): SyncthingConfig {
	return { ...config, devices: config.devices.map((d) => ({ ...d, paused: false })) };
}

export function setFolderPaused(
	config: SyncthingConfig,
	folderId: string,
	paused: boolean,
): SyncthingConfig {
	return {
		...config,
		folders: config.folders.map((f) => (f.id === folderId ? { ...f, paused } : f)),
	};
}

export async function applyPause(
	api: SyncthingApi,
	action: "pause-all" | "resume-all",
): Promise<void> {
	const config = await api.getConfig();
	const next = action === "pause-all" ? pauseAllTransfers(config) : resumeAllTransfers(config);
	await api.putConfig(next);
}

export async function applyFolderPause(
	api: SyncthingApi,
	folderId: string,
	paused: boolean,
): Promise<void> {
	const config = await api.getConfig();
	await api.putConfig(setFolderPaused(config, folderId, paused));
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- sync-control`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck`

```bash
git add src/core/syncthing-api.ts src/core/config-schema.ts src/core/sync-control.ts tests/core/sync-control.test.ts
git commit -m "feat(core): pause/resume/metered transfer control"
```

---

### Task 3: Real daemon stop (`stopDaemon`)

**Files:**
- Modify: `src/core/syncthing-bootstrap.ts`
- Test: `tests/core/syncthing-bootstrap.test.ts` (create if absent)

**Interfaces:**
- Produces: `export async function stopDaemon(guiAddress: string, apiKey: string, opts?: { post?: (url: string, apiKey: string) => Promise<boolean>; check?: (guiAddress: string) => Promise<boolean>; timeoutMs?: number; pollMs?: number }): Promise<"stopped" | "not-running">`.
- Consumes: `isDaemonRunning` from the same module.

- [ ] **Step 1: Write the failing test**

Create/append `tests/core/syncthing-bootstrap.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { stopDaemon } from "../../src/core/syncthing-bootstrap.js";

describe("stopDaemon", () => {
	it("returns not-running when the daemon is already down", async () => {
		const res = await stopDaemon("127.0.0.1:8384", "key", {
			check: async () => false,
		});
		expect(res).toBe("not-running");
	});

	it("posts shutdown and waits until unreachable", async () => {
		let posted = false;
		let calls = 0;
		const res = await stopDaemon("127.0.0.1:8384", "key", {
			post: async () => {
				posted = true;
				return true;
			},
			check: async () => {
				calls += 1;
				return calls === 1; // running once, then down
			},
			pollMs: 1,
			timeoutMs: 1000,
		});
		expect(posted).toBe(true);
		expect(res).toBe("stopped");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- syncthing-bootstrap`
Expected: FAIL — `stopDaemon` not exported.

- [ ] **Step 3: Implement `stopDaemon`**

Append to `src/core/syncthing-bootstrap.ts`:

```typescript
async function postShutdown(guiAddress: string, apiKey: string): Promise<boolean> {
	const addr = guiAddress.startsWith("http") ? guiAddress : `http://${guiAddress}`;
	try {
		const res = await fetch(`${addr}/rest/system/shutdown`, {
			method: "POST",
			headers: { "X-API-Key": apiKey },
		});
		return res.ok;
	} catch {
		return false;
	}
}

export interface StopDaemonOptions {
	post?: (guiAddress: string, apiKey: string) => Promise<boolean>;
	check?: (guiAddress: string) => Promise<boolean>;
	timeoutMs?: number;
	pollMs?: number;
}

export async function stopDaemon(
	guiAddress: string,
	apiKey: string,
	opts: StopDaemonOptions = {},
): Promise<"stopped" | "not-running"> {
	const check = opts.check ?? isDaemonRunning;
	const post = opts.post ?? postShutdown;
	if (!(await check(guiAddress))) return "not-running";

	await post(guiAddress, apiKey);
	const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
	const pollMs = opts.pollMs ?? 300;
	while (Date.now() < deadline) {
		if (!(await check(guiAddress))) return "stopped";
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
	return "stopped";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- syncthing-bootstrap`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`

```bash
git add src/core/syncthing-bootstrap.ts tests/core/syncthing-bootstrap.test.ts
git commit -m "feat(core): graceful Syncthing daemon stop"
```

---

### Task 4: `fresh-reset` stops the daemon and cleans the Syncthing home

**Files:**
- Modify: `src/core/fresh-reset.ts`
- Test: `tests/core/fresh-reset.test.ts` (create)

**Interfaces:**
- Produces: updated `resetCcsyncState(homeDir?: string, opts?: { syncthingHomeDir?: string; stop?: () => Promise<void>; removeDir?: (dir: string) => Promise<void> }): Promise<void>`.
- Consumes: `ccsyncHome`, `syncthingHome` from `../platform/paths.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/core/fresh-reset.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resetCcsyncState } from "../../src/core/fresh-reset.js";

describe("resetCcsyncState", () => {
	it("stops the daemon then removes both ccsync and syncthing homes", async () => {
		const removed: string[] = [];
		let stopped = false;
		await resetCcsyncState("/tmp/ccsync-home", {
			syncthingHomeDir: "/tmp/st-home",
			stop: async () => {
				stopped = true;
			},
			removeDir: async (dir) => {
				removed.push(dir);
			},
		});
		expect(stopped).toBe(true);
		expect(removed).toEqual(["/tmp/ccsync-home", "/tmp/st-home"]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- fresh-reset`
Expected: FAIL — `resetCcsyncState` does not accept options / does not stop.

- [ ] **Step 3: Implement**

Replace `src/core/fresh-reset.ts` with:

```typescript
import * as fs from "node:fs/promises";
import { ccsyncHome, syncthingHome } from "../platform/paths.js";

export interface ResetOptions {
	syncthingHomeDir?: string;
	stop?: () => Promise<void>;
	removeDir?: (dir: string) => Promise<void>;
}

export async function resetCcsyncState(
	homeDir: string = ccsyncHome(),
	opts: ResetOptions = {},
): Promise<void> {
	const stHome = opts.syncthingHomeDir ?? syncthingHome();
	const removeDir = opts.removeDir ?? ((dir: string) => fs.rm(dir, { recursive: true, force: true }));
	if (opts.stop) {
		try {
			await opts.stop();
		} catch {
			// best-effort; continue cleaning up
		}
	}
	await removeDir(homeDir);
	await removeDir(stHome);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- fresh-reset`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`

```bash
git add src/core/fresh-reset.ts tests/core/fresh-reset.test.ts
git commit -m "feat(core): fresh-reset stops daemon and clears syncthing home"
```

---

### Task 5: Auto-apply on mutation (`applyAndSave`) + toggle stops telling users to `push`

**Files:**
- Create: `src/core/mutate.ts`
- Modify: `src/cli/commands/toggle.ts`
- Test: `tests/core/mutate.test.ts` (create)

**Interfaces:**
- Consumes: `readConfig`, `writeConfig` from `./config-io.js`; `apply`, `ApplyResult` from `./applier.js`.
- Produces: `applyAndSave(configPath: string, mutate: (cfg: Config) => void, deps?: { read?: typeof readConfig; write?: typeof writeConfig; applyFn?: typeof apply }): Promise<ApplyResult>`.

- [ ] **Step 1: Write the failing test**

Create `tests/core/mutate.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { applyAndSave } from "../../src/core/mutate.js";
import type { Config } from "../../src/core/config-schema.js";

function cfg(): Config {
	return {
		machineName: "m",
		peers: [],
		buckets: { "claude-config": { enabled: true, paths: [], ignore: [], versioning: { type: "simple", keep: 10 } } },
		globalIgnore: [],
		metered: false,
	} as Config;
}

describe("applyAndSave", () => {
	it("mutates, writes, then applies — in that order", async () => {
		const order: string[] = [];
		let saved: Config | undefined;
		const res = await applyAndSave(
			"/tmp/x.yaml",
			(c) => {
				c.buckets["claude-config"].enabled = false;
			},
			{
				read: async () => cfg(),
				write: async (_p, c) => {
					order.push("write");
					saved = c;
				},
				applyFn: async () => {
					order.push("apply");
					return { foldersConfigured: 0, devicesConfigured: 1, stignoresWritten: 0 };
				},
			},
		);
		expect(saved?.buckets["claude-config"].enabled).toBe(false);
		expect(order).toEqual(["write", "apply"]);
		expect(res.devicesConfigured).toBe(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- mutate`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/mutate.ts`**

```typescript
import { apply, type ApplyResult } from "./applier.js";
import type { Config } from "./config-schema.js";
import { readConfig, writeConfig } from "./config-io.js";

export interface MutateDeps {
	read?: typeof readConfig;
	write?: typeof writeConfig;
	applyFn?: typeof apply;
}

export async function applyAndSave(
	configPath: string,
	mutate: (cfg: Config) => void,
	deps: MutateDeps = {},
): Promise<ApplyResult> {
	const read = deps.read ?? readConfig;
	const write = deps.write ?? writeConfig;
	const applyFn = deps.applyFn ?? apply;
	const cfg = await read(configPath);
	mutate(cfg);
	await write(configPath, cfg);
	return applyFn(cfg);
}
```

- [ ] **Step 4: Update `handleToggle` to auto-apply**

Replace the body of `src/cli/commands/toggle.ts` after the unknown-bucket guard:

```typescript
import { applyAndSave } from "../../core/mutate.js";
import { readConfig } from "../../core/config-io.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export interface ToggleOptions {
	bucket: string;
	on?: boolean;
	off?: boolean;
}

export async function handleToggle(opts: ToggleOptions): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	const bucket = cfg.buckets[opts.bucket];
	if (!bucket) {
		log.error(`Unknown bucket: ${opts.bucket}`);
		log.plain(`Available: ${Object.keys(cfg.buckets).join(", ")}`);
		process.exitCode = 1;
		return;
	}
	const next = opts.on ? true : opts.off ? false : !bucket.enabled;
	await applyAndSave(cfgPath, (c) => {
		c.buckets[opts.bucket].enabled = next;
	});
	log.success(`Bucket ${opts.bucket} ${next ? "enabled" : "disabled"} and applied.`);
}
```

- [ ] **Step 5: Run tests + typecheck to verify they pass**

Run: `pnpm test -- mutate` then `pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/mutate.ts src/cli/commands/toggle.ts tests/core/mutate.test.ts
git commit -m "feat(core): auto-apply config mutations; drop manual push step from toggle"
```

---

### Task 6: Control Service HTTP server

**Files:**
- Create: `src/service/token.ts`
- Create: `src/service/server.ts`
- Test: `tests/service/server.test.ts` (create)

**Interfaces:**
- Consumes: `readConfig` from `../core/config-io.js`; `applyAndSave` from `../core/mutate.js`; `applyPause` from `../core/sync-control.js`; `SyncthingApi` from `../core/syncthing-api.js`; `ccsyncHome`, `ccsyncConfigPath` from `../platform/paths.js`.
- Produces:
  - `token.ts`: `ensureServiceToken(homeDir?: string): Promise<string>` (reads/creates `<home>/service-token`).
  - `server.ts`: `createControlServer(deps: ControlServerDeps): http.Server` and `interface ControlServerDeps { token: string; configPath: string; apiFor: (cfg: Config) => SyncthingApi; readConfig?: typeof readConfig; applyAndSave?: typeof applyAndSave; applyPause?: typeof applyPause }`.

- [ ] **Step 1: Implement the token helper (no test needed — trivial fs glue, covered via server test)**

Create `src/service/token.ts`:

```typescript
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ccsyncHome } from "../platform/paths.js";

export async function ensureServiceToken(homeDir: string = ccsyncHome()): Promise<string> {
	const tokenPath = path.join(homeDir, "service-token");
	try {
		const existing = (await fs.readFile(tokenPath, "utf-8")).trim();
		if (existing) return existing;
	} catch {
		// not created yet
	}
	const token = randomBytes(24).toString("hex");
	await fs.mkdir(homeDir, { recursive: true });
	await fs.writeFile(tokenPath, token, { mode: 0o600 });
	return token;
}
```

- [ ] **Step 2: Write the failing server test**

Create `tests/service/server.test.ts`:

```typescript
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createControlServer } from "../../src/service/server.js";
import type { Config } from "../../src/core/config-schema.js";
import type { SyncthingApi } from "../../src/core/syncthing-api.js";

function cfg(): Config {
	return {
		machineName: "m",
		peers: [],
		buckets: { "claude-config": { enabled: true, paths: [], ignore: [], versioning: { type: "simple", keep: 10 } } },
		globalIgnore: [],
		metered: false,
	} as Config;
}

const TOKEN = "test-token";
let server: ReturnType<typeof createControlServer>;
let saved: Config | undefined;

function start() {
	saved = cfg();
	server = createControlServer({
		token: TOKEN,
		configPath: "/tmp/x.yaml",
		apiFor: () => ({ getConfig: async () => ({ version: 1, folders: [], devices: [] }), putConfig: async () => {} }) as unknown as SyncthingApi,
		readConfig: async () => saved ?? cfg(),
		applyAndSave: async (_p, mutate) => {
			const c = saved ?? cfg();
			mutate(c);
			saved = c;
			return { foldersConfigured: 0, devicesConfigured: 1, stignoresWritten: 0 };
		},
		applyPause: async () => {},
	});
	return new Promise<string>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			resolve(`http://127.0.0.1:${port}`);
		});
	});
}

afterEach(() => new Promise<void>((r) => server.close(() => r())));

describe("control server", () => {
	it("rejects writes without a token", async () => {
		const base = await start();
		const res = await fetch(`${base}/api/toggle`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ target: "claude-config", on: false }),
		});
		expect(res.status).toBe(401);
	});

	it("GET /api/state returns buckets and metered flag", async () => {
		const base = await start();
		const res = await fetch(`${base}/api/state`, { headers: { "X-Ccsync-Token": TOKEN } });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { machineName: string; buckets: Array<{ name: string; enabled: boolean }>; metered: boolean };
		expect(body.machineName).toBe("m");
		expect(body.buckets.find((b) => b.name === "claude-config")?.enabled).toBe(true);
		expect(body.metered).toBe(false);
	});

	it("POST /api/toggle flips a bucket and auto-applies", async () => {
		const base = await start();
		const res = await fetch(`${base}/api/toggle`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
			body: JSON.stringify({ target: "claude-config", on: false }),
		});
		expect(res.status).toBe(200);
		expect(saved?.buckets["claude-config"].enabled).toBe(false);
	});

	it("POST /api/metered persists the flag and pauses transfers", async () => {
		const base = await start();
		const res = await fetch(`${base}/api/metered`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
			body: JSON.stringify({ on: true }),
		});
		expect(res.status).toBe(200);
		expect(saved?.metered).toBe(true);
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- service/server`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/service/server.ts`**

```typescript
import * as http from "node:http";
import type { Config } from "../core/config-schema.js";
import { readConfig as defaultReadConfig } from "../core/config-io.js";
import { applyAndSave as defaultApplyAndSave } from "../core/mutate.js";
import { applyPause as defaultApplyPause } from "../core/sync-control.js";
import { SyncthingApi } from "../core/syncthing-api.js";

export interface ControlServerDeps {
	token: string;
	configPath: string;
	apiFor: (cfg: Config) => SyncthingApi;
	readConfig?: typeof defaultReadConfig;
	applyAndSave?: typeof defaultApplyAndSave;
	applyPause?: typeof defaultApplyPause;
}

interface ToggleBody {
	target: string;
	on: boolean;
}
interface MeteredBody {
	on: boolean;
}
interface PauseBody {
	scope: "all";
	on: boolean;
}

function readJson<T>(req: http.IncomingMessage): Promise<T> {
	return new Promise((resolve, reject) => {
		let raw = "";
		req.on("data", (c) => {
			raw += c;
			if (raw.length > 1_000_000) reject(new Error("payload too large"));
		});
		req.on("end", () => {
			try {
				resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
			} catch (err) {
				reject(err);
			}
		});
		req.on("error", reject);
	});
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
	const json = JSON.stringify(body);
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(json);
}

export function createControlServer(deps: ControlServerDeps): http.Server {
	const read = deps.readConfig ?? defaultReadConfig;
	const applyAndSaveFn = deps.applyAndSave ?? defaultApplyAndSave;
	const applyPauseFn = deps.applyPause ?? defaultApplyPause;

	return http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const isWrite = req.method === "POST";
		if (isWrite && req.headers["x-ccsync-token"] !== deps.token) {
			return send(res, 401, { error: "unauthorized" });
		}
		try {
			if (req.method === "GET" && url.pathname === "/api/state") {
				const cfg = await read(deps.configPath);
				return send(res, 200, {
					machineName: cfg.machineName,
					metered: cfg.metered,
					peers: cfg.peers.map((p) => ({ name: p.name, deviceId: p.deviceId })),
					buckets: Object.entries(cfg.buckets).map(([name, b]) => ({
						name,
						enabled: b.enabled,
						paths: b.paths,
					})),
				});
			}

			if (req.method === "POST" && url.pathname === "/api/toggle") {
				const body = await readJson<ToggleBody>(req);
				const result = await applyAndSaveFn(deps.configPath, (c) => {
					if (!c.buckets[body.target]) throw new Error(`unknown bucket: ${body.target}`);
					c.buckets[body.target].enabled = body.on;
				});
				return send(res, 200, { ok: true, result });
			}

			if (req.method === "POST" && url.pathname === "/api/metered") {
				const body = await readJson<MeteredBody>(req);
				const cfg = await read(deps.configPath);
				const api = deps.apiFor(cfg);
				await applyPauseFn(api, body.on ? "pause-all" : "resume-all");
				await applyAndSaveFn(deps.configPath, (c) => {
					c.metered = body.on;
				});
				return send(res, 200, { ok: true, metered: body.on });
			}

			if (req.method === "POST" && url.pathname === "/api/pause") {
				const body = await readJson<PauseBody>(req);
				const cfg = await read(deps.configPath);
				const api = deps.apiFor(cfg);
				await applyPauseFn(api, body.on ? "pause-all" : "resume-all");
				return send(res, 200, { ok: true, paused: body.on });
			}

			return send(res, 404, { error: "not found" });
		} catch (err) {
			return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
		}
	});
}

export function apiFromConfig(cfg: Config): SyncthingApi {
	if (!cfg.syncthing) throw new Error("config.syncthing not initialised — run `ccsync setup`");
	return new SyncthingApi({ apiKey: cfg.syncthing.apiKey, guiAddress: cfg.syncthing.guiAddress });
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test -- service/server` then `pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/service/token.ts src/service/server.ts tests/service/server.test.ts
git commit -m "feat(service): localhost Control API (state/toggle/pause/metered)"
```

---

### Task 7: CLI — `ccsync ui` and `ccsync service start|stop`

**Files:**
- Create: `src/service/runtime.ts` (start the server, serve the placeholder UI, open browser)
- Create: `src/service/ui-placeholder.ts` (static HTML string that calls `/api/state`)
- Create: `src/cli/commands/ui.ts`
- Create: `src/cli/commands/service.ts`
- Modify: `src/cli/index.ts` (register `ui` and `service`)
- Test: `tests/service/runtime.test.ts` (create)

**Interfaces:**
- Consumes: `createControlServer`, `apiFromConfig` from `./server.js`; `ensureServiceToken` from `./token.js`; `ensureDaemonRunning`, `stopDaemon` from `../core/syncthing-bootstrap.js`; `readConfig` from `../core/config-io.js`; `ccsyncConfigPath` from `../platform/paths.js`.
- Produces:
  - `runtime.ts`: `startControlService(opts?: { open?: boolean; port?: number }): Promise<{ url: string; close: () => Promise<void> }>`; `serviceUrlFile(homeDir?: string): string`.
  - `ui.ts`: `handleUi(): Promise<void>`.
  - `service.ts`: `handleServiceStart(): Promise<void>`, `handleServiceStop(): Promise<void>`.

- [ ] **Step 1: Implement the placeholder UI module**

Create `src/service/ui-placeholder.ts`:

```typescript
export const UI_PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>ccsync</title>
<style>body{font:14px system-ui;margin:2rem;max-width:40rem}code{background:#eee;padding:.1rem .3rem;border-radius:3px}</style>
</head>
<body>
<h1>ccsync</h1>
<p>Control service is running. The full dashboard ships in Phase 2.</p>
<pre id="state">loading…</pre>
<script>
fetch("/api/state").then(r=>r.json()).then(s=>{
  document.getElementById("state").textContent = JSON.stringify(s, null, 2);
}).catch(e=>{document.getElementById("state").textContent = "error: "+e});
</script>
</body>
</html>`;
```

- [ ] **Step 2: Write the failing runtime test**

Create `tests/service/runtime.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { serviceUrlFile } from "../../src/service/runtime.js";

describe("serviceUrlFile", () => {
	it("lives under the ccsync home", () => {
		expect(serviceUrlFile("/tmp/cc")).toBe("/tmp/cc/service-url");
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- service/runtime`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/service/runtime.ts`**

```typescript
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";
import { ccsyncConfigPath, ccsyncHome } from "../platform/paths.js";
import { createControlServer, apiFromConfig } from "./server.js";
import { ensureServiceToken } from "./token.js";
import { UI_PLACEHOLDER_HTML } from "./ui-placeholder.js";

export function serviceUrlFile(homeDir: string = ccsyncHome()): string {
	return path.join(homeDir, "service-url");
}

function openBrowser(url: string): void {
	const cmd =
		process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
	try {
		spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
	} catch {
		// non-fatal; user can open the URL manually
	}
}

export async function startControlService(
	opts: { open?: boolean; port?: number } = {},
): Promise<{ url: string; close: () => Promise<void> }> {
	const token = await ensureServiceToken();
	const configPath = ccsyncConfigPath();
	const control = createControlServer({ token, configPath, apiFor: apiFromConfig });

	const server = http.createServer((req, res) => {
		if (req.url === "/" || req.url === "/index.html") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(UI_PLACEHOLDER_HTML);
			return;
		}
		control.emit("request", req, res);
	});

	await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	const url = `http://127.0.0.1:${port}`;
	await fs.mkdir(ccsyncHome(), { recursive: true });
	await fs.writeFile(serviceUrlFile(), url);
	if (opts.open) openBrowser(url);
	return {
		url,
		close: () =>
			new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
```

Note for the implementer: `control.emit("request", …)` reuses the Control API request handler registered by `createControlServer`. This keeps one handler for both UI and API on a single port.

- [ ] **Step 5: Implement the CLI command handlers**

Create `src/cli/commands/ui.ts`:

```typescript
import { configExists, readConfig } from "../../core/config-io.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";
import { ensureDaemonRunning } from "../../core/syncthing-bootstrap.js";
import { startControlService } from "../../service/runtime.js";

export async function handleUi(): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	if (!(await configExists(cfgPath))) {
		log.error("No ccsync config yet. Run `ccsync setup` first.");
		process.exitCode = 1;
		return;
	}
	const cfg = await readConfig(cfgPath);
	if (cfg.syncthing) {
		await ensureDaemonRunning(cfg.syncthing.homeDir, cfg.syncthing.guiAddress);
	}
	const { url } = await startControlService({ open: true });
	log.success(`ccsync dashboard: ${url}`);
	log.plain("Press Ctrl+C to stop the dashboard (sync keeps running).");
}
```

Create `src/cli/commands/service.ts`:

```typescript
import { readConfig } from "../../core/config-io.js";
import { ensureDaemonRunning, stopDaemon } from "../../core/syncthing-bootstrap.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export async function handleServiceStart(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	if (!cfg.syncthing) {
		log.error("config.syncthing not initialised — run `ccsync setup` first.");
		process.exitCode = 1;
		return;
	}
	const state = await ensureDaemonRunning(cfg.syncthing.homeDir, cfg.syncthing.guiAddress);
	log.success(`Syncthing daemon ${state}.`);
}

export async function handleServiceStop(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	if (!cfg.syncthing) {
		log.error("config.syncthing not initialised.");
		process.exitCode = 1;
		return;
	}
	const result = await stopDaemon(cfg.syncthing.guiAddress, cfg.syncthing.apiKey);
	log.success(`Syncthing daemon ${result}.`);
}
```

- [ ] **Step 6: Register the commands in `src/cli/index.ts`**

Add imports near the other command imports:

```typescript
import { handleServiceStart, handleServiceStop } from "./commands/service.js";
import { handleUi } from "./commands/ui.js";
```

Add command registrations (after the `release` command block, before `const advanced = …`):

```typescript
program
	.command("ui")
	.description("Open the ccsync dashboard in your browser")
	.action(handleUi);

const service = program.command("service").description("Manage the Syncthing daemon");
service.command("start").description("Start the Syncthing daemon").action(handleServiceStart);
service.command("stop").description("Stop the Syncthing daemon").action(handleServiceStop);
```

- [ ] **Step 7: Run tests, typecheck, lint, build**

Run: `pnpm test` then `pnpm typecheck` then `pnpm lint` then `pnpm build`
Expected: all green; `dist/cli.js` builds.

- [ ] **Step 8: Manual smoke check**

Run (requires a real config): `node dist/cli.js service start` then `node dist/cli.js ui`
Expected: prints a `http://127.0.0.1:<port>` URL; opening it shows the placeholder page with JSON from `/api/state`.

- [ ] **Step 9: Commit**

```bash
git add src/service/runtime.ts src/service/ui-placeholder.ts src/cli/commands/ui.ts src/cli/commands/service.ts src/cli/index.ts tests/service/runtime.test.ts
git commit -m "feat(cli): ccsync ui dashboard launcher and service start/stop"
```

---

## Final verification (after all tasks)

- [ ] `pnpm test` — all suites pass.
- [ ] `pnpm typecheck` — no errors.
- [ ] `pnpm lint` — clean.
- [ ] `pnpm build` — `dist/` builds.
- [ ] Manual: `ccsync ui` opens a browser showing live `/api/state`; toggling a bucket via `curl -H "X-Ccsync-Token: <token>" -d '{"target":"claude-plugins","on":true}' http://127.0.0.1:<port>/api/toggle` flips and auto-applies.

## Notes for the next plan (Phase 2)

- Replace the placeholder page with the React+shadcn SPA bundled into `dist/ui/`; the server already serves `/` — swap `UI_PLACEHOLDER_HTML` for static-file serving from `dist/ui/`.
- Add SSE `/api/events` by polling `SyncthingApi` (`connections`, per-folder `folderStatus`) and Syncthing `/rest/events`.
- Wire pause/metered + toggles to the dashboard UI; show throughput and active-machine.
