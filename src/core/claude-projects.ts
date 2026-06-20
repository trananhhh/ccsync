import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { claudeHome as defaultClaudeHome } from "../platform/paths.js";
import { encodeClaudeProjectPath } from "./root-profile.js";

export interface DetectedProject {
	projectPath: string;
	exists: boolean;
	encodedDir: string;
}

export interface ListClaudeProjectsUnderRootOptions {
	claudeHome?: string;
	maxDepth?: number;
}

const DEFAULT_MAX_SCAN_DEPTH = 8;
const SKIPPED_SCAN_DIRS = new Set([
	".git",
	".next",
	".nuxt",
	".pnpm-store",
	".stversions",
	".turbo",
	".venv",
	".yarn",
	"__pycache__",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"out",
	"target",
]);

export function decodeProjectDir(encoded: string): string {
	if (!encoded.startsWith("-")) return encoded;
	return `/${encoded.slice(1).replaceAll("-", "/")}`;
}

export async function listClaudeProjects(): Promise<DetectedProject[]> {
	const root = path.join(defaultClaudeHome(), "projects");
	const entries = await listClaudeProjectDirNames(root);
	const out: DetectedProject[] = [];
	for (const name of entries) {
		const projectPath = decodeProjectDir(name);
		const exists = await pathExists(projectPath);
		out.push({ projectPath, exists, encodedDir: path.join(root, name) });
	}
	return out;
}

export async function listClaudeProjectsUnderRoot(
	rootPath: string,
	opts: ListClaudeProjectsUnderRootOptions = {},
): Promise<DetectedProject[]> {
	const claudeProjectsRoot = path.join(opts.claudeHome ?? defaultClaudeHome(), "projects");
	const encodedNames = new Set(await listClaudeProjectDirNames(claudeProjectsRoot));
	if (encodedNames.size === 0) return [];

	const root = path.resolve(rootPath);
	const maxDepth = opts.maxDepth ?? DEFAULT_MAX_SCAN_DEPTH;
	const out: DetectedProject[] = [];
	const seen = new Set<string>();

	async function visit(dir: string, depth: number): Promise<void> {
		const projectPath = path.resolve(dir);
		const encoded = encodeClaudeProjectPath(projectPath);
		if (encodedNames.has(encoded) && !seen.has(projectPath)) {
			seen.add(projectPath);
			out.push({
				projectPath,
				exists: true,
				encodedDir: path.join(claudeProjectsRoot, encoded),
			});
		}
		if (depth >= maxDepth) return;

		let entries: Dirent[];
		try {
			entries = await fs.readdir(projectPath, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (!entry.isDirectory() || SKIPPED_SCAN_DIRS.has(entry.name)) continue;
			await visit(path.join(projectPath, entry.name), depth + 1);
		}
	}

	await visit(root, 0);
	return out.sort((a, b) => a.projectPath.localeCompare(b.projectPath));
}

async function listClaudeProjectDirNames(root: string): Promise<string[]> {
	try {
		return (await fs.readdir(root, { withFileTypes: true }))
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
	} catch {
		return [];
	}
}

async function pathExists(p: string): Promise<boolean> {
	try {
		const stat = await fs.stat(p);
		return stat.isDirectory();
	} catch {
		return false;
	}
}
