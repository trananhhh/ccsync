import { log } from "../lib/log.js";
import { findUnanchoredNegations } from "./ccsyncignore.js";
import type { Bucket, Config } from "./config-schema.js";
import { rootConversationPath, rootConversations } from "./root-profile.js";
import { writeStignore } from "./stignore-writer.js";
import { SyncthingApi } from "./syncthing-api.js";
import { buildDevices, buildFolders } from "./syncthing-config.js";

export interface ApplyResult {
	foldersConfigured: number;
	devicesConfigured: number;
	stignoresWritten: number;
}

export async function apply(cfg: Config): Promise<ApplyResult> {
	if (!cfg.syncthing) throw new Error("config.syncthing not initialised — run `ccsync init`");
	const api = new SyncthingApi({
		apiKey: cfg.syncthing.apiKey,
		guiAddress: cfg.syncthing.guiAddress,
	});
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
		folders,
		devices,
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
			targets.push({
				folderPath,
				bucket,
				codeFolderRoot: name === "code-root" ? folderPath : undefined,
			});
		}
	}
	return targets;
}
