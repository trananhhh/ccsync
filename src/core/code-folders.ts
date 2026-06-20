import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface CodeFolderCandidate {
	relativePath: string;
}

export interface FindCodeFolderCandidatesOptions {
	maxDepth?: number;
}

const DEFAULT_MAX_SCAN_DEPTH = 5;
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

export async function findCodeFolderCandidates(
	rootPath: string,
	extraRelativePaths: string[] = [],
	opts: FindCodeFolderCandidatesOptions = {},
): Promise<CodeFolderCandidate[]> {
	const root = path.resolve(rootPath);
	const found = new Set<string>();
	for (const relativePath of extraRelativePaths) {
		found.add(normalizeRelativePath(relativePath));
	}

	await visit(root, root, 0, opts.maxDepth ?? DEFAULT_MAX_SCAN_DEPTH, found);
	return [...found].sort((a, b) => a.localeCompare(b)).map((relativePath) => ({ relativePath }));
}

async function visit(
	root: string,
	dir: string,
	depth: number,
	maxDepth: number,
	found: Set<string>,
): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}

	if (entries.some((entry) => entry.name === ".git")) {
		found.add(path.relative(root, dir) || ".");
	}
	if (depth >= maxDepth) return;

	for (const entry of entries) {
		if (!entry.isDirectory() || SKIPPED_SCAN_DIRS.has(entry.name)) continue;
		await visit(root, path.join(dir, entry.name), depth + 1, maxDepth, found);
	}
}

function normalizeRelativePath(relativePath: string): string {
	const normalized = path.normalize(relativePath).replace(/\\/g, "/");
	if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
		throw new Error(`Code folder must be relative to the sync root: ${relativePath}`);
	}
	return normalized === "" ? "." : normalized;
}
