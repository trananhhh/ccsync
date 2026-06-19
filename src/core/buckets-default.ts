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
			path.join(claude, "settings.json"),
			path.join(claude, "CLAUDE.md"),
			path.join(claude, "keybindings.json"),
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
		paths: [
			path.join(home, ".zsh_history"),
			path.join(home, ".bash_history"),
			path.join(claude, "history.jsonl"),
		],
		ignore: [],
		versioning: { type: "simple", keep: 10 },
	},
	"active-projects": {
		enabled: false,
		paths: [],
		ignore: [],
		versioning: { type: "staggered", keep: 30 },
	},
};
