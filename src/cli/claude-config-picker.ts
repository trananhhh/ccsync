import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import type { Bucket } from "../core/config-schema.js";

export async function pickClaudeConfigPaths(bucket: Bucket): Promise<Bucket> {
	const items = bucket.paths.map((configPath) => ({
		path: configPath,
		label: labelForConfigPath(configPath),
	}));
	if (items.length === 0) return bucket;

	const selected = new Set(bucket.paths);
	console.log("\nClaude Code config items to sync:");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		while (true) {
			render(items, selected);
			const ans = (
				await rl.question("\nToggle numbers, `n` to skip all Claude config, Enter to confirm: ")
			)
				.trim()
				.toLowerCase();
			if (ans === "") break;
			if (ans === "n") {
				selected.clear();
				break;
			}
			const nums = ans.split(/[\s,]+/).map((s) => Number.parseInt(s, 10) - 1);
			for (const n of nums) {
				if (n < 0 || n >= items.length) continue;
				const item = items[n].path;
				if (selected.has(item)) selected.delete(item);
				else selected.add(item);
			}
			console.log("");
		}
	} finally {
		rl.close();
	}

	const paths = items.map((item) => item.path).filter((item) => selected.has(item));
	return {
		...bucket,
		enabled: paths.length > 0,
		paths,
	};
}

function render(items: Array<{ path: string; label: string }>, selected: Set<string>): void {
	items.forEach((item, i) => {
		const checked = selected.has(item.path) ? pc.green("[✓]") : pc.dim("[ ]");
		const num = pc.dim(String(i + 1).padStart(2, " "));
		console.log(`  ${num}  ${checked}  ${item.label}  ${pc.dim(item.path)}`);
	});
}

function labelForConfigPath(configPath: string): string {
	const base = path.basename(configPath);
	if (base === ".claude") return "Claude home";
	return base;
}
