import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/core/config-schema.js";
import { findConflicts } from "../../src/core/conflicts-scanner.js";

describe("findConflicts", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-conf-"));
	});

	afterEach(async () => {
		await fs.rm(tmp, { recursive: true, force: true });
	});

	it("finds .sync-conflict-* files under enabled bucket paths", async () => {
		const sub = path.join(tmp, "sub");
		await fs.mkdir(sub, { recursive: true });
		await fs.writeFile(path.join(tmp, "foo.sync-conflict-20260619-150000-AAAAAAA.txt"), "x");
		await fs.writeFile(path.join(sub, "bar.sync-conflict-20260619-160000-BBBBBBB"), "y");
		await fs.writeFile(path.join(tmp, "normal.txt"), "z");

		const cfg: Config = {
			machineName: "m",
			peers: [],
			buckets: {
				test: { enabled: true, paths: [tmp], ignore: [], versioning: { type: "simple", keep: 5 } },
			},
			globalIgnore: [],
			metered: false,
		};
		const conflicts = await findConflicts(cfg);
		expect(conflicts).toHaveLength(2);
	});

	it("skips disabled buckets", async () => {
		await fs.writeFile(path.join(tmp, "x.sync-conflict-20260619-150000-AAAAAAA.txt"), "x");
		const cfg: Config = {
			machineName: "m",
			peers: [],
			buckets: {
				test: { enabled: false, paths: [tmp], ignore: [], versioning: { type: "simple", keep: 5 } },
			},
			globalIgnore: [],
			metered: false,
		};
		expect(await findConflicts(cfg)).toEqual([]);
	});

	it("flags shell-history conflict files", async () => {
		await fs.writeFile(path.join(tmp, ".zsh_history.sync-conflict-20260619-150000-AAAAAAA"), "");
		const cfg: Config = {
			machineName: "m",
			peers: [],
			buckets: {
				test: { enabled: true, paths: [tmp], ignore: [], versioning: { type: "simple", keep: 5 } },
			},
			globalIgnore: [],
			metered: false,
		};
		const conflicts = await findConflicts(cfg);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].isHistoryFile).toBe(true);
	});
});
