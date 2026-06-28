import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig, writeConfig } from "../../src/core/config-io.js";
import type { Config } from "../../src/core/config-schema.js";
import { encodeInvite } from "../../src/core/invite-token.js";
import type { SyncthingApi, SyncthingConfig } from "../../src/core/syncthing-api.js";
import type { StateMonitor } from "../../src/service/server.js";
import { type ControlServerDeps, createControlServer } from "../../src/service/server.js";

const SELF_ID = "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA";
const PEER_ID = "BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB";

function cfg(): Config {
	return {
		machineName: "m",
		peers: [],
		buckets: {
			"claude-config": {
				enabled: true,
				paths: [],
				ignore: [],
				versioning: { type: "simple", keep: 10 },
			},
		},
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
		apiFor: () =>
			({
				getConfig: async () => ({ version: 1, folders: [], devices: [] }),
				putConfig: async () => {},
			}) as unknown as SyncthingApi,
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
		const body = (await res.json()) as {
			machineName: string;
			buckets: Array<{ name: string; enabled: boolean }>;
			metered: boolean;
		};
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

	it("POST /api/pause pauses transfers and persists the flag", async () => {
		const base = await start();
		const res = await fetch(`${base}/api/pause`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
			body: JSON.stringify({ on: true }),
		});
		expect(res.status).toBe(200);
		expect((await res.json()) as { paused: boolean }).toEqual({ ok: true, paused: true });
		expect(saved?.metered).toBe(true);
	});
});

describe("control server hardening", () => {
	it("returns 401 for a POST with the wrong token", async () => {
		const base = await start();
		const res = await fetch(`${base}/api/toggle`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": "wrong" },
			body: JSON.stringify({ target: "claude-config", on: false }),
		});
		expect(res.status).toBe(401);
	});

	it("returns 401 on GET /api/events with a bad SSE token", async () => {
		const base = await start();
		const res = await fetch(`${base}/api/events?token=wrong`);
		expect(res.status).toBe(401);
	});

	it("returns 404 for an unknown route (fall-through)", async () => {
		const base = await start();
		const res = await fetch(`${base}/api/does-not-exist`, { headers: { "X-Ccsync-Token": TOKEN } });
		expect(res.status).toBe(404);
	});

	it("returns 400 for a malformed JSON body", async () => {
		const base = await start();
		const res = await fetch(`${base}/api/toggle`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
			body: "{ not json ",
		});
		expect(res.status).toBe(400);
	});

	it("rejects an oversize body: caps the read and destroys the socket", async () => {
		const base = await start();
		const { port } = new URL(base);
		// A >1MB body trips the cap; readJson calls req.destroy() so a mid-upload
		// client observes a torn-down socket rather than a 200. (The best-effort 413
		// rarely reaches the client because it is still streaming the body.)
		const outcome = await new Promise<{ status?: number; errored: boolean }>((resolve) => {
			const req = http.request(
				{
					host: "127.0.0.1",
					port: Number(port),
					method: "POST",
					path: "/api/toggle",
					headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
				},
				(res) => {
					res.resume();
					resolve({ status: res.statusCode, errored: false });
				},
			);
			req.on("error", () => resolve({ errored: true }));
			req.write("x".repeat(2_000_000));
			req.end();
		});
		// Either a 413 was delivered or the socket was destroyed — never a 200 success.
		expect(outcome.errored || outcome.status === 413).toBe(true);
		expect(outcome.status).not.toBe(200);
	});
});

describe("control server pairing + browse routes", () => {
	let pairServer: ReturnType<typeof createControlServer> | undefined;
	let tmpHome: string | undefined;

	afterEach(async () => {
		if (pairServer) {
			await new Promise<void>((r) => pairServer?.close(() => r()));
			pairServer = undefined;
		}
		if (tmpHome) {
			await fs.rm(tmpHome, { recursive: true, force: true });
			tmpHome = undefined;
		}
		vi.restoreAllMocks();
	});

	function pairCfg(): Config {
		return {
			machineName: "host",
			syncthing: { apiKey: "k", guiAddress: "127.0.0.1:1", homeDir: "/tmp/st" },
			peers: [],
			buckets: {},
			globalIgnore: [],
			metered: false,
		} as Config;
	}

	function startPair(overrides: Partial<ControlServerDeps>): Promise<string> {
		pairServer = createControlServer({
			token: TOKEN,
			configPath: "/tmp/x.yaml",
			apiFor: () =>
				({
					systemStatus: async () => ({ myID: SELF_ID, uptime: 0, startTime: "" }),
				}) as unknown as SyncthingApi,
			readConfig: async () => pairCfg(),
			detectSyncthing: async () => true,
			...overrides,
		});
		return new Promise<string>((resolve) => {
			pairServer?.listen(0, "127.0.0.1", () => {
				const { port } = pairServer?.address() as AddressInfo;
				resolve(`http://127.0.0.1:${port}`);
			});
		});
	}

	it("GET /api/state reports configured + syncthingInstalled + pairing", async () => {
		const base = await startPair({
			readConfig: async () => pairCfg(),
			detectSyncthing: async () => true,
		});
		const res = await fetch(`${base}/api/state`);
		const body = (await res.json()) as {
			configured: boolean;
			syncthingInstalled: boolean;
			pairing: boolean;
		};
		// syncthing present but no peers/rootProfile yet → not configured.
		expect(body.configured).toBe(false);
		expect(body.syncthingInstalled).toBe(true);
		expect(body.pairing).toBe(false);
	});

	it("POST /api/pair/invite rejects a missing token", async () => {
		const base = await startPair({});
		const res = await fetch(`${base}/api/pair/invite`, { method: "POST" });
		expect(res.status).toBe(401);
	});

	it("POST /api/pair/invite issues a token, command, and starts the auto-accept watcher", async () => {
		const createInvite = vi.fn(async () => ({
			id: "i1",
			issuedAt: "",
			expiresAt: "",
			maxUses: 1,
			uses: 0,
		}));
		const watchAutoAccept = vi.fn(async () => 0);
		const base = await startPair({ createInvite, watchAutoAccept });
		const res = await fetch(`${base}/api/pair/invite`, {
			method: "POST",
			headers: { "X-Ccsync-Token": TOKEN },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { token: string; command: string };
		expect(body.token).toMatch(/^ccs2_/);
		expect(body.command).toContain(body.token);
		expect(createInvite).toHaveBeenCalledTimes(1);
		// C3: the inviting machine must run the watcher so the joiner is admitted.
		expect(watchAutoAccept).toHaveBeenCalledTimes(1);

		// While the watcher window is open, /api/state reports pairing:true.
		const state = (await (await fetch(`${base}/api/state`)).json()) as { pairing: boolean };
		expect(state.pairing).toBe(true);
	});

	it("POST /api/pair/join passes the wizard localRoot to joinWithToken (never prompts)", async () => {
		const joinWithToken = vi.fn(async () => ({
			machineName: "host",
			rootProfileMapped: true,
			peerAdded: true,
			alreadyPaired: false,
			peerName: "macbook",
			deviceId: SELF_ID,
			foldersConfigured: 1,
			devicesConfigured: 1,
		}));
		const base = await startPair({ joinWithToken });
		const token = encodeInvite({ deviceId: SELF_ID, name: "macbook", introducer: true });
		const res = await fetch(`${base}/api/pair/join`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
			body: JSON.stringify({ token, localRoot: "/home/u/code" }),
		});
		expect(res.status).toBe(200);
		expect(joinWithToken).toHaveBeenCalledWith(
			token,
			expect.objectContaining({ localRoot: "/home/u/code" }),
		);
	});

	it("POST /api/pair/join rejects a missing token", async () => {
		const base = await startPair({});
		const res = await fetch(`${base}/api/pair/join`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	it("GET /api/folders/browse lists subdirectories within the home root", async () => {
		tmpHome = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-browse-")));
		await fs.mkdir(path.join(tmpHome, "projects"), { recursive: true });
		const base = await startPair({ homeRoot: tmpHome });
		const res = await fetch(`${base}/api/folders/browse?path=${encodeURIComponent(tmpHome)}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { entries: Array<{ name: string }> };
		expect(body.entries.map((e) => e.name)).toContain("projects");
	});

	it("GET /api/folders/browse rejects a path that escapes the home root", async () => {
		tmpHome = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-browse-")));
		const base = await startPair({ homeRoot: tmpHome });
		const res = await fetch(`${base}/api/folders/browse?path=${encodeURIComponent("/etc")}`);
		expect(res.status).toBe(400);
	});
});

describe("control server fresh-machine bootstrap + lazy monitor", () => {
	let bootServer: ReturnType<typeof createControlServer> | undefined;
	let tmpDir: string | undefined;

	afterEach(async () => {
		if (bootServer) {
			await new Promise<void>((r) => bootServer?.close(() => r()));
			bootServer = undefined;
		}
		if (tmpDir) {
			await fs.rm(tmpDir, { recursive: true, force: true });
			tmpDir = undefined;
		}
		vi.restoreAllMocks();
	});

	function fakeMonitor(): StateMonitor {
		return { subscribe: () => () => {} };
	}

	// Fakes for the side-effectful bootstrap primitives so the test exercises the
	// REAL no-config → bootstrap → join wiring without installing Syncthing or
	// starting a daemon. readConfig/writeConfig stay real against a temp path, so
	// the ENOENT is genuine — not mocked away.
	function bootDeps(configPath: string, overrides: Partial<ControlServerDeps>): ControlServerDeps {
		const applied: Config[] = [];
		return {
			token: TOKEN,
			configPath,
			apiFor: () => ({}) as unknown as SyncthingApi,
			ensureSyncthing: async () => ({
				installed: true,
				path: "/usr/bin/syncthing",
				message: "ok",
			}),
			bootstrapFreshHome: async () => ({
				apiKey: "fresh-key",
				guiAddress: "127.0.0.1:18888",
				deviceId: PEER_ID,
				pid: 1234,
			}),
			apply: async (c: Config) => {
				applied.push(c);
				return { foldersConfigured: 1, devicesConfigured: 1, stignoresWritten: 0 };
			},
			ensureDaemonRunning: async () => "already-running" as const,
			detectSyncthing: async () => true,
			...overrides,
		};
	}

	function listen(server: ReturnType<typeof createControlServer>): Promise<string> {
		return new Promise<string>((resolve) => {
			server.listen(0, "127.0.0.1", () => {
				const { port } = server.address() as AddressInfo;
				resolve(`http://127.0.0.1:${port}`);
			});
		});
	}

	async function eventsStatus(base: string): Promise<number> {
		const ctrl = new AbortController();
		try {
			const res = await fetch(`${base}/api/events?token=${TOKEN}`, { signal: ctrl.signal });
			return res.status;
		} finally {
			ctrl.abort();
		}
	}

	it("browser join on a fresh machine bootstraps a config then joins (ENOENT not mocked)", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-fresh-"));
		const configPath = path.join(tmpDir, "config.yaml");
		const ensureMonitor = vi.fn(async () => fakeMonitor());
		bootServer = createControlServer(bootDeps(configPath, { ensureMonitor }));
		const base = await listen(bootServer);

		// No config yet → the live feed is unavailable.
		expect(await eventsStatus(base)).toBe(503);

		const token = encodeInvite({ deviceId: PEER_ID, name: "host", introducer: true });
		const res = await fetch(`${base}/api/pair/join`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
			body: JSON.stringify({ token }),
		});
		expect(res.status).toBe(200);

		// A real config was written: bootstrapped Syncthing identity + the inviter peer.
		const written = await readConfig(configPath);
		expect(written.syncthing?.apiKey).toBe("fresh-key");
		expect(written.peers.map((p) => p.deviceId)).toContain(PEER_ID);

		// The monitor was lazily started → /api/events stops 503ing.
		expect(ensureMonitor).toHaveBeenCalled();
		expect(await eventsStatus(base)).toBe(200);
	});

	it("create-first via setup/init starts the monitor so the live feed comes alive", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-init-"));
		const configPath = path.join(tmpDir, "config.yaml");
		const ensureMonitor = vi.fn(async () => fakeMonitor());
		bootServer = createControlServer(bootDeps(configPath, { ensureMonitor }));
		const base = await listen(bootServer);

		expect(await eventsStatus(base)).toBe(503);

		const res = await fetch(`${base}/api/setup/init`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
			body: JSON.stringify({ machineName: "fresh-mac" }),
		});
		expect(res.status).toBe(200);

		const written = await readConfig(configPath);
		expect(written.machineName).toBe("fresh-mac");
		expect(written.syncthing?.apiKey).toBe("fresh-key");

		expect(ensureMonitor).toHaveBeenCalled();
		expect(await eventsStatus(base)).toBe(200);
	});
});

describe("control server conflicts routes", () => {
	let tmpDir: string | undefined;

	afterEach(async () => {
		if (tmpDir) {
			await fs.rm(tmpDir, { recursive: true, force: true });
			tmpDir = undefined;
		}
	});

	async function startWithConflict(): Promise<{ base: string; conflictPath: string }> {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-conf-"));
		const original = path.join(tmpDir, "notes.txt");
		const conflictPath = path.join(tmpDir, "notes.sync-conflict-20260101-120000-ABCDEF.txt");
		await fs.writeFile(original, "local");
		await fs.writeFile(conflictPath, "remote");
		const conflictCfg = {
			...cfg(),
			buckets: {
				"claude-config": {
					enabled: true,
					paths: [tmpDir],
					ignore: [],
					versioning: { type: "simple", keep: 10 },
				},
			},
		} as Config;
		server = createControlServer({
			token: TOKEN,
			configPath: "/tmp/x.yaml",
			apiFor: () => ({}) as unknown as SyncthingApi,
			readConfig: async () => conflictCfg,
		});
		const base = await new Promise<string>((resolve) => {
			server.listen(0, "127.0.0.1", () => {
				const { port } = server.address() as AddressInfo;
				resolve(`http://127.0.0.1:${port}`);
			});
		});
		return { base, conflictPath };
	}

	it("GET /api/conflicts lists scanned conflict files", async () => {
		const { base, conflictPath } = await startWithConflict();
		const res = await fetch(`${base}/api/conflicts`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { conflicts: Array<{ file: string; bucket: string }> };
		expect(body.conflicts).toHaveLength(1);
		expect(body.conflicts[0].file).toBe(conflictPath);
		expect(body.conflicts[0].bucket).toBe("claude-config");
	});

	it("POST /api/conflicts/resolve rejects a missing token", async () => {
		const { base, conflictPath } = await startWithConflict();
		const res = await fetch(`${base}/api/conflicts/resolve`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ file: conflictPath, action: "keep-local" }),
		});
		expect(res.status).toBe(401);
	});

	it("POST /api/conflicts/resolve keep-local removes the conflict copy", async () => {
		const { base, conflictPath } = await startWithConflict();
		const res = await fetch(`${base}/api/conflicts/resolve`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
			body: JSON.stringify({ file: conflictPath, action: "keep-local" }),
		});
		expect(res.status).toBe(200);
		await expect(fs.stat(conflictPath)).rejects.toBeTruthy();
	});

	it("POST /api/conflicts/resolve 404s for a path the scanner does not report", async () => {
		const { base } = await startWithConflict();
		const res = await fetch(`${base}/api/conflicts/resolve`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
			body: JSON.stringify({ file: "/etc/passwd", action: "keep-local" }),
		});
		expect(res.status).toBe(404);
	});
});

describe("control server handoff route", () => {
	function startHandoff(opts: { needBytes: number; onRemoveLock?: () => void }): Promise<string> {
		const handoffCfg = {
			...cfg(),
			syncthing: { apiKey: "k", guiAddress: "127.0.0.1:1", homeDir: "/tmp" },
			buckets: {
				"claude-config": {
					enabled: true,
					paths: ["/tmp/ccsync-handoff-path"],
					ignore: [],
					versioning: { type: "simple", keep: 10 },
				},
			},
		} as Config;
		server = createControlServer({
			token: TOKEN,
			configPath: "/tmp/x.yaml",
			apiFor: () =>
				({
					systemStatus: async () => ({ myID: SELF_ID, uptime: 0, startTime: "" }),
					folderStatus: async () => ({ needBytes: opts.needBytes, needFiles: 0 }),
				}) as unknown as SyncthingApi,
			readConfig: async () => handoffCfg,
			removeActiveLock: async () => opts.onRemoveLock?.(),
		});
		return new Promise<string>((resolve) => {
			server.listen(0, "127.0.0.1", () => {
				const { port } = server.address() as AddressInfo;
				resolve(`http://127.0.0.1:${port}`);
			});
		});
	}

	it("rejects a missing token", async () => {
		const base = await startHandoff({ needBytes: 0 });
		const res = await fetch(`${base}/api/handoff/release`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(401);
	});

	it("reports synced and releases the lock when nothing is pending", async () => {
		let removed = false;
		const base = await startHandoff({ needBytes: 0, onRemoveLock: () => (removed = true) });
		const res = await fetch(`${base}/api/handoff/release`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(200);
		expect((await res.json()) as { status: string }).toEqual({ status: "synced" });
		expect(removed).toBe(true);
	});

	it("reports pending without releasing the lock while a folder still needs bytes", async () => {
		let removed = false;
		const base = await startHandoff({ needBytes: 100, onRemoveLock: () => (removed = true) });
		const res = await fetch(`${base}/api/handoff/release`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
			body: JSON.stringify({ timeoutMs: 1000 }),
		});
		expect(res.status).toBe(200);
		expect((await res.json()) as { status: string }).toEqual({ status: "pending" });
		expect(removed).toBe(false);
	});
});

describe("control server metered integration (real apply round-trip)", () => {
	let tmpDir: string | undefined;
	let integrationServer: ReturnType<typeof createControlServer> | undefined;

	afterEach(async () => {
		if (integrationServer) {
			await new Promise<void>((r) => integrationServer?.close(() => r()));
			integrationServer = undefined;
		}
		if (tmpDir) {
			await fs.rm(tmpDir, { recursive: true, force: true });
			tmpDir = undefined;
		}
	});

	it("the final PUT from a real apply keeps every owned device paused when metered turns on", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-int-"));
		const configPath = path.join(tmpDir, "config.yaml");
		await writeConfig(configPath, {
			machineName: "test-machine",
			syncthing: { apiKey: "k", guiAddress: "127.0.0.1:18384", homeDir: tmpDir },
			peers: [{ deviceId: PEER_ID, name: "peer1", addresses: ["dynamic"], introducer: false }],
			buckets: {
				"claude-config": {
					enabled: true,
					paths: [],
					ignore: [],
					versioning: { type: "simple", keep: 10 },
				},
			},
			globalIgnore: [],
			metered: false,
		} as Config);

		const puts: SyncthingConfig[] = [];
		const fakeApi = {
			systemStatus: async () => ({ myID: SELF_ID, uptime: 0, startTime: "" }),
			getConfig: async () => ({
				version: 1,
				folders: [],
				devices: [
					{ deviceID: SELF_ID, name: "test-machine", addresses: ["dynamic"] },
					{ deviceID: PEER_ID, name: "peer1", addresses: ["dynamic"] },
				],
			}),
			putConfig: async (c: SyncthingConfig) => {
				puts.push(c);
			},
			scan: async () => {},
		} as unknown as SyncthingApi;

		integrationServer = createControlServer({
			token: TOKEN,
			configPath,
			apiFor: () => fakeApi,
		});

		const base = await new Promise<string>((resolve) => {
			integrationServer?.listen(0, "127.0.0.1", () => {
				const { port } = integrationServer?.address() as AddressInfo;
				resolve(`http://127.0.0.1:${port}`);
			});
		});

		const res = await fetch(`${base}/api/metered`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Ccsync-Token": TOKEN },
			body: JSON.stringify({ on: true }),
		});
		expect(res.status).toBe(200);

		expect(puts.length).toBeGreaterThan(0);
		const finalPut = puts[puts.length - 1];
		expect(finalPut.devices.length).toBeGreaterThan(0);
		expect(finalPut.devices.every((d) => d.paused === true)).toBe(true);
	});
});
