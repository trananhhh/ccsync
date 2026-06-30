import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CLI_VERSION } from "../cli/version.js";
import { ccsyncHome } from "../platform/paths.js";
import type { Config } from "./config-schema.js";
import { localProjectPath, rootCodeFolders } from "./root-profile.js";
import type { SyncthingFolder } from "./syncthing-api.js";

/** Fixed Syncthing folder id for the cross-machine registry. */
export const REGISTRY_FOLDER_ID = "ccsync-registry";

/**
 * What each machine publishes about itself so the UI on any machine can show
 * "this machine's code root is X, the other machine's is Y" — even while the peer
 * is offline (the last-synced snapshot stays readable).
 */
export interface MachineInfo {
	deviceId: string;
	machineName: string;
	/** The rootProfile canonical root, or null when no rootProfile is configured. */
	canonicalRoot: string | null;
	/** Absolute local code-folder paths synced on that machine. */
	codeRoots: string[];
	conversationsEnabled: boolean;
	version: string;
	/** ISO timestamp of the last refresh on the owning machine. */
	updatedAt: string;
}

/** Synced directory holding `<deviceId>.json` for every machine in the mesh. */
export function registryDir(): string {
	return path.join(ccsyncHome(), "registry");
}

/**
 * The registry is a tiny always-on Syncthing folder rather than a user bucket, so
 * it never appears as a toggle the user could disable and break cross-machine
 * visibility. Each machine writes only its own `<deviceId>.json`, so distinct
 * filenames mean the folder never produces sync conflicts.
 */
export function registryFolder(deviceIds: string[]): SyncthingFolder {
	return {
		id: REGISTRY_FOLDER_ID,
		label: "ccsync machine registry",
		path: registryDir(),
		type: "sendreceive",
		devices: deviceIds.map((d) => ({ deviceID: d })),
		ignorePerms: true,
		rescanIntervalS: 3600,
		fsWatcherEnabled: true,
	};
}

export function buildMachineInfo(cfg: Config, deviceId: string): MachineInfo {
	const rp = cfg.rootProfile;
	const profileRoots = rp
		? rootCodeFolders(rp).map((f) => localProjectPath(rp, f.relativePath))
		: [];
	const fallback = cfg.buckets["code-root"]?.enabled ? (cfg.buckets["code-root"]?.paths ?? []) : [];
	return {
		deviceId,
		machineName: cfg.machineName,
		canonicalRoot: rp?.canonicalRoot ?? null,
		codeRoots: profileRoots.length > 0 ? profileRoots : fallback,
		conversationsEnabled: cfg.buckets["claude-conversations"]?.enabled ?? false,
		version: CLI_VERSION,
		updatedAt: new Date().toISOString(),
	};
}

/** Write this machine's own info into the synced registry. Best-effort. */
export async function writeMachineInfo(cfg: Config, deviceId: string): Promise<MachineInfo> {
	const dir = registryDir();
	await fs.mkdir(dir, { recursive: true });
	const info = buildMachineInfo(cfg, deviceId);
	await fs.writeFile(path.join(dir, `${deviceId}.json`), `${JSON.stringify(info, null, 2)}\n`);
	return info;
}

/** Read every machine's published info from the synced registry. */
export async function readMachines(): Promise<MachineInfo[]> {
	const dir = registryDir();
	let names: string[];
	try {
		names = await fs.readdir(dir);
	} catch {
		return [];
	}
	const out: MachineInfo[] = [];
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		try {
			out.push(JSON.parse(await fs.readFile(path.join(dir, name), "utf-8")) as MachineInfo);
		} catch {
			// skip a partially-synced or malformed entry
		}
	}
	return out;
}
