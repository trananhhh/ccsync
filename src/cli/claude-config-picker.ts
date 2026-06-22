import * as path from "node:path";
import { checkbox, confirm } from "@inquirer/prompts";
import pc from "picocolors";
import type { Bucket } from "../core/config-schema.js";
import { tryPrompt } from "../lib/prompt-or.js";

export async function pickClaudeConfigPaths(bucket: Bucket): Promise<Bucket> {
	const items = bucket.paths.map((configPath) => ({
		path: configPath,
		label: labelForConfigPath(configPath),
	}));
	if (items.length === 0) return bucket;

	const result = await tryPrompt(
		async () => {
			const skipAll = await confirm({
				message: "Sync Claude Code config?",
				default: true,
			});
			if (!skipAll) return { enabled: false as const, paths: [] };
			const picked = await checkbox<string>({
				message: "Claude Code config items to sync (space to toggle, enter to confirm):",
				choices: items.map((item) => ({
					name: item.label,
					value: item.path,
					checked: true,
					description: pc.dim(item.path),
				})),
			});
			return { enabled: true as const, paths: picked };
		},
		(): { enabled: true; paths: string[] } => ({ enabled: true, paths: bucket.paths }),
	);

	return {
		...bucket,
		enabled: result.enabled && result.paths.length > 0,
		paths: result.enabled ? result.paths : [],
	};
}

function labelForConfigPath(configPath: string): string {
	const base = path.basename(configPath);
	if (base === ".claude") return "Claude home";
	return base;
}
