import { readConfig } from "../../core/config-io.js";
import { SyncthingApi } from "../../core/syncthing-api.js";
import { buildFolders } from "../../core/syncthing-config.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";
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
	});

	const deadline = Date.now() + Number.parseInt(opts.timeout, 10) * 1000;
	log.step(`Waiting for ${folders.length} folder(s) to reach 100% in-sync…`);

	while (Date.now() < deadline) {
		let pending = 0;
		for (const folder of folders) {
			try {
				const s = await api.folderStatus(folder.id);
				if (s.needFiles > 0 || s.needBytes > 0) pending++;
			} catch {
				pending++;
			}
		}
		if (pending === 0) {
			await removeActiveLock();
			log.success("READY TO SWITCH — all buckets in sync, lock released");
			return;
		}
		log.plain(`  ${pending} folder(s) still pending…`);
		await new Promise((r) => setTimeout(r, 3000));
	}
	log.error("Timed out waiting for sync — not safe to switch yet");
	process.exitCode = 1;
}
