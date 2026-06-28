import * as fs from "node:fs/promises";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeConfig } from "../../src/core/config-io.js";
import type { Config } from "../../src/core/config-schema.js";
import type { SyncthingApi, SyncthingConfig } from "../../src/core/syncthing-api.js";
import { createControlServer } from "../../src/service/server.js";

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
