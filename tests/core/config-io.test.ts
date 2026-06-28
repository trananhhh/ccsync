import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configExists, readConfig, writeConfig } from "../../src/core/config-io.js";
import type { Config } from "../../src/core/config-schema.js";

describe("config-io", () => {
	let tmpDir: string;
	let configPath: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-test-"));
		configPath = path.join(tmpDir, "config.yaml");
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("returns false when config does not exist", async () => {
		expect(await configExists(configPath)).toBe(false);
	});

	it("writes and reads back a valid config", async () => {
		const cfg: Config = {
			machineName: "macbook-pro",
			peers: [],
			buckets: {
				test: {
					enabled: true,
					paths: ["/tmp/foo"],
					ignore: [],
					versioning: { type: "simple", keep: 5 },
				},
			},
			globalIgnore: [],
		};
		await writeConfig(configPath, cfg);
		expect(await configExists(configPath)).toBe(true);
		const loaded = await readConfig(configPath);
		expect(loaded.machineName).toBe("macbook-pro");
		expect(loaded.buckets.test.paths).toEqual(["/tmp/foo"]);
	});

	it("adds missing default buckets when reading older configs", async () => {
		const cfg: Config = {
			machineName: "macbook-pro",
			peers: [],
			buckets: {
				"claude-config": {
					enabled: false,
					paths: ["/custom/claude/agents"],
					ignore: ["custom-ignore"],
					versioning: { type: "simple", keep: 2 },
				},
			},
			globalIgnore: [],
		};
		await writeConfig(configPath, cfg);

		const loaded = await readConfig(configPath);

		expect(loaded.buckets["claude-agent-state"].enabled).toBe(true);
		expect(loaded.buckets["claude-config"].paths).toEqual(["/custom/claude/agents"]);
		expect(loaded.buckets["claude-config"].ignore).toEqual(["custom-ignore"]);
	});

	it("rejects invalid config on read", async () => {
		await fs.writeFile(configPath, "machineName: 123\nbuckets: not-an-object\n");
		await expect(readConfig(configPath)).rejects.toThrow();
	});

	it("rejects invalid device IDs on peer", async () => {
		const bad = {
			machineName: "x",
			peers: [{ deviceId: "INVALID", name: "p", addresses: ["dynamic"] }],
			buckets: {},
			globalIgnore: [],
		};
		await fs.writeFile(configPath, JSON.stringify(bad));
		await expect(readConfig(configPath)).rejects.toThrow();
	});
});
