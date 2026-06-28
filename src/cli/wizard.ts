import * as fs from "node:fs/promises";
import * as path from "node:path";
import { checkbox, input } from "@inquirer/prompts";
import pc from "picocolors";
import { listClaudeProjects } from "../core/claude-projects.js";
import type { CodeFolderCandidate } from "../core/code-folders.js";
import type { Bucket } from "../core/config-schema.js";
import { log } from "../lib/log.js";
import { tryPrompt } from "../lib/prompt-or.js";

interface BucketChoice {
	key: string;
	label: string;
	hint: string;
}

const BUCKET_LABELS: BucketChoice[] = [
	{
		key: "claude-config",
		label: "Claude config",
		hint: "agents, commands, hooks, rules, skills, output styles",
	},
	{ key: "claude-conversations", label: "Conversations", hint: "~/.claude/projects/" },
	{
		key: "claude-agent-state",
		label: "Background agents",
		hint: "~/.claude/tasks, jobs, session-env, file-history",
	},
	{ key: "claude-worktrees", label: "Worktrees", hint: "~/.claude/worktrees/" },
	{
		key: "claude-plugins",
		label: "Plugins",
		hint: "~/.claude/plugins/ (reproducible from marketplace)",
	},
	{
		key: "shell-history",
		label: "Shell history",
		hint: "single-file sync pending; kept off",
	},
];

function fallbackBuckets(buckets: Record<string, Bucket>): Record<string, Bucket> {
	const next = { ...buckets };
	for (const choice of BUCKET_LABELS) {
		if (!next[choice.key]) continue;
		next[choice.key] = { ...next[choice.key], enabled: false };
	}
	return next;
}

export async function pickBuckets(
	buckets: Record<string, Bucket>,
): Promise<Record<string, Bucket>> {
	const items = BUCKET_LABELS.filter((b) => buckets[b.key]);
	if (items.length === 0) return buckets;

	return tryPrompt(
		async () => {
			const picked = await checkbox<string>({
				message: "What to sync? (space to toggle, enter to confirm)",
				choices: items.map((b) => ({
					name: b.label,
					value: b.key,
					checked: buckets[b.key].enabled,
					description: b.hint,
				})),
			});
			const next = { ...buckets };
			for (const choice of items) {
				next[choice.key] = {
					...next[choice.key],
					enabled: picked.includes(choice.key),
				};
			}
			return next;
		},
		() => fallbackBuckets(buckets),
	);
}

function fallbackProjects(current: string[]): string[] {
	return [...current];
}

export async function pickProjects(current: string[]): Promise<string[]> {
	const detected = (await listClaudeProjects()).filter((p) => p.exists).map((p) => p.projectPath);
	const candidates = Array.from(new Set([...current, ...detected]));
	if (candidates.length === 0) {
		log.plain(
			"\nNo Claude Code projects detected. You can add any later with `ccsync advanced project add <path>`.",
		);
		return current;
	}

	return tryPrompt(
		async () => {
			const workingCandidates = [...candidates];
			const wantsMore = await input({
				message: "Add a custom project path? (leave blank to skip)",
				default: "",
			});
			const custom = wantsMore.trim();
			if (custom) {
				const p = path.resolve(custom);
				try {
					const s = await fs.stat(p);
					if (!s.isDirectory()) {
						log.warn(`Not a directory: ${p}`);
					} else if (!workingCandidates.includes(p)) {
						workingCandidates.push(p);
					}
				} catch {
					log.warn(`Path does not exist: ${p}`);
				}
			}
			const defaults = current.length > 0 ? current : detected;
			const picked = await checkbox<string>({
				message: "Project working trees to sync (uncommitted edits sync too):",
				choices: workingCandidates.map((p) => ({
					name: p,
					value: p,
					checked: defaults.includes(p),
				})),
			});
			return picked;
		},
		() => fallbackProjects(current),
	);
}

function fallbackCodeFolders(rootOption: string, items: string[]): string[] {
	const subset = items.filter((item) => item !== rootOption);
	return subset.length > 0 ? [...subset].sort((a, b) => a.localeCompare(b)) : [];
}

export async function pickCodeFolders(
	root: string,
	candidates: CodeFolderCandidate[],
): Promise<string[]> {
	const rootOption = ".";
	const items = [rootOption, ...candidates.map((c) => c.relativePath)].filter(
		(value, index, arr) => arr.indexOf(value) === index,
	);

	if (items.length === 1) {
		log.plain(`\nNo project folders detected under ${root}.`);
		return tryPrompt(
			async () => {
				const ans = await checkbox<string>({
					message: `Sync the entire root (${root})?`,
					choices: [{ name: `Sync entire root ${pc.dim(root)}`, value: rootOption, checked: true }],
				});
				return ans;
			},
			() => [rootOption],
		);
	}

	return tryPrompt(
		async () => {
			const workingItems = [...items];
			const wantsMore = await input({
				message: "Add a custom relative path? (leave blank to skip)",
				default: "",
			});
			const custom = wantsMore.trim();
			if (custom) {
				try {
					const relativePath = normalizeRelativeInput(custom);
					if (!workingItems.includes(relativePath)) workingItems.push(relativePath);
				} catch (err) {
					log.warn((err as Error).message);
				}
			}
			const picked = await checkbox<string>({
				message: `Code folders under ${pc.dim(root)} to sync (uncommitted edits included):`,
				choices: workingItems.map((relativePath) => ({
					name: relativePath === "." ? `.  ${pc.dim("(entire root)")}` : relativePath,
					value: relativePath,
					checked: relativePath !== rootOption && items.includes(relativePath),
				})),
			});
			return picked.sort((a, b) => a.localeCompare(b));
		},
		() => fallbackCodeFolders(rootOption, items),
	);
}

function normalizeRelativeInput(value: string): string {
	const normalized = path.normalize(value).replace(/\\/g, "/");
	if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
		throw new Error(`Code folder must be relative to the selected root: ${value}`);
	}
	return normalized === "" ? "." : normalized;
}
