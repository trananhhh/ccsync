import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/core/config-schema.js";
import type { SyncthingApi } from "../../src/core/syncthing-api.js";
import { createControlServer } from "../../src/service/server.js";

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
