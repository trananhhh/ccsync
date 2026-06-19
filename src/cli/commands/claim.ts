import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { log } from "../../lib/log.js";
import { ccsyncHome, ccsyncLockPath } from "../../platform/paths.js";

export async function handleClaim(): Promise<void> {
	await fs.mkdir(ccsyncHome(), { recursive: true });
	const lock = ccsyncLockPath();
	const payload = {
		machine: os.hostname(),
		pid: process.pid,
		claimedAt: new Date().toISOString(),
	};
	await fs.writeFile(lock, JSON.stringify(payload, null, 2), "utf-8");
	log.success(`Claimed active flag on ${payload.machine}`);
	log.plain(`Lock: ${lock}`);
	log.plain("Other machines will see this via Syncthing once it syncs.");
}

export async function readActiveLock(): Promise<{ machine: string; claimedAt: string } | null> {
	try {
		const raw = await fs.readFile(ccsyncLockPath(), "utf-8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export async function removeActiveLock(): Promise<void> {
	try {
		await fs.unlink(ccsyncLockPath());
	} catch {}
}

// helper used elsewhere (intentionally exported)
export function _lockDir(): string {
	return path.dirname(ccsyncLockPath());
}
