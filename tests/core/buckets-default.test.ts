import { describe, expect, it } from "vitest";
import { DEFAULT_BUCKETS, withCodeRootBucket } from "../../src/core/buckets-default.js";
import { ConfigSchema } from "../../src/core/config-schema.js";

describe("DEFAULT_BUCKETS", () => {
	it("contains the expected buckets", () => {
		const expected = [
			"claude-config",
			"claude-conversations",
			"claude-agent-state",
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

	it("syncs only the durable task lists, not machine-local runtime state", () => {
		const bucket = DEFAULT_BUCKETS["claude-agent-state"];
		expect(bucket.enabled).toBe(true);
		// Only tasks/ is portable+durable. jobs/session-env/file-history are
		// machine-local runtime/regenerable state and must NOT be synced — they
		// were the dominant conflict source at re-pair time.
		expect(bucket.paths).toEqual([expect.stringMatching(/\.claude[/\\]tasks$/)]);
		expect(bucket.paths).not.toEqual(
			expect.arrayContaining([
				expect.stringMatching(/\.claude[/\\]session-env$/),
				expect.stringMatching(/\.claude[/\\]file-history$/),
				expect.stringMatching(/\.claude[/\\]jobs$/),
			]),
		);
	});

	it("does not register standalone Claude config files as Syncthing folder roots", () => {
		expect(DEFAULT_BUCKETS["claude-config"].paths).not.toEqual(
			expect.arrayContaining([
				expect.stringMatching(/\.claude[/\\]settings\.json$/),
				expect.stringMatching(/\.claude[/\\]CLAUDE\.md$/),
				expect.stringMatching(/\.claude[/\\]keybindings\.json$/),
			]),
		);
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
		expect(Object.keys(cfg.buckets).length).toBe(8);
	});
});
