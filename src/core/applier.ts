import type { Config } from "./config-schema.js";
import { SyncthingApi } from "./syncthing-api.js";
import { buildDevices, buildFolders } from "./syncthing-config.js";
import { writeStignore } from "./stignore-writer.js";

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
	for (const [name, bucket] of Object.entries(cfg.buckets)) {
		if (!bucket.enabled) continue;
		for (const p of bucket.paths) {
			try {
				await writeStignore({
					folderPath: p,
					bucket,
					globalIgnore: cfg.globalIgnore,
				});
				stignores++;
			} catch {
				// non-fatal; folder may not exist on this machine
			}
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
