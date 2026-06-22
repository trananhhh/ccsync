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
});
