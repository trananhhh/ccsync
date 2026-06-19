import { readConfig } from "../../core/config-io.js";
import { SyncthingApi } from "../../core/syncthing-api.js";
import { buildFolders } from "../../core/syncthing-config.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export async function handleSync(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	if (!cfg.syncthing) {
		log.error("config.syncthing missing — run `ccsync init` first");
		process.exitCode = 1;
		return;
	}
	const api = new SyncthingApi({
		apiKey: cfg.syncthing.apiKey,
		guiAddress: cfg.syncthing.guiAddress,
	});
	const sys = await api.systemStatus();
	const folders = buildFolders({
		machineName: cfg.machineName,
		myDeviceId: sys.myID,
		buckets: cfg.buckets,
		peers: cfg.peers,
	});
	log.step(`Forcing rescan on ${folders.length} folder(s)…`);
	let ok = 0;
	for (const f of folders) {
		try {
			await api.scan(f.id);
			ok++;
		} catch {
			// folder may not yet be known to Syncthing; safe to skip
		}
	}
	log.success(`Triggered rescan on ${ok}/${folders.length} folder(s)`);
	log.plain("Syncthing will exchange changes with paired peers automatically.");
}
