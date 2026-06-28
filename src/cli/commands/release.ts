import { readConfig } from "../../core/config-io.js";
import { SyncthingApi } from "../../core/syncthing-api.js";
import { buildFolders } from "../../core/syncthing-config.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";
import { waitUntilSynced } from "../../service/handoff.js";
import { removeActiveLock } from "./claim.js";

export interface ReleaseOptions {
	timeout: string;
}

export async function handleRelease(opts: ReleaseOptions): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	if (!cfg.syncthing) {
		log.error("config.syncthing missing — run `ccsync init`");
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

	log.step(`Waiting for ${folders.length} folder(s) to reach 100% in-sync…`);

	const result = await waitUntilSynced(
		{ api, folderIds: folders.map((f) => f.id) },
		{
			timeoutMs: Number.parseInt(opts.timeout, 10) * 1000,
			onProgress: (pending) => {
				if (pending > 0) log.plain(`  ${pending} folder(s) still pending…`);
			},
		},
	);

	if (result === "synced") {
		await removeActiveLock();
		log.success("READY TO SWITCH — all buckets in sync, lock released");
		return;
	}
	log.error("Timed out waiting for sync — not safe to switch yet");
	process.exitCode = 1;
}
