import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resetCcsyncState } from "../../src/core/fresh-reset.js";

describe("resetCcsyncState", () => {
	it("removes only the provided ccsync state directory", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-fresh-"));
		const stateDir = path.join(tmp, ".ccsync");
		const dataDir = path.join(tmp, ".claude");

		await fs.mkdir(stateDir, { recursive: true });
		await fs.mkdir(dataDir, { recursive: true });
		await fs.writeFile(path.join(stateDir, "config.yaml"), "machineName: test\n");
		await fs.writeFile(path.join(dataDir, "settings.json"), "{}");

		await resetCcsyncState(stateDir);

		await expect(fs.stat(stateDir)).rejects.toThrow();
		await expect(fs.stat(path.join(dataDir, "settings.json"))).resolves.toBeTruthy();
	});
});
