import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	findUnanchoredNegations,
	parseCcsyncignore,
	readCcsyncignore,
	usesBackslash,
} from "../../src/core/ccsyncignore.js";

describe("parseCcsyncignore", () => {
	it("strips // comments and blank lines, preserves order", () => {
		const input = `
// heading
foo
// another
bar
`;
		expect(parseCcsyncignore(input)).toEqual(["foo", "bar"]);
	});

	it("handles CRLF and trims trailing whitespace", () => {
		const input = "foo   \r\nbar\t\r\n";
		expect(parseCcsyncignore(input)).toEqual(["foo", "bar"]);
	});

	it("preserves // comment detection across prefixed content", () => {
		const input = "// comment\n!root-anchored\n";
		expect(parseCcsyncignore(input)).toEqual(["!root-anchored"]);
	});

	it("returns an empty array when content has only blanks and comments", () => {
		expect(parseCcsyncignore("// only\n\n// comments\n")).toEqual([]);
	});
});

describe("findUnanchoredNegations", () => {
	it("surfaces !foo but skips !/foo", () => {
		const lines = ["!/root-anchored", "!nested/case", "!coverage/x", "!/other-root"];
		expect(findUnanchoredNegations(lines)).toEqual(["!nested/case", "!coverage/x"]);
	});

	it("ignores bare ! with no body", () => {
		expect(findUnanchoredNegations(["!", "!  "])).toEqual([]);
	});

	it("ignores non-negation patterns", () => {
		expect(findUnanchoredNegations(["foo", ".git/", "!"])).toEqual([]);
	});
});

describe("usesBackslash", () => {
	it("detects cross-platform paths", () => {
		expect(usesBackslash(["foo\\bar", "linux/path"])).toBe(true);
	});

	it("returns false when no line contains a backslash", () => {
		expect(usesBackslash(["foo/bar", "baz/qux"])).toBe(false);
	});

	it("treats empty input as no-backslash", () => {
		expect(usesBackslash([])).toBe(false);
	});
});

describe("readCcsyncignore (disk)", () => {
	let tmpRoot: string;

	beforeEach(async () => {
		tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ccsyncignore-"));
	});

	afterEach(async () => {
		await fs.rm(tmpRoot, { recursive: true, force: true });
	});

	it("returns [] when the file is missing", async () => {
		await expect(readCcsyncignore(tmpRoot)).resolves.toEqual([]);
	});

	it("reads and parses the file when present", async () => {
		await fs.writeFile(path.join(tmpRoot, ".ccsyncignore"), "// header\nfoo\n!/bar\n", "utf-8");
		await expect(readCcsyncignore(tmpRoot)).resolves.toEqual(["foo", "!/bar"]);
	});
});
