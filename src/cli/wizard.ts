import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import { listClaudeProjects } from "../core/claude-projects.js";
import type { CodeFolderCandidate } from "../core/code-folders.js";
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

	console.log("\nWhat to sync?");
	console.log(pc.dim("Type numbers separated by spaces to toggle, then press Enter to confirm."));
	render(next, items);

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		while (true) {
			const ans = (await rl.question("Toggle numbers or Enter to confirm: ")).trim();
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

export async function pickCodeFolders(
	root: string,
	candidates: CodeFolderCandidate[],
): Promise<string[]> {
	const rootOption = ".";
	const items = [rootOption, ...candidates.map((candidate) => candidate.relativePath)].filter(
		(value, index, arr) => arr.indexOf(value) === index,
	);
	if (items.length === 1) {
		console.log(`\nNo project folders detected under ${root}.`);
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		try {
			const ans = (await rl.question("Sync the entire root? [Y/n] ")).trim().toLowerCase();
			return ans === "n" || ans === "no" ? [] : [rootOption];
		} finally {
			rl.close();
		}
	}

	const selected = new Set(items.filter((item) => item !== rootOption));
	console.log("\nCode folders under root to sync (uncommitted edits included):");
	console.log(pc.dim(`Root: ${root}`));
	console.log(
		pc.dim(
			"Type numbers separated by spaces to toggle. Select `.` only if you want the whole root.",
		),
	);
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		while (true) {
			renderCodeFolders(items, selected);
			const ans = (
				await rl.question(
					"\nToggle numbers, `a relative/path` to add, `n` to skip code sync, Enter to confirm: ",
				)
			).trim();
			if (ans === "") break;
			if (ans === "n") {
				selected.clear();
				break;
			}
			if (ans.startsWith("a ")) {
				const relativePath = normalizeRelativeInput(ans.slice(2).trim());
				if (!items.includes(relativePath)) items.push(relativePath);
				selected.delete(rootOption);
				selected.add(relativePath);
				console.log("");
				continue;
			}
			const nums = ans.split(/[\s,]+/).map((s) => Number.parseInt(s, 10) - 1);
			for (const n of nums) {
				if (n < 0 || n >= items.length) continue;
				const item = items[n];
				if (item === rootOption) {
					if (selected.has(rootOption)) selected.delete(rootOption);
					else {
						selected.clear();
						selected.add(rootOption);
					}
					continue;
				}
				selected.delete(rootOption);
				if (selected.has(item)) selected.delete(item);
				else selected.add(item);
			}
			console.log("");
		}
	} finally {
		rl.close();
	}
	return [...selected].sort((a, b) => a.localeCompare(b));
}

function render2(items: string[], selected: Set<string>): void {
	items.forEach((p, i) => {
		const checked = selected.has(p) ? pc.green("[✓]") : pc.dim("[ ]");
		const num = pc.dim(String(i + 1).padStart(2, " "));
		console.log(`  ${num}  ${checked}  ${p}`);
	});
}

function renderCodeFolders(items: string[], selected: Set<string>): void {
	items.forEach((relativePath, i) => {
		const checked = selected.has(relativePath) ? pc.green("[✓]") : pc.dim("[ ]");
		const num = pc.dim(String(i + 1).padStart(2, " "));
		const label = relativePath === "." ? ".  (entire root)" : relativePath;
		console.log(`  ${num}  ${checked}  ${label}`);
	});
}

function normalizeRelativeInput(value: string): string {
	const normalized = path.normalize(value).replace(/\\/g, "/");
	if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
		throw new Error(`Code folder must be relative to the selected root: ${value}`);
	}
	return normalized === "" ? "." : normalized;
}
