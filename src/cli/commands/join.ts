import { apply } from "../../core/applier.js";
import { readConfig, writeConfig } from "../../core/config-io.js";
import { type Peer, PeerSchema } from "../../core/config-schema.js";
import { decodeInvite } from "../../core/invite-token.js";
import { SyncthingApi } from "../../core/syncthing-api.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export interface JoinOptions {
	token: string;
}

export async function handleJoin(opts: JoinOptions): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	const inv = decodeInvite(opts.token);

	if (cfg.peers.find((p) => p.deviceId === inv.deviceId)) {
		log.warn(`Already paired with ${inv.name} (${inv.deviceId.slice(0, 7)}…)`);
	} else {
		const peer: Peer = PeerSchema.parse({
			deviceId: inv.deviceId,
			name: inv.name,
			addresses: ["dynamic"],
			introducer: inv.introducer,
		});
		cfg.peers.push(peer);
		await writeConfig(cfgPath, cfg);
		log.success(
			`Added ${inv.name} (${inv.deviceId.slice(0, 7)}…) as peer` +
				(inv.introducer ? " [introducer]" : ""),
		);
	}

	log.step("Applying config to local Syncthing…");
	const res = await apply(cfg);
	log.success(
		`Applied: ${res.foldersConfigured} folders, ${res.devicesConfigured} devices`,
	);

	if (cfg.syncthing) {
		const api = new SyncthingApi({
			apiKey: cfg.syncthing.apiKey,
			guiAddress: cfg.syncthing.guiAddress,
		});
		const sys = await api.systemStatus();
		log.plain("");
		log.plain("On the introducer machine, run:");
		log.plain(`  ccsync accept ${sys.myID}`);
	}
}
