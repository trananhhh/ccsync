import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conflictDiff } from "../../src/core/conflict-diff.js";

describe("conflictDiff", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-diff-"));
	});

	afterEach(async () => {
		await fs.rm(tmp, { recursive: true, force: true });
	});

	it("returns a unified patch for two text files", async () => {
		const original = path.join(tmp, "note.md");
		const conflict = path.join(tmp, "note.sync-conflict-20260630-140738-AAAAAAA.md");
		await fs.writeFile(original, "line one\nline two\n");
		await fs.writeFile(conflict, "line one\nline TWO\n");
		const result = await conflictDiff(conflict, original);
		expect(result.status).toBe("ok");
		expect(result.patch).toContain("-line two");
		expect(result.patch).toContain("+line TWO");
	});

	it("flags binary content (NUL byte)", async () => {
		const original = path.join(tmp, "bin");
		const conflict = path.join(tmp, "bin.sync-conflict-20260630-140738-AAAAAAA");
		await fs.writeFile(original, Buffer.from([0x00, 0x01, 0x02]));
		await fs.writeFile(conflict, Buffer.from([0x00, 0x03]));
		expect((await conflictDiff(conflict, original)).status).toBe("binary");
	});

	it("flags oversized files", async () => {
		const original = path.join(tmp, "big.txt");
		const conflict = path.join(tmp, "big.sync-conflict-20260630-140738-AAAAAAA.txt");
		await fs.writeFile(original, "a".repeat(600 * 1024));
		await fs.writeFile(conflict, "b".repeat(600 * 1024));
		expect((await conflictDiff(conflict, original)).status).toBe("too-large");
	});

	it("reports missing original", async () => {
		const conflict = path.join(tmp, "x.sync-conflict-20260630-140738-AAAAAAA.txt");
		await fs.writeFile(conflict, "remote only");
		const result = await conflictDiff(conflict, path.join(tmp, "x.txt"));
		expect(result.status).toBe("missing-original");
	});
});
