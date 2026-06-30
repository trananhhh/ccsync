import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ccsyncHome } from "../platform/paths.js";
import type { Config } from "./config-schema.js";

export interface ConflictFile {
	path: string;
	original: string;
	bucket: string;
	isHistoryFile: boolean;
	/** Short device id (Syncthing's 7-char prefix) that produced the conflict copy. */
	sourceDevice: string | null;
	/** Marker timestamp as `YYYY-MM-DDTHH:MM:SS` (when Syncthing wrote the copy). */
	conflictTime: string | null;
	/** mtime of the conflict copy, ms epoch. null if it vanished mid-scan. */
	conflictMtime: number | null;
	/** size of the conflict copy in bytes. */
	conflictSize: number | null;
	/** mtime of the surviving original on disk, ms epoch. null if it is gone. */
	originalMtime: number | null;
	/** size of the surviving original in bytes. null if it is gone. */
	originalSize: number | null;
}

export type ConflictAction = "keep-local" | "keep-remote" | "skip";

/** Build a fresh, unique backup directory path under ccsync's home. */
export function newResolveBackupDir(): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	return path.join(ccsyncHome(), `resolve-backup-${stamp}`);
}

/**
 * Copy a file that is about to be destroyed into the backup dir, preserving its
 * absolute path under the backup root so collisions are impossible. Best-effort:
 * a missing source (e.g. delete-vs-edit, the original is already gone) is not an
 * error — there is simply nothing to back up.
 */
async function backupBeforeDestroy(src: string, backupDir: string): Promise<void> {
	try {
		const dest = path.join(backupDir, src.replace(/^[/\\]/, ""));
		await fs.mkdir(path.dirname(dest), { recursive: true });
		await fs.copyFile(src, dest);
	} catch {
		// source vanished or unreadable — nothing recoverable to keep.
	}
}

/**
 * Apply a resolution to a single conflict. Destructive: "keep-remote" overwrites
 * the original with the remote copy, "keep-local" drops the remote copy, "skip"
 * leaves both in place. Before any overwrite/unlink the losing file is copied
 * into `backupDir` (defaults to a fresh `~/.ccsync/resolve-backup-<ts>/`) so the
 * resolution is always recoverable. Callers should still confirm with the user.
 */
export async function resolveConflict(
	c: ConflictFile,
	action: ConflictAction,
	backupDir: string = newResolveBackupDir(),
): Promise<void> {
	if (action === "keep-remote") {
		// The original is about to be overwritten by the conflict copy — keep it.
		await backupBeforeDestroy(c.original, backupDir);
		await fs.rename(c.path, c.original);
	} else if (action === "keep-local") {
		// The conflict copy is about to be removed — keep it.
		await backupBeforeDestroy(c.path, backupDir);
		await fs.unlink(c.path);
	}
	// "skip": intentionally no-op.
}

export interface BulkResolveResult {
	resolved: number;
	errors: Array<{ file: string; error: string }>;
	/** Where losing files were copied before being overwritten/removed. */
	backupDir: string;
}

/**
 * Resolve many conflicts in one pass. Re-scans first so callers can never pass an
 * arbitrary path — only files the scanner currently reports as conflicts are
 * touched. Every losing file is copied into a single shared backup dir before it
 * is overwritten/removed. Each item resolves independently; a failure on one is
 * recorded and the rest continue.
 */
export async function resolveConflictsBulk(
	cfg: Config,
	items: Array<{ file: string; action: ConflictAction }>,
): Promise<BulkResolveResult> {
	const known = new Map((await findConflicts(cfg)).map((c) => [c.path, c]));
	const backupDir = newResolveBackupDir();
	let resolved = 0;
	const errors: BulkResolveResult["errors"] = [];
	for (const it of items) {
		const c = known.get(it.file);
		if (!c) {
			errors.push({ file: it.file, error: "conflict not found" });
			continue;
		}
		try {
			await resolveConflict(c, it.action, backupDir);
			resolved += 1;
		} catch (e) {
			errors.push({ file: it.file, error: e instanceof Error ? e.message : String(e) });
		}
	}
	return { resolved, errors, backupDir };
}

const CONFLICT_RE = /\.sync-conflict-(\d{8})-(\d{6})-([A-Z0-9]+)/;

/** Directories that never hold meaningful conflicts but are expensive to walk. */
const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	".stversions",
	"dist",
	"build",
	"out",
	".next",
	".nuxt",
	".turbo",
	".cache",
	"target",
	"vendor",
	".venv",
	"venv",
	"__pycache__",
	".gradle",
	".idea",
	"coverage",
]);

export async function findConflicts(cfg: Config): Promise<ConflictFile[]> {
	const out: ConflictFile[] = [];
	for (const [name, bucket] of Object.entries(cfg.buckets)) {
		if (!bucket.enabled) continue;
		for (const p of bucket.paths) {
			out.push(...(await scan(p, name)));
		}
	}
	return Promise.all(out.map(enrich));
}

/**
 * A conflict counter that caches its result for `ttlMs`. The SSE monitor calls
 * this on every Syncthing event batch — during an active sync that is many times
 * a second — and each uncached call walks the entire tree (code-root can be
 * gigabytes). The cache collapses those into one scan per window; concurrent
 * callers share the in-flight scan.
 */
export function createConflictCounter(ttlMs = 20_000): (cfg: Config) => Promise<number> {
	let cachedAt = 0;
	let value = 0;
	let inFlight: Promise<number> | null = null;
	return (cfg) => {
		if (Date.now() - cachedAt < ttlMs) return Promise.resolve(value);
		if (inFlight) return inFlight;
		inFlight = findConflicts(cfg)
			.then((cs) => {
				value = cs.length;
				cachedAt = Date.now();
				return value;
			})
			.finally(() => {
				inFlight = null;
			});
		return inFlight;
	};
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
				if (SKIP_DIRS.has(e.name)) continue;
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
	const match = base.match(CONFLICT_RE);
	const original = base.replace(CONFLICT_RE, "");
	const originalPath = path.join(path.dirname(p), original);
	const isHistoryFile =
		/\.(zsh|bash)_history|history\.jsonl/.test(original) || original === "history.jsonl";
	return {
		path: p,
		original: originalPath,
		bucket,
		isHistoryFile,
		sourceDevice: match ? match[3] : null,
		conflictTime: match ? markerTimestamp(match[1], match[2]) : null,
		conflictMtime: null,
		conflictSize: null,
		originalMtime: null,
		originalSize: null,
	};
}

/** Turn marker `YYYYMMDD` + `HHMMSS` into a readable `YYYY-MM-DDTHH:MM:SS`. */
function markerTimestamp(date: string, time: string): string {
	const d = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
	const t = `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
	return `${d}T${t}`;
}

/** Fill in mtime/size for both copies so the UI can show what differs and which is newer. */
async function enrich(c: ConflictFile): Promise<ConflictFile> {
	const [conflict, original] = await Promise.all([statOrNull(c.path), statOrNull(c.original)]);
	return {
		...c,
		conflictMtime: conflict ? conflict.mtimeMs : null,
		conflictSize: conflict ? conflict.size : null,
		originalMtime: original ? original.mtimeMs : null,
		originalSize: original ? original.size : null,
	};
}

async function statOrNull(p: string): Promise<{ mtimeMs: number; size: number } | null> {
	try {
		const s = await fs.stat(p);
		return { mtimeMs: s.mtimeMs, size: s.size };
	} catch {
		return null;
	}
}
