import * as os from "node:os";
import * as path from "node:path";
import type { Bucket } from "./config-schema.js";

const home = os.homedir();
const claude = path.join(home, ".claude");

export const DEFAULT_BUCKETS: Record<string, Bucket> = {
	"claude-config": {
		enabled: true,
		paths: [
			path.join(claude, "agents"),
			path.join(claude, "commands"),
			path.join(claude, "hooks"),
			path.join(claude, "rules"),
			path.join(claude, "skills"),
			path.join(claude, "output-styles"),
		],
		ignore: ["*.log", "*.lock", "*.bak-*"],
		versioning: { type: "simple", keep: 10 },
	},
	"claude-conversations": {
		enabled: true,
		paths: [path.join(claude, "projects")],
		ignore: ["*.tmp"],
		versioning: { type: "simple", keep: 5 },
	},
	"claude-agent-state": {
		enabled: true,
		paths: [
			path.join(claude, "tasks"),
			path.join(claude, "jobs"),
			path.join(claude, "session-env"),
			path.join(claude, "file-history"),
		],
		ignore: ["*.tmp", "*.lock"],
		versioning: { type: "simple", keep: 5 },
	},
	"claude-worktrees": {
		enabled: true,
		paths: [path.join(claude, "worktrees")],
		ignore: [],
		versioning: { type: "simple", keep: 3 },
	},
	"claude-plugins": {
		enabled: false,
		paths: [path.join(claude, "plugins")],
		ignore: ["cache/", "install-counts-cache.json"],
		versioning: { type: "none", keep: 0 },
	},
	"shell-history": {
		enabled: false,
		paths: [],
		ignore: [],
		versioning: { type: "simple", keep: 10 },
	},
	"code-root": {
		enabled: false,
		paths: [],
		ignore: [],
		versioning: { type: "staggered", keep: 30 },
	},
	"active-projects": {
		enabled: false,
		paths: [],
		ignore: [],
		versioning: { type: "staggered", keep: 30 },
	},
};

export function withCodeRootBucket(
	buckets: Record<string, Bucket>,
	localRoot: string,
	relativePaths: string[] = ["."],
): Record<string, Bucket> {
	const current = buckets["code-root"] ?? DEFAULT_BUCKETS["code-root"];
	const paths = relativePaths.map((relativePath) => path.join(localRoot, relativePath));
	return {
		...buckets,
		"code-root": {
			...current,
			enabled: paths.length > 0,
			paths,
		},
	};
}

export function withDefaultBuckets(buckets: Record<string, Bucket>): Record<string, Bucket> {
	return {
		...DEFAULT_BUCKETS,
		...buckets,
	};
}
