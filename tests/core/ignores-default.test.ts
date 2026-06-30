import { describe, expect, it } from "vitest";
import { buildStignore, GLOBAL_IGNORE_PATTERNS } from "../../src/core/ignores-default.js";

describe("ignores-default", () => {
	it("includes critical git protection patterns", () => {
		expect(GLOBAL_IGNORE_PATTERNS).toContain(".git/index");
		expect(GLOBAL_IGNORE_PATTERNS).toContain(".git/index.lock");
		expect(GLOBAL_IGNORE_PATTERNS).toContain(".git/HEAD.lock");
	});

	it("includes common build artifact patterns", () => {
		expect(GLOBAL_IGNORE_PATTERNS).toContain("node_modules");
		expect(GLOBAL_IGNORE_PATTERNS).toContain("dist");
		expect(GLOBAL_IGNORE_PATTERNS).toContain("__pycache__");
	});

	it("buildStignore puts global patterns before bucket patterns", () => {
		const out = buildStignore(["my-bucket-pattern"], ["extra-global"]);
		expect(out).toContain(".git/index");
		expect(out).toContain("extra-global");
		expect(out).toContain("my-bucket-pattern");
		const gitIdx = out.indexOf(".git/index");
		const bucketIdx = out.indexOf("my-bucket-pattern");
		expect(gitIdx).toBeLessThan(bucketIdx);
	});

	it("buildStignore emits the project section after the bucket section when projectIgnore is supplied", () => {
		const out = buildStignore(["bucket-only"], [], ["pnpm-lock.yaml", "!/coverage/lcov.info"]);
		const bucketIdx = out.indexOf("bucket-only");
		const projectHeaderIdx = out.indexOf("// Project (.ccsyncignore)");
		const firstProjectPatternIdx = out.indexOf("pnpm-lock.yaml");
		expect(projectHeaderIdx).toBeGreaterThan(bucketIdx);
		expect(firstProjectPatternIdx).toBeGreaterThan(projectHeaderIdx);
		expect(out).toContain("!/coverage/lcov.info");
	});

	it("buildStignore prepends #escape=\\ when projectIgnore contains a backslash", () => {
		const out = buildStignore([], [], ["win\\path\\pattern"]);
		expect(out.startsWith("#escape=\\\n")).toBe(true);
	});

	it("buildStignore omits the project section when projectIgnore is empty or undefined", () => {
		const noneOut = buildStignore(["bucket-only"], []);
		expect(noneOut).not.toContain("// Project (.ccsyncignore)");
		const emptyOut = buildStignore(["bucket-only"], [], []);
		expect(emptyOut).not.toContain("// Project (.ccsyncignore)");
	});

	it("prefixes (?d) on global + bucket patterns so remote dir deletes are not wedged", () => {
		const out = buildStignore(["*.lock"], ["extra-global"]);
		expect(out).toContain("(?d).git/index");
		expect(out).toContain("(?d)extra-global");
		expect(out).toContain("(?d)*.lock");
	});

	it("never (?d)-flags ambiguous build-output dirs that could be real source", () => {
		const out = buildStignore(["build", "dist", "out", "target"]);
		// these names can legitimately be tracked source — must NOT be auto-deletable
		expect(out).toContain("\nbuild");
		expect(out).toContain("\ndist");
		expect(out).not.toContain("(?d)build");
		expect(out).not.toContain("(?d)dist");
		expect(out).not.toContain("(?d)out");
		expect(out).not.toContain("(?d)target");
		// node_modules is never source — it keeps the delete flag
		expect(out).toContain("(?d)node_modules");
	});

	it("leaves project negations and already-flagged patterns untouched", () => {
		const out = buildStignore([], [], ["!/keep.txt", "(?i)CaseInsensitive"]);
		expect(out).toContain("!/keep.txt");
		expect(out).not.toContain("(?d)!/keep.txt");
		expect(out).toContain("(?i)CaseInsensitive");
		expect(out).not.toContain("(?d)(?i)");
	});
});
