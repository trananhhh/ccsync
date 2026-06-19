import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import { apply } from "../core/applier.js";
import { watchAndAutoAccept } from "../core/auto-accept.js";
import { configExists, readConfig, writeConfig } from "../core/config-io.js";
import { type Peer, PeerSchema } from "../core/config-schema.js";
import { findConflicts } from "../core/conflicts-scanner.js";
import { consumeOne, createInvite, listInvites } from "../core/invite-store.js";
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
		await handlePending(cfg, pending);
		return;
	}

	await showDashboard(cfg, api);
	await shortcutPrompt(cfg, api);
}

async function handlePending(cfg: Cfg, pending: PendingMap): Promise<void> {
	const live = await listInvites();
	if (live.length > 0) {
		for (const id of Object.keys(pending)) {
			const slot = await consumeOne();
			if (!slot) break;
			const peer: Peer = PeerSchema.parse({
				deviceId: id,
				name: pending[id].name || id.slice(0, 7),
				addresses: ["dynamic"],
				introducer: false,
			});
			cfg.peers.push(peer);
		}
		await writeConfig(ccsyncConfigPath(), cfg);
		await apply(cfg);
		log.success(`Auto-accepted ${Object.keys(pending).length} machine(s) via invite token`);
		return;
	}
	await manualAcceptPrompt(cfg, pending);
}

async function manualAcceptPrompt(cfg: Cfg, pending: PendingMap): Promise<void> {
	log.plain("");
	const ids = Object.keys(pending);
	log.warn(`${ids.length} machine(s) want to join (no fresh invite token):`);
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

function humanBytes(b: number): string {
	if (b < 1024) return `${b} B`;
	if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
	if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
	return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
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
	let totalLocalFiles = 0;
	let totalGlobalFiles = 0;
	let totalLocalBytes = 0;
	let totalNeedBytes = 0;
	let missingPaths = 0;
	const { promises: fsp } = await import("node:fs");
	for (const f of folders) {
		try {
			const s = await api.folderStatus(f.id);
			if (s.needFiles > 0 || s.needBytes > 0) pendingFolders++;
			totalLocalFiles += s.localFiles;
			totalGlobalFiles += s.globalFiles;
			totalLocalBytes += s.localBytes;
			totalNeedBytes += s.needBytes;
		} catch {
			// folder not yet known to Syncthing
		}
		try {
			await fsp.stat(f.path);
		} catch {
			missingPaths++;
		}
	}
	const peersOnline = cfg.peers.filter((p) => conns.connections[p.deviceId]?.connected).length;

	console.log("");
	console.log(
		`${pc.bold(pc.cyan(cfg.machineName))}  ${pc.dim("•")}  ` +
			`${peersOnline}/${cfg.peers.length} peers online  ${pc.dim("•")}  ` +
			`${enabledBuckets.length} buckets / ${folders.length} folders`,
	);
	console.log(
		pc.dim(
			`  ${totalLocalFiles}/${totalGlobalFiles} files  ${humanBytes(totalLocalBytes)} local  ${pendingFolders > 0 ? `${humanBytes(totalNeedBytes)} to fetch` : "in sync"}`,
		),
	);
	if (missingPaths > 0) {
		log.warn(`${missingPaths} folder path(s) don't exist on disk — run \`ccsync diagnose\``);
	}
	if (totalGlobalFiles === 0 && cfg.peers.length > 0) {
		log.warn("All folders empty — possibly mis-configured paths. Run `ccsync diagnose`");
	} else if (pendingFolders === 0) {
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
			await printInviteAndWait(cfg, api);
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

async function printInviteAndWait(cfg: Cfg, api: SyncthingApi): Promise<void> {
	const sys = await api.systemStatus();
	await createInvite();
	const token = encodeInvite({
		deviceId: sys.myID,
		name: cfg.machineName,
		introducer: true,
	});
	console.log("");
	log.success("Run this on the new machine (one-time, expires in 10 min):");
	console.log("");
	console.log(`  ${pc.cyan(`npx @trananhhh/ccsync setup ${token}`)}`);
	console.log("");
	log.plain(pc.dim("Keeping this open — I'll auto-accept the join (Ctrl+C to exit)."));
	console.log("");

	const accepted = await watchAndAutoAccept({ api });
	if (accepted === 0) {
		log.plain(pc.dim("\nNo machine joined within the window."));
	} else {
		log.success(`\nJoined: ${accepted} machine(s). Syncing.`);
	}
}
