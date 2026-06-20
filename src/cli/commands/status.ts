import { readConfig } from "../../core/config-io.js";
import { SyncthingApi } from "../../core/syncthing-api.js";
import { buildFolders } from "../../core/syncthing-config.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export interface StatusOptions {
	verbose?: boolean;
}

export async function handleStatus(opts: StatusOptions): Promise<void> {
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
	if (!(await api.ping())) {
		log.error(`Cannot reach Syncthing at ${cfg.syncthing.guiAddress}`);
		process.exitCode = 1;
		return;
	}

	const sys = await api.systemStatus();
	log.plain(`Machine:    ${cfg.machineName}`);
	log.plain(`Device ID:  ${sys.myID}`);
	log.plain(`Peers:      ${cfg.peers.length}`);

	const conns = await api.connections();
	for (const peer of cfg.peers) {
		const c = conns.connections[peer.deviceId];
		const status = c?.connected ? "online" : "offline";
		log.plain(`  - ${peer.name} (${peer.deviceId.slice(0, 7)}…) ${status}`);
	}

	const folders = buildFolders({
		machineName: cfg.machineName,
		myDeviceId: sys.myID,
		buckets: cfg.buckets,
		peers: cfg.peers,
		rootProfile: cfg.rootProfile,
	});
	let outOfSync = 0;
	for (const folder of folders) {
		try {
			const s = await api.folderStatus(folder.id);
			if (s.needFiles > 0 || s.needBytes > 0) outOfSync++;
			if (opts.verbose) {
				log.plain(
					`  ${folder.id}: ${s.state}, need=${s.needFiles} files (${humanBytes(s.needBytes)})`,
				);
			}
		} catch {
			if (opts.verbose) log.plain(`  ${folder.id}: not yet known to Syncthing`);
		}
	}
	if (outOfSync === 0) log.success("All buckets in sync");
	else log.warn(`${outOfSync} folder(s) out of sync — run \`ccsync status --verbose\``);
}

function humanBytes(b: number): string {
	if (b < 1024) return `${b} B`;
	if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
	if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
	return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
