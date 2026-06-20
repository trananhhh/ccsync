import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import { listClaudeProjects } from "../core/claude-projects.js";
import type { Bucket } from "../core/config-schema.js";
import { log } from "../lib/log.js";

interface BucketChoice {
	key: string;
	label: string;
	hint: string;
}

const BUCKET_LABELS: BucketChoice[] = [
	{
		key: "claude-config",
		label: "Claude config",
		hint: "agents, commands, hooks, rules, skills, settings, CLAUDE.md",
	},
	{ key: "claude-conversations", label: "Conversations", hint: "~/.claude/projects/" },
	{ key: "claude-worktrees", label: "Worktrees", hint: "~/.claude/worktrees/" },
	{
		key: "claude-plugins",
		label: "Plugins",
		hint: "~/.claude/plugins/ (reproducible from marketplace)",
	},
	{
		key: "shell-history",
		label: "Shell history",
		hint: ".zsh_history, .bash_history, Claude history.jsonl",
	},
];

export async function pickBuckets(
	buckets: Record<string, Bucket>,
): Promise<Record<string, Bucket>> {
	const next = { ...buckets };
	const items = BUCKET_LABELS.filter((b) => next[b.key]);
	if (items.length === 0) return next;

	console.log("\nWhat to sync? (press Enter to keep current, or list numbers to toggle)");
	render(next, items);

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		while (true) {
			const ans = (await rl.question("> ")).trim();
			if (ans === "") return next;
			const nums = ans.split(/[\s,]+/).map((s) => Number.parseInt(s, 10) - 1);
			for (const n of nums) {
				if (n >= 0 && n < items.length) {
					const k = items[n].key;
					next[k] = { ...next[k], enabled: !next[k].enabled };
				}
			}
			console.log("");
			render(next, items);
		}
	} finally {
		rl.close();
	}
}

function render(buckets: Record<string, Bucket>, items: BucketChoice[]): void {
	items.forEach((b, i) => {
		const checked = buckets[b.key].enabled ? pc.green("[✓]") : pc.dim("[ ]");
		const num = pc.dim(String(i + 1).padStart(2, " "));
		console.log(`  ${num}  ${checked}  ${b.label}  ${pc.dim(`— ${b.hint}`)}`);
	});
}

export async function pickProjects(current: string[]): Promise<string[]> {
	const detected = (await listClaudeProjects()).filter((p) => p.exists).map((p) => p.projectPath);
	const candidates = Array.from(new Set([...current, ...detected]));
	if (candidates.length === 0) {
		console.log(
			"\nNo Claude Code projects detected. You can add any later with `ccsync advanced project add <path>`.",
		);
		return current;
	}

	const selected = new Set(current.length > 0 ? current : detected);
	console.log("\nProject working trees to sync (uncommitted edits sync too):");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		while (true) {
			render2(candidates, selected);
			const ans = (
				await rl.question("\nToggle numbers, `a /path` to add, `n` to skip all, Enter to confirm: ")
			).trim();
			if (ans === "") break;
			if (ans === "n") {
				selected.clear();
				break;
			}
			if (ans.startsWith("a ")) {
				const p = path.resolve(ans.slice(2).trim());
				try {
					const s = await fs.stat(p);
					if (s.isDirectory() && !candidates.includes(p)) {
						candidates.push(p);
						selected.add(p);
					} else log.warn(`Not a directory: ${p}`);
				} catch {
					log.warn(`Path does not exist: ${p}`);
				}
				continue;
			}
			const nums = ans.split(/[\s,]+/).map((s) => Number.parseInt(s, 10) - 1);
			for (const n of nums) {
				if (n >= 0 && n < candidates.length) {
					const k = candidates[n];
					if (selected.has(k)) selected.delete(k);
					else selected.add(k);
				}
			}
			console.log("");
		}
	} finally {
		rl.close();
	}
	return [...selected];
}

function render2(items: string[], selected: Set<string>): void {
	items.forEach((p, i) => {
		const checked = selected.has(p) ? pc.green("[✓]") : pc.dim("[ ]");
		const num = pc.dim(String(i + 1).padStart(2, " "));
		console.log(`  ${num}  ${checked}  ${p}`);
	});
}
