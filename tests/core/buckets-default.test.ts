import { describe, expect, it } from "vitest";
import { DEFAULT_BUCKETS } from "../../src/core/buckets-default.js";
import { ConfigSchema } from "../../src/core/config-schema.js";

describe("DEFAULT_BUCKETS", () => {
	it("contains the expected buckets", () => {
		const expected = [
			"claude-config",
			"claude-conversations",
			"claude-worktrees",
			"claude-plugins",
			"shell-history",
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

	it("validates as a full config when wrapped", () => {
		const cfg = ConfigSchema.parse({
			machineName: "test",
			buckets: DEFAULT_BUCKETS,
		});
		expect(Object.keys(cfg.buckets).length).toBe(6);
	});
});
