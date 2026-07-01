import { readConfig } from "../../core/config-io.js";
import { SyncthingApi } from "../../core/syncthing-api.js";
import { buildFolders } from "../../core/syncthing-config.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";
import { ownedDeviceIds, runOnDemandSync } from "../../service/on-demand.js";

export interface SyncOptions {
	/** Manual-mode sync budget in seconds before giving up waiting for 100%. */
	timeout?: string;
}

export async function handleSync(opts: SyncOptions = {}): Promise<void> {
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
		rootProfile: cfg.rootProfile,
	});
	const folderIds = folders.map((f) => f.id);

	if (cfg.syncMode !== "manual") {
		log.step(`Forcing rescan on ${folders.length} folder(s)…`);
		let ok = 0;
		for (const id of folderIds) {
			try {
				await api.scan(id);
				ok++;
			} catch {
				// folder may not yet be known to Syncthing; safe to skip
			}
		}
		log.success(`Triggered rescan on ${ok}/${folders.length} folder(s)`);
		log.plain("Syncthing will exchange changes with paired peers automatically.");
		return;
	}

	// Manual / on-demand mode: devices sit paused, so lift the pause on our own
	// devices for one pass, rescan, wait for 100% in-sync, then re-pause.
	const timeoutMs = Number.parseInt(opts.timeout ?? "120", 10) * 1000;
	log.step("On-demand sync: resuming transfers, waiting for 100%…");
	const result = await runOnDemandSync({
		api,
		ownedIds: ownedDeviceIds(sys.myID, cfg.peers),
		folderIds,
		timeoutMs,
		onProgress: (pending) => {
			if (pending > 0) log.plain(`  ${pending} folder(s) still pending…`);
		},
	});

	if (result === "synced") {
		log.success("Synced — transfers paused again (on-demand mode).");
		return;
	}
	log.warn("Timed out before reaching 100% — transfers paused again. Run `ccsync sync` to retry.");
	process.exitCode = 1;
}
