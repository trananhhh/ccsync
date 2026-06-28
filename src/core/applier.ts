import { log } from "../lib/log.js";
import { findUnanchoredNegations } from "./ccsyncignore.js";
import type { Bucket, Config } from "./config-schema.js";
import { rootConversationPath, rootConversations } from "./root-profile.js";
import { writeStignore } from "./stignore-writer.js";
import { SyncthingApi, type SyncthingDevice, type SyncthingFolder } from "./syncthing-api.js";
import { buildDevices, buildFolders } from "./syncthing-config.js";
import { isLegacySingleFileBucketPath } from "./syncthing-folder-paths.js";

export const CCSYNC_FOLDER_PREFIX = "ccsync-";

export function isCcsyncFolder(id: string): boolean {
	return id.startsWith(CCSYNC_FOLDER_PREFIX);
}

export function mergeFolders(
	remote: SyncthingFolder[],
	owned: SyncthingFolder[],
): SyncthingFolder[] {
	const foreign = remote.filter((f) => !isCcsyncFolder(f.id));
	return [...foreign, ...owned];
}

/**
 * Merge the devices we own (self + configured peers) with any foreign devices
 * already present in the remote config. Owned-device pause state is derived from
 * cfg.metered so that re-applying the config never accidentally un-pauses a
 * metered connection. Foreign devices are passed through untouched.
 */
export function mergeDevices(
	remote: SyncthingDevice[],
	owned: SyncthingDevice[],
	metered: boolean,
): SyncthingDevice[] {
	const ownedIds = new Set(owned.map((d) => d.deviceID));
	const ownedWithPaused = owned.map((d) => ({ ...d, paused: metered }));
	const foreign = remote.filter((d) => !ownedIds.has(d.deviceID));
	return [...ownedWithPaused, ...foreign];
}

export interface ApplyResult {
	foldersConfigured: number;
	devicesConfigured: number;
	stignoresWritten: number;
}

export async function apply(cfg: Config, injectedApi?: SyncthingApi): Promise<ApplyResult> {
	let api = injectedApi;
	if (!api) {
		if (!cfg.syncthing) throw new Error("config.syncthing not initialised — run `ccsync init`");
		api = new SyncthingApi({
			apiKey: cfg.syncthing.apiKey,
			guiAddress: cfg.syncthing.guiAddress,
		});
	}
	const status = await api.systemStatus();
	const folders = buildFolders({
		machineName: cfg.machineName,
		myDeviceId: status.myID,
		buckets: cfg.buckets,
		peers: cfg.peers,
		rootProfile: cfg.rootProfile,
	});
	const devices = buildDevices(status.myID, cfg.machineName, cfg.peers);

	const remote = await api.getConfig();
	const merged = {
		...remote,
		folders: mergeFolders(remote.folders, folders),
		devices: mergeDevices(remote.devices, devices, cfg.metered ?? false),
	};
	await api.putConfig(merged);

	let stignores = 0;
	for (const target of collectStignoreTargets(cfg)) {
		try {
			const result = await writeStignore({
				folderPath: target.folderPath,
				bucket: target.bucket,
				globalIgnore: cfg.globalIgnore,
				codeFolderRoot: target.codeFolderRoot,
			});
			if (result.written) {
				stignores++;
				for (const line of findUnanchoredNegations(result.projectIgnore)) {
					log.warn(
						`.ccsyncignore: unanchored negation "${line}" — Syncthing may force directory traversal; prefix with "/" to root-anchor`,
					);
				}
			}
		} catch {
			// non-fatal; folder may not exist on this machine
		}
	}

	for (const folder of folders) {
		try {
			await api.scan(folder.id);
		} catch {
			// folder may be new; ignore
		}
	}

	return {
		foldersConfigured: folders.length,
		devicesConfigured: devices.length,
		stignoresWritten: stignores,
	};
}

export interface StignoreTarget {
	folderPath: string;
	bucket: Bucket;
	codeFolderRoot?: string;
}

export function collectStignoreTargets(cfg: Config): StignoreTarget[] {
	const targets: StignoreTarget[] = [];
	for (const [name, bucket] of Object.entries(cfg.buckets)) {
		if (!bucket.enabled) continue;
		if (cfg.rootProfile && name === "claude-conversations") {
			for (const conversation of rootConversations(cfg.rootProfile)) {
				targets.push({
					folderPath: rootConversationPath(cfg.rootProfile, conversation),
					bucket,
				});
			}
			continue;
		}
		for (const folderPath of bucket.paths) {
			if (isLegacySingleFileBucketPath(folderPath)) continue;
			targets.push({
				folderPath,
				bucket,
				codeFolderRoot: name === "code-root" ? folderPath : undefined,
			});
		}
	}
	return targets;
}
