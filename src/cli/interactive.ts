import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import { apply } from "../core/applier.js";
import { configExists, readConfig, writeConfig } from "../core/config-io.js";
import { type Peer, PeerSchema } from "../core/config-schema.js";
import { findConflicts } from "../core/conflicts-scanner.js";
import { encodeInvite } from "../core/invite-token.js";
import { SyncthingApi } from "../core/syncthing-api.js";
import { buildFolders } from "../core/syncthing-config.js";
import { fetchPending, type PendingMap } from "../core/syncthing-pending.js";
import { log } from "../lib/log.js";
import { ccsyncConfigPath } from "../platform/paths.js";
import { handleConflicts } from "./commands/conflicts.js";
import { handleRelease } from "./commands/release.js";
import { handleSetup } from "./commands/setup.js";
import { handleStatus } from "./commands/status.js";

type Cfg = Awaited<ReturnType<typeof readConfig>>;

export async function runInteractive(): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	if (!(await configExists(cfgPath))) {
		log.info("First time here — let me set things up.");
		log.plain("");
		await handleSetup({});
		return;
	}

	const cfg = await readConfig(cfgPath);
	if (!cfg.syncthing) {
		log.error("Config incomplete — run `ccsync advanced init --force`");
		return;
	}

	const api = new SyncthingApi({
		apiKey: cfg.syncthing.apiKey,
		guiAddress: cfg.syncthing.guiAddress,
	});

	if (!(await api.ping())) {
		log.error(`Syncthing daemon not reachable at ${cfg.syncthing.guiAddress}`);
		log.plain(`Start it with: syncthing serve --home="${cfg.syncthing.homeDir}" &`);
		return;
	}

	const pending = await fetchPending(api);
	if (Object.keys(pending).length > 0) {
		await acceptPending(cfg, pending);
		return;
	}

	await showDashboard(cfg, api);
	await shortcutPrompt(cfg, api);
}

async function acceptPending(cfg: Cfg, pending: PendingMap): Promise<void> {
	log.plain("");
	const ids = Object.keys(pending);
	log.warn(`${ids.length} machine(s) want to join:`);
	for (const id of ids) {
		const m = pending[id];
		log.plain(`  ${pc.bold(m.name || "(unnamed)")} ${pc.dim(`${id.slice(0, 14)}…`)}`);
		log.plain(pc.dim(`    address=${m.address}  seen=${m.time}`));
	}

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	let ans: string;
	try {
		ans = (await rl.question("\nAccept all? [Y/n] ")).trim().toLowerCase();
	} finally {
		rl.close();
	}
	if (ans === "n" || ans === "no") return;

	for (const id of ids) {
		const peer: Peer = PeerSchema.parse({
			deviceId: id,
			name: pending[id].name || id.slice(0, 7),
			addresses: ["dynamic"],
			introducer: false,
		});
		cfg.peers.push(peer);
	}
	await writeConfig(ccsyncConfigPath(), cfg);
	log.step("Applying to Syncthing…");
	await apply(cfg);
	log.success(`Accepted ${ids.length} device(s)`);
}

async function showDashboard(cfg: Cfg, api: SyncthingApi): Promise<void> {
	const sys = await api.systemStatus();
	const conns = await api.connections();
	const enabledBuckets = Object.entries(cfg.buckets).filter(([, b]) => b.enabled);
	const folders = buildFolders({
		machineName: cfg.machineName,
		myDeviceId: sys.myID,
		buckets: cfg.buckets,
		peers: cfg.peers,
	});

	let pendingFolders = 0;
	for (const f of folders) {
		try {
			const s = await api.folderStatus(f.id);
			if (s.needFiles > 0 || s.needBytes > 0) pendingFolders++;
		} catch {
			// folder not yet known to Syncthing
		}
	}
	const peersOnline = cfg.peers.filter((p) => conns.connections[p.deviceId]?.connected).length;

	console.log("");
	console.log(
		`${pc.bold(pc.cyan(cfg.machineName))}  ${pc.dim("•")}  ` +
			`${peersOnline}/${cfg.peers.length} peers online  ${pc.dim("•")}  ` +
			`${enabledBuckets.length} buckets`,
	);
	if (pendingFolders === 0) {
		log.success("All in sync");
	} else {
		log.warn(`${pendingFolders} folder(s) pending — files still transferring`);
	}

	const conflicts = await findConflicts(cfg).catch(() => []);
	if (conflicts.length > 0) {
		log.warn(`${conflicts.length} conflict file(s) — press [c] to resolve`);
	}
}

async function shortcutPrompt(cfg: Cfg, api: SyncthingApi): Promise<void> {
	console.log("");
	console.log(
		pc.dim("  [s] status detail  [n] add a machine  [c] conflicts  [r] release & switch  [q] quit"),
	);

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	let ans: string;
	try {
		ans = (await rl.question("> ")).trim().toLowerCase();
	} finally {
		rl.close();
	}

	switch (ans) {
		case "s":
			await handleStatus({ verbose: true });
			return;
		case "n":
			await printInvite(cfg, api);
			return;
		case "c":
			await handleConflicts({});
			return;
		case "r":
			await handleRelease({ timeout: "300" });
			return;
		default:
			return;
	}
}

async function printInvite(cfg: Cfg, api: SyncthingApi): Promise<void> {
	const sys = await api.systemStatus();
	const token = encodeInvite({
		deviceId: sys.myID,
		name: cfg.machineName,
		introducer: true,
	});
	console.log("");
	log.success("Run this on the new machine:");
	console.log("");
	console.log(`  ${pc.cyan(`npx @trananhhh/ccsync setup ${token}`)}`);
	console.log("");
	log.plain("After it joins, run `ccsync` here to accept.");
}
