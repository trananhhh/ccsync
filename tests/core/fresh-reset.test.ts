import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resetCcsyncState } from "../../src/core/fresh-reset.js";

describe("resetCcsyncState", () => {
	it("removes both the ccsync state and syncthing home directories", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-fresh-"));
		const stateDir = path.join(tmp, ".ccsync");
		const syncthingDir = path.join(tmp, "syncthing");
		const dataDir = path.join(tmp, ".claude");

		await fs.mkdir(stateDir, { recursive: true });
		await fs.mkdir(syncthingDir, { recursive: true });
		await fs.mkdir(dataDir, { recursive: true });
		await fs.writeFile(path.join(stateDir, "config.yaml"), "machineName: test\n");
		await fs.writeFile(path.join(syncthingDir, "config.xml"), "<configuration/>");
		await fs.writeFile(path.join(dataDir, "settings.json"), "{}");

		await resetCcsyncState(stateDir, { syncthingHomeDir: syncthingDir });

		await expect(fs.stat(stateDir)).rejects.toThrow();
		await expect(fs.stat(syncthingDir)).rejects.toThrow();
		await expect(fs.stat(path.join(dataDir, "settings.json"))).resolves.toBeTruthy();
	});

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
