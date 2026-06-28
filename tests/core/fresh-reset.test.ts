import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resetCcsyncState } from "../../src/core/fresh-reset.js";

describe("resetCcsyncState", () => {
	it("removes the ccsync home (which contains the dedicated syncthing home)", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-fresh-"));
		const stateDir = path.join(tmp, ".ccsync");
		const syncthingDir = path.join(stateDir, "syncthing");
		const userSyncthing = path.join(tmp, "user-syncthing");

		await fs.mkdir(syncthingDir, { recursive: true });
		await fs.mkdir(userSyncthing, { recursive: true });
		await fs.writeFile(path.join(stateDir, "config.yaml"), "machineName: test\n");
		await fs.writeFile(path.join(syncthingDir, "config.xml"), "<configuration/>");
		await fs.writeFile(path.join(userSyncthing, "config.xml"), "<configuration/>");

		await resetCcsyncState(stateDir);

		await expect(fs.stat(stateDir)).rejects.toThrow();
		await expect(fs.stat(syncthingDir)).rejects.toThrow();
		// A user's own Syncthing home outside ~/.ccsync is left untouched.
		await expect(fs.stat(path.join(userSyncthing, "config.xml"))).resolves.toBeTruthy();
	});

	it("stops the daemon before removing the ccsync home", async () => {
		const removed: string[] = [];
		let stopped = false;
		await resetCcsyncState("/tmp/ccsync-home", {
			stop: async () => {
				stopped = true;
			},
			removeDir: async (dir) => {
				removed.push(dir);
			},
		});
		expect(stopped).toBe(true);
		expect(removed).toEqual(["/tmp/ccsync-home"]);
	});
});
