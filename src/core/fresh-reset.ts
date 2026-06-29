import * as fs from "node:fs/promises";
import { ccsyncHome } from "../platform/paths.js";

export interface ResetOptions {
	stop?: () => Promise<void>;
	removeDir?: (dir: string) => Promise<void>;
}

/**
 * Wipe ccsync's own state. Since the dedicated Syncthing home now lives inside
 * `~/.ccsync/syncthing`, removing `~/.ccsync` removes the daemon's identity and
 * folders too — and ONLY ccsync-owned data. A user's platform-default Syncthing
 * (e.g. on 8384) is never touched. The daemon is stopped first when possible.
 */
export async function resetCcsyncState(
	homeDir: string = ccsyncHome(),
	opts: ResetOptions = {},
): Promise<void> {
	const removeDir =
		opts.removeDir ?? ((dir: string) => fs.rm(dir, { recursive: true, force: true }));
	if (opts.stop) {
		try {
			await opts.stop();
		} catch {
			// best-effort; continue cleaning up
		}
	}
	await removeDir(homeDir);
}
