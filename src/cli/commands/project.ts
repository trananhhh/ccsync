import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import { listClaudeProjects } from "../../core/claude-projects.js";
import { readConfig, writeConfig } from "../../core/config-io.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

const BUCKET = "active-projects";

export async function handleProjectAdd(target: string): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	const resolved = path.resolve(target);
	if (!(await isDir(resolved))) {
		log.error(`Not a directory: ${resolved}`);
		process.exitCode = 1;
		return;
	}
	const bucket = cfg.buckets[BUCKET];
	if (!bucket) {
		log.error(`Bucket ${BUCKET} missing from config — run \`ccsync init --force\``);
		process.exitCode = 1;
		return;
	}
	if (bucket.paths.includes(resolved)) {
		log.warn(`Already tracked: ${resolved}`);
		return;
	}
	bucket.paths.push(resolved);
	if (!bucket.enabled) {
		bucket.enabled = true;
		log.info(`Auto-enabled bucket "${BUCKET}"`);
	}
	await writeConfig(cfgPath, cfg);
	log.success(`Added project: ${resolved}`);
	log.plain("Run `ccsync push` to apply.");
}

export async function handleProjectRemove(target: string): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	const resolved = path.resolve(target);
	const bucket = cfg.buckets[BUCKET];
	if (!bucket) return;
	const idx = bucket.paths.indexOf(resolved);
	if (idx === -1) {
		log.warn(`Not tracked: ${resolved}`);
		return;
	}
	bucket.paths.splice(idx, 1);
	await writeConfig(cfgPath, cfg);
	log.success(`Removed project: ${resolved}`);
	log.plain("Run `ccsync push` to apply.");
}

export async function handleProjectList(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	const bucket = cfg.buckets[BUCKET];
	if (!bucket || bucket.paths.length === 0) {
		log.plain("No projects tracked yet. Use `ccsync project add <path>` or `ccsync project detect`.");
		return;
	}
	log.plain(`Bucket "${BUCKET}" (${bucket.enabled ? pc.green("enabled") : pc.red("disabled")}):`);
	for (const p of bucket.paths) {
		const exists = await isDir(p);
		log.plain(`  ${exists ? "✓" : pc.dim("✗")} ${p}`);
	}
}

export async function handleProjectDetect(opts: { yes?: boolean }): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	const bucket = cfg.buckets[BUCKET];
	if (!bucket) {
		log.error(`Bucket ${BUCKET} missing — run \`ccsync init --force\``);
		process.exitCode = 1;
		return;
	}
	const projects = await listClaudeProjects();
	const candidates = projects.filter(
		(p) => p.exists && !bucket.paths.includes(p.projectPath),
	);
	if (candidates.length === 0) {
		log.success("No new candidates from ~/.claude/projects/");
		return;
	}

	log.plain(`Found ${candidates.length} Claude Code project(s) not yet tracked:`);
	candidates.forEach((c, i) => log.plain(`  ${i + 1}. ${c.projectPath}`));
	log.plain("");

	let selected: typeof candidates;
	if (opts.yes) {
		selected = candidates;
	} else {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		try {
			const ans = (
				await rl.question("Add which? [a]ll / comma-separated numbers / [n]one: ")
			).trim().toLowerCase();
			if (ans === "n" || ans === "") {
				log.plain("Nothing added");
				return;
			}
			if (ans === "a" || ans === "all") {
				selected = candidates;
			} else {
				const nums = ans.split(",").map((s) => Number.parseInt(s.trim(), 10) - 1);
				selected = nums.filter((n) => n >= 0 && n < candidates.length).map((n) => candidates[n]);
			}
		} finally {
			rl.close();
		}
	}

	for (const c of selected) bucket.paths.push(c.projectPath);
	if (!bucket.enabled && selected.length > 0) {
		bucket.enabled = true;
		log.info(`Auto-enabled bucket "${BUCKET}"`);
	}
	await writeConfig(cfgPath, cfg);
	log.success(`Added ${selected.length} project(s)`);
	log.plain("Run `ccsync push` to apply.");
}

async function isDir(p: string): Promise<boolean> {
	try {
		const s = await fs.stat(p);
		return s.isDirectory();
	} catch {
		return false;
	}
}
