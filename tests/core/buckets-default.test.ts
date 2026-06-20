import { describe, expect, it } from "vitest";
import { DEFAULT_BUCKETS, withCodeRootBucket } from "../../src/core/buckets-default.js";
import { ConfigSchema } from "../../src/core/config-schema.js";

describe("DEFAULT_BUCKETS", () => {
	it("contains the expected buckets", () => {
		const expected = [
			"claude-config",
			"claude-conversations",
			"claude-worktrees",
			"claude-plugins",
			"shell-history",
			"code-root",
			"active-projects",
		];
		expect(Object.keys(DEFAULT_BUCKETS).sort()).toEqual(expected.sort());
	});

	it("has plugins and shell-history disabled by default for safety", () => {
		expect(DEFAULT_BUCKETS["claude-plugins"].enabled).toBe(false);
		expect(DEFAULT_BUCKETS["shell-history"].enabled).toBe(false);
	});

	it("has active-projects with empty paths by default", () => {
		expect(DEFAULT_BUCKETS["active-projects"].paths).toEqual([]);
	});

	it("has code-root disabled until a profile is configured", () => {
		expect(DEFAULT_BUCKETS["code-root"].enabled).toBe(false);
		expect(DEFAULT_BUCKETS["code-root"].paths).toEqual([]);
	});

	it("adds code-root to upgraded configs that do not have the bucket yet", () => {
		const buckets = withCodeRootBucket({}, "/Users/alice/work");

		expect(buckets["code-root"].enabled).toBe(true);
		expect(buckets["code-root"].paths).toEqual(["/Users/alice/work"]);
		expect(buckets["code-root"].versioning).toEqual(DEFAULT_BUCKETS["code-root"].versioning);
	});

	it("validates as a full config when wrapped", () => {
		const cfg = ConfigSchema.parse({
			machineName: "test",
			buckets: DEFAULT_BUCKETS,
		});
		expect(Object.keys(cfg.buckets).length).toBe(7);
	});
});
