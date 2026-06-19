import { readConfig, writeConfig } from "../../core/config-io.js";
import { type Peer, PeerSchema } from "../../core/config-schema.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export interface PairOptions {
	deviceId: string;
	name?: string;
}

export async function handlePair(opts: PairOptions): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	const short = opts.deviceId.slice(0, 7);
	const peer: Peer = PeerSchema.parse({
		deviceId: opts.deviceId,
		name: opts.name ?? short,
		addresses: ["dynamic"],
	});
	if (cfg.peers.find((p) => p.deviceId === peer.deviceId)) {
		log.warn(`Peer ${short} already paired`);
		return;
	}
	cfg.peers.push(peer);
	await writeConfig(cfgPath, cfg);
	log.success(`Added peer ${peer.name} (${short})`);
	log.plain("Run `ccsync push` to apply the pairing to Syncthing.");
}
