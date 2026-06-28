import * as fs from "node:fs/promises";
import { ccsyncHome, syncthingHome } from "../platform/paths.js";

export interface ResetOptions {
	syncthingHomeDir?: string;
	stop?: () => Promise<void>;
	removeDir?: (dir: string) => Promise<void>;
}

export async function resetCcsyncState(
	homeDir: string = ccsyncHome(),
	opts: ResetOptions = {},
): Promise<void> {
	const stHome = opts.syncthingHomeDir ?? syncthingHome();
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
	await removeDir(stHome);
}
