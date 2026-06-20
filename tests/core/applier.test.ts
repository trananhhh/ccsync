import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { collectStignoreTargets } from "../../src/core/applier.js";
import type { Config } from "../../src/core/config-schema.js";
import { createRootProfile } from "../../src/core/root-profile.js";

describe("collectStignoreTargets", () => {
	it("includes mapped conversation folders instead of the raw legacy conversations root", () => {
		const cfg: Config = {
			machineName: "macbook",
			peers: [],
			globalIgnore: [],
			rootProfile: createRootProfile({
				id: "profile-a",
				canonicalRoot: "/Users/alice/work",
				localRoot: "/Users/alice/work",
				projects: [{ relativePath: "ccsync" }],
			}),
			buckets: {
				"code-root": {
					enabled: true,
					paths: ["/Users/alice/work"],
					ignore: ["node_modules"],
					versioning: { type: "staggered", keep: 30 },
				},
				"claude-conversations": {
					enabled: true,
					paths: ["/Users/alice/.claude/projects"],
					ignore: ["*.tmp"],
					versioning: { type: "simple", keep: 5 },
				},
			},
		};

		const targets = collectStignoreTargets(cfg);

		expect(targets.map((target) => target.folderPath)).toEqual([
			path.normalize("/Users/alice/work"),
			path.normalize(`${process.env.HOME}/.claude/projects/-Users-alice-work-ccsync`),
		]);
		expect(targets[1].bucket.ignore).toEqual(["*.tmp"]);
	});
});
