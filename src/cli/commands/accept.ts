import { createInterface } from "node:readline/promises";
import { apply } from "../../core/applier.js";
import { readConfig, writeConfig } from "../../core/config-io.js";
import { type Peer, PeerSchema } from "../../core/config-schema.js";
import { SyncthingApi } from "../../core/syncthing-api.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export interface AcceptOptions {
	deviceId?: string;
	all?: boolean;
}

interface PendingDevice {
	time: string;
	name: string;
	address: string;
}

interface PendingResponse {
	[deviceId: string]: PendingDevice;
}

export async function handleAccept(opts: AcceptOptions): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	if (!cfg.syncthing) {
		log.error("config.syncthing missing — run `ccsync init` first");
		process.exitCode = 1;
		return;
	}
	const api = new SyncthingApi({
		apiKey: cfg.syncthing.apiKey,
		guiAddress: cfg.syncthing.guiAddress,
	});

	if (opts.deviceId) {
		await acceptOne(cfg, api, opts.deviceId, opts.deviceId.slice(0, 7));
		return;
	}

	const pending = await loadPending(api);
	const ids = Object.keys(pending);
	if (ids.length === 0) {
		log.success("No pending devices");
		return;
	}

	if (opts.all) {
		for (const id of ids) await acceptOne(cfg, api, id, pending[id].name);
		return;
	}

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		for (const id of ids) {
			const meta = pending[id];
			log.plain("");
			log.plain(`Pending: ${meta.name || "(unnamed)"} ${id}`);
			log.plain(`Address: ${meta.address}  Seen: ${meta.time}`);
			const ans = (await rl.question("Accept? [y/N] ")).trim().toLowerCase();
			if (ans === "y" || ans === "yes") {
				await acceptOne(cfg, api, id, meta.name || id.slice(0, 7));
			} else {
				log.plain("Skipped");
			}
		}
	} finally {
		rl.close();
	}
}

async function loadPending(api: SyncthingApi): Promise<PendingResponse> {
	try {
		return (await (api as unknown as { request: <T>(m: string, p: string) => Promise<T> }).request(
			"GET",
			"/rest/cluster/pending/devices",
		)) as PendingResponse;
	} catch {
		return {};
	}
}

async function acceptOne(
	cfg: Awaited<ReturnType<typeof readConfig>>,
	api: SyncthingApi,
	deviceId: string,
	label: string,
): Promise<void> {
	if (cfg.peers.find((p) => p.deviceId === deviceId)) {
		log.warn(`Already paired with ${label} (${deviceId.slice(0, 7)}…)`);
		return;
	}
	const peer: Peer = PeerSchema.parse({
		deviceId,
		name: label,
		addresses: ["dynamic"],
		introducer: false,
	});
	cfg.peers.push(peer);
	await writeConfig(ccsyncConfigPath(), cfg);
	log.success(`Accepted ${label} (${deviceId.slice(0, 7)}…)`);
	log.step("Applying config to Syncthing…");
	await apply(cfg);
	log.success("Done");
}
