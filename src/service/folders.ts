import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface BrowseEntry {
	name: string;
	path: string;
	isDir: true;
}

export interface BrowseResult {
	/** The canonical directory actually being listed. */
	path: string;
	/** Canonical parent, or null when `path` is the home root (cannot ascend). */
	parent: string | null;
	entries: BrowseEntry[];
}

/**
 * List the immediate subdirectories of `target`, confined to the user's home.
 *
 * Security: this is a read surface on the filesystem exposed over the loopback
 * control service, so it is strictly home-rooted. Both the requested path and
 * every child are resolved to their canonical (symlink-followed) location and
 * rejected unless they stay inside the canonical home — so neither `../../etc`
 * traversal nor a symlink pointing outside home can escape.
 */
export async function browseDirectory(
	target?: string,
	homeRoot: string = os.homedir(),
): Promise<BrowseResult> {
	const home = await fs.realpath(homeRoot);

	const requested = target?.trim() ? path.resolve(target) : home;
	let real: string;
	try {
		real = await fs.realpath(requested);
	} catch {
		throw new Error("directory not found");
	}
	if (!isInside(home, real)) {
		throw new Error("path is outside the home directory");
	}
	const stat = await fs.stat(real);
	if (!stat.isDirectory()) {
		throw new Error("not a directory");
	}

	const dirents = await fs.readdir(real, { withFileTypes: true });
	const entries: BrowseEntry[] = [];
	for (const dirent of dirents) {
		if (dirent.name.startsWith(".")) continue; // hidden dirs are noise for a code-root picker
		const childAbs = path.join(real, dirent.name);
		let childReal: string;
		try {
			childReal = await fs.realpath(childAbs);
		} catch {
			continue; // dangling symlink or vanished entry
		}
		if (!isInside(home, childReal)) continue; // symlink escaping home
		let childStat: Awaited<ReturnType<typeof fs.stat>>;
		try {
			childStat = await fs.stat(childReal);
		} catch {
			continue;
		}
		if (!childStat.isDirectory()) continue;
		entries.push({ name: dirent.name, path: childAbs, isDir: true });
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));

	return {
		path: real,
		parent: real === home ? null : path.dirname(real),
		entries,
	};
}

/** True when `target` is `root` itself or nested anywhere beneath it. */
function isInside(root: string, target: string): boolean {
	if (target === root) return true;
	return target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}
