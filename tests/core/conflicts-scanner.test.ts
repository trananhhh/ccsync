import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/core/config-schema.js";
import { findConflicts, resolveConflictsBulk } from "../../src/core/conflicts-scanner.js";

function bucketCfg(paths: string[], enabled = true): Config {
	return {
		machineName: "m",
		peers: [],
		buckets: {
			test: { enabled, paths, ignore: [], versioning: { type: "simple", keep: 5 } },
		},
		globalIgnore: [],
		metered: false,
	};
}

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

	it("parses source device + timestamp from the marker", async () => {
		await fs.writeFile(path.join(tmp, "note.sync-conflict-20260630-140738-NPH765F.md"), "x");
		const [c] = await findConflicts(bucketCfg([tmp]));
		expect(c.sourceDevice).toBe("NPH765F");
		expect(c.conflictTime).toBe("2026-06-30T14:07:38");
	});

	it("captures mtime + size of both copies when the original exists", async () => {
		await fs.writeFile(path.join(tmp, "note.md"), "the surviving original");
		await fs.writeFile(path.join(tmp, "note.sync-conflict-20260630-140738-NPH765F.md"), "remote");
		const [c] = await findConflicts(bucketCfg([tmp]));
		expect(c.conflictSize).toBe(6);
		expect(c.originalSize).toBe("the surviving original".length);
		expect(typeof c.conflictMtime).toBe("number");
		expect(typeof c.originalMtime).toBe("number");
	});

	it("leaves original metadata null when the original is gone", async () => {
		await fs.writeFile(path.join(tmp, "gone.sync-conflict-20260630-140738-NPH765F.md"), "remote");
		const [c] = await findConflicts(bucketCfg([tmp]));
		expect(c.originalMtime).toBeNull();
		expect(c.originalSize).toBeNull();
	});

	it("does not descend into heavy build dirs", async () => {
		const nm = path.join(tmp, "node_modules", "pkg");
		const dist = path.join(tmp, "dist");
		await fs.mkdir(nm, { recursive: true });
		await fs.mkdir(dist, { recursive: true });
		await fs.writeFile(path.join(nm, "a.sync-conflict-20260630-140738-AAAAAAA.js"), "x");
		await fs.writeFile(path.join(dist, "b.sync-conflict-20260630-140738-AAAAAAA.js"), "x");
		await fs.writeFile(path.join(tmp, "c.sync-conflict-20260630-140738-AAAAAAA.txt"), "x");
		const conflicts = await findConflicts(bucketCfg([tmp]));
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].path.endsWith("c.sync-conflict-20260630-140738-AAAAAAA.txt")).toBe(true);
	});
});

describe("resolveConflictsBulk", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-bulk-"));
	});

	afterEach(async () => {
		await fs.rm(tmp, { recursive: true, force: true });
	});

	it("applies keep-remote and keep-local across many files", async () => {
		await fs.writeFile(path.join(tmp, "a.md"), "old-a");
		await fs.writeFile(path.join(tmp, "a.sync-conflict-20260630-140738-AAAAAAA.md"), "new-a");
		await fs.writeFile(path.join(tmp, "b.md"), "keep-b");
		await fs.writeFile(path.join(tmp, "b.sync-conflict-20260630-140738-BBBBBBB.md"), "drop-b");

		const cfg = bucketCfg([tmp]);
		const conflicts = await findConflicts(cfg);
		const a = conflicts.find((c) => c.original.endsWith("a.md"));
		const b = conflicts.find((c) => c.original.endsWith("b.md"));
		if (!a || !b) throw new Error("setup failed");

		const result = await resolveConflictsBulk(cfg, [
			{ file: a.path, action: "keep-remote" },
			{ file: b.path, action: "keep-local" },
		]);
		expect(result.resolved).toBe(2);
		expect(result.errors).toEqual([]);
		expect(await fs.readFile(path.join(tmp, "a.md"), "utf-8")).toBe("new-a");
		expect(await fs.readFile(path.join(tmp, "b.md"), "utf-8")).toBe("keep-b");
		expect(await findConflicts(cfg)).toHaveLength(0);
	});

	it("records an error for an unknown path and resolves the rest", async () => {
		await fs.writeFile(path.join(tmp, "a.md"), "old");
		await fs.writeFile(path.join(tmp, "a.sync-conflict-20260630-140738-AAAAAAA.md"), "new");
		const cfg = bucketCfg([tmp]);
		const [a] = await findConflicts(cfg);

		const result = await resolveConflictsBulk(cfg, [
			{ file: a.path, action: "keep-local" },
			{ file: path.join(tmp, "nope.sync-conflict-20260630-140738-ZZZZZZZ.md"), action: "skip" },
		]);
		expect(result.resolved).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].error).toBe("conflict not found");
	});
});
