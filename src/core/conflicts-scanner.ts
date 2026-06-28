import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Config } from "./config-schema.js";

export interface ConflictFile {
	path: string;
	original: string;
	bucket: string;
	isHistoryFile: boolean;
}

export type ConflictAction = "keep-local" | "keep-remote" | "skip";

/**
 * Apply a resolution to a single conflict. Destructive: "keep-remote" overwrites
 * the original with the remote copy, "keep-local" drops the remote copy, "skip"
 * leaves both in place. Callers must confirm before invoking with a non-skip
 * action — there is no undo.
 */
export async function resolveConflict(c: ConflictFile, action: ConflictAction): Promise<void> {
	if (action === "keep-remote") {
		await fs.rename(c.path, c.original);
	} else if (action === "keep-local") {
		await fs.unlink(c.path);
	}
	// "skip": intentionally no-op.
}

const CONFLICT_RE = /\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]+/;

export async function findConflicts(cfg: Config): Promise<ConflictFile[]> {
	const out: ConflictFile[] = [];
	for (const [name, bucket] of Object.entries(cfg.buckets)) {
		if (!bucket.enabled) continue;
		for (const p of bucket.paths) {
			out.push(...(await scan(p, name)));
		}
	}
	return out;
}

async function scan(root: string, bucket: string): Promise<ConflictFile[]> {
	const stat = await fs.stat(root).catch(() => null);
	if (!stat) return [];
	if (stat.isFile()) {
		return looksLikeConflict(root) ? [toConflict(root, bucket)] : [];
	}
	const out: ConflictFile[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const dir = stack.pop();
		if (!dir) break;
		const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const e of entries) {
			const full = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (e.name === ".git" || e.name === "node_modules" || e.name === ".stversions") continue;
				stack.push(full);
			} else if (looksLikeConflict(full)) {
				out.push(toConflict(full, bucket));
			}
		}
	}
	return out;
}

function looksLikeConflict(p: string): boolean {
	return CONFLICT_RE.test(path.basename(p));
}

function toConflict(p: string, bucket: string): ConflictFile {
	const base = path.basename(p);
	const original = base.replace(CONFLICT_RE, "");
	const originalPath = path.join(path.dirname(p), original);
	const isHistoryFile =
		/\.(zsh|bash)_history|history\.jsonl/.test(original) || original === "history.jsonl";
	return { path: p, original: originalPath, bucket, isHistoryFile };
}
