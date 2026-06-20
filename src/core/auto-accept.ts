import { log } from "../lib/log.js";
import { ccsyncConfigPath } from "../platform/paths.js";
import { apply } from "./applier.js";
import { readConfig, writeConfig } from "./config-io.js";
import { type Peer, PeerSchema } from "./config-schema.js";
import { consumeOne, listInvites } from "./invite-store.js";
import type { SyncthingApi } from "./syncthing-api.js";
import { fetchPending } from "./syncthing-pending.js";

export interface WatchOptions {
	api: SyncthingApi;
	pollMs?: number;
	deadline?: number;
}

export async function watchAndAutoAccept(opts: WatchOptions): Promise<number> {
	const poll = opts.pollMs ?? 3000;
	const deadline = opts.deadline ?? Date.now() + 10 * 60 * 1000;
	let accepted = 0;

	while (Date.now() < deadline) {
		const invites = await listInvites();
		if (invites.length === 0) break;

		const pending = await fetchPending(opts.api);
		const ids = Object.keys(pending);

		for (const id of ids) {
			const slot = await consumeOne();
			if (!slot) break;
			const accepted_ok = await acceptDevice(id, pending[id].name || id.slice(0, 7));
			if (accepted_ok) accepted += 1;
		}

		if (accepted > 0 && (await listInvites()).length === 0) break;
		await new Promise((r) => setTimeout(r, poll));
	}

	return accepted;
}

async function acceptDevice(deviceId: string, label: string): Promise<boolean> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	if (cfg.peers.find((p) => p.deviceId === deviceId)) return false;
	const peer: Peer = PeerSchema.parse({
		deviceId,
		name: label,
		addresses: ["dynamic"],
		introducer: false,
	});
	cfg.peers.push(peer);
	await writeConfig(cfgPath, cfg);
	await apply(cfg);
	log.success(`Auto-accepted ${label} (${deviceId.slice(0, 7)}…)`);
	return true;
}
