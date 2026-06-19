import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	autoMergeFile,
	detectFormat,
	merge,
	parse,
	serialize,
} from "../../src/core/history-merge.js";

describe("history-merge", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-hist-"));
	});

	afterEach(async () => {
		await fs.rm(tmp, { recursive: true, force: true });
	});

	describe("detectFormat", () => {
		it("identifies jsonl", () => expect(detectFormat("/x/history.jsonl")).toBe("jsonl"));
		it("identifies zsh", () => expect(detectFormat("/x/.zsh_history")).toBe("zsh-extended"));
		it("falls back to bash", () => expect(detectFormat("/x/.bash_history")).toBe("bash"));
	});

	describe("parse + merge + serialize", () => {
		it("merges zsh EXTENDED_HISTORY entries sorted by timestamp", () => {
			const a = parse(": 1700000010:0;ls\n: 1700000030:0;pwd\n", "zsh-extended");
			const b = parse(": 1700000020:0;cd ~\n", "zsh-extended");
			const out = serialize(merge(a, b));
			expect(out).toBe(": 1700000010:0;ls\n: 1700000020:0;cd ~\n: 1700000030:0;pwd\n");
		});

		it("dedupes identical lines", () => {
			const a = parse("foo\nbar\n", "bash");
			const b = parse("bar\nbaz\n", "bash");
			const out = serialize(merge(a, b));
			expect(out.split("\n").filter(Boolean).sort()).toEqual(["bar", "baz", "foo"]);
		});

		it("merges JSONL by timestamp field", () => {
			const a = parse(
				`{"timestamp": 100, "cmd": "a"}\n{"timestamp": 300, "cmd": "c"}\n`,
				"jsonl",
			);
			const b = parse(`{"timestamp": 200, "cmd": "b"}\n`, "jsonl");
			const merged = merge(a, b);
			expect(merged.map((e) => JSON.parse(e.raw).cmd)).toEqual(["a", "b", "c"]);
		});
	});

	describe("autoMergeFile", () => {
		it("merges conflict into original and removes conflict file", async () => {
			const orig = path.join(tmp, ".zsh_history");
			const conflict = path.join(tmp, ".zsh_history.sync-conflict-20260619-150000-AAAAAAA");
			await fs.writeFile(orig, ": 100:0;a\n: 300:0;c\n");
			await fs.writeFile(conflict, ": 200:0;b\n");
			await autoMergeFile(orig, conflict);
			const content = await fs.readFile(orig, "utf-8");
			expect(content).toBe(": 100:0;a\n: 200:0;b\n: 300:0;c\n");
			await expect(fs.access(conflict)).rejects.toThrow();
		});
	});
});
