import { confirm, rawlist } from "@inquirer/prompts";
import { createSpinner } from "nanospinner";
import pc from "picocolors";
import { apply } from "../core/applier.js";
import { watchAndAutoAccept } from "../core/auto-accept.js";
import { configExists, readConfig, writeConfig } from "../core/config-io.js";
import { type Peer, PeerSchema } from "../core/config-schema.js";
import { findConflicts } from "../core/conflicts-scanner.js";
import { consumeOne, createInvite, listInvites } from "../core/invite-store.js";
import { encodeInvite } from "../core/invite-token.js";
import { inviteRootProfile } from "../core/root-profile.js";
import { SyncthingApi } from "../core/syncthing-api.js";
import { bootstrapFreshHome, stopDaemon } from "../core/syncthing-bootstrap.js";
import { buildFolders } from "../core/syncthing-config.js";
import { migrateToDedicatedHome, needsMigration } from "../core/syncthing-migrate.js";
import { fetchPending, type PendingMap } from "../core/syncthing-pending.js";
import { log } from "../lib/log.js";
import { isInteractive } from "../lib/prompt-or.js";
import { ccsyncConfigPath, syncthingHome } from "../platform/paths.js";
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

	if (await maybeMigrateLegacyHome(cfg)) return;

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

/**
 * Legacy configs point `syncthing.homeDir` at the old shared platform-default
 * home. Detect that on the next run and offer a clean re-pair migration onto the
 * dedicated `~/.ccsync/syncthing` home — this changes the device identity, so
 * the user is told plainly and given a fresh invite token to re-pair.
 */
async function maybeMigrateLegacyHome(cfg: Cfg): Promise<boolean> {
	if (!cfg.syncthing) return false;
	const dedicated = syncthingHome();
	if (!needsMigration(cfg, dedicated)) return false;

	log.plain("");
	log.warn(
		`ccsync now runs Syncthing from its own home (${dedicated}), separate from the shared Syncthing at ${cfg.syncthing.homeDir}.`,
	);
	log.warn(
		"Migrating gives this machine a NEW device identity — you'll need to re-pair your other machines.",
	);
	const proceed = isInteractive()
		? await confirm({ message: "Migrate now? (recommended)", default: true })
		: false;
	if (!proceed) {
		log.plain("Skipped — ccsync keeps using the shared home until you migrate.");
		return false;
	}

	const spinner = isInteractive()
		? createSpinner("Migrating to a dedicated Syncthing home…").start()
		: null;
	const result = await migrateToDedicatedHome(cfg, dedicated, {
		stopOldDaemon: async (guiAddress, apiKey) => {
			await stopDaemon(guiAddress, apiKey);
		},
		bootstrapFresh: (homeDir) => bootstrapFreshHome(homeDir),
		writeConfig: (next) => writeConfig(ccsyncConfigPath(), next),
	});
	spinner?.success({ text: "Migrated to a dedicated Syncthing home" });
	spinner?.stop();

	// Re-populate the fresh daemon with our buckets/peers.
	await apply(cfg);

	await createInvite();
	const token = encodeInvite({
		deviceId: result.deviceId,
		name: cfg.machineName,
		introducer: true,
		rootProfile: cfg.rootProfile ? inviteRootProfile(cfg.rootProfile) : undefined,
	});
	log.plain("");
	log.warn("Your device identity changed. Re-pair each other machine with this one-time token:");
	console.log("");
	console.log(`  ${pc.cyan(`npx @trananhhh/ccsync setup ${token}`)}`);
	console.log("");
	return true;
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

	const accept = await confirm({ message: "Accept all?", default: true });
	if (!accept) return;

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
	const spinner = isInteractive() ? createSpinner("Applying to Syncthing…").start() : null;
	try {
		await apply(cfg);
		spinner?.success({ text: `Accepted ${ids.length} device(s)` });
	} catch (err) {
		spinner?.error({ text: `Apply failed: ${(err as Error).message}` });
		throw err;
	} finally {
		spinner?.stop();
	}
	if (!spinner) log.success(`Accepted ${ids.length} device(s)`);
}

function humanBytes(b: number): string {
	if (b < 1024) return `${b} B`;
	if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
	if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
	return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function showDashboard(cfg: Cfg, api: SyncthingApi): Promise<void> {
	const spinner = isInteractive() ? createSpinner("Reading sync status…").start() : null;
	const sys = await api.systemStatus();
	const conns = await api.connections();
	const enabledBuckets = Object.entries(cfg.buckets).filter(([, b]) => b.enabled);
	const folders = buildFolders({
		machineName: cfg.machineName,
		myDeviceId: sys.myID,
		buckets: cfg.buckets,
		peers: cfg.peers,
		rootProfile: cfg.rootProfile,
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
	const conflicts = await findConflicts(cfg).catch(() => []);
	spinner?.success({ text: "Status ready" });
	spinner?.stop();

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

	if (conflicts.length > 0) {
		log.warn(`${conflicts.length} conflict file(s) — press [c] to resolve`);
	}
}

async function shortcutPrompt(cfg: Cfg, api: SyncthingApi): Promise<void> {
	if (!isInteractive()) return;
	console.log("");
	const ans = await rawlist({
		message: "Action",
		choices: [
			{ name: "[s] status detail", value: "s" },
			{ name: "[n] add a machine", value: "n" },
			{ name: "[c] conflicts", value: "c" },
			{ name: "[r] release & switch", value: "r" },
			{ name: "[q] quit", value: "q" },
		],
		loop: false,
	});

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
	const spinner = isInteractive() ? createSpinner("Generating invite…").start() : null;
	const sys = await api.systemStatus();
	await createInvite();
	const token = encodeInvite({
		deviceId: sys.myID,
		name: cfg.machineName,
		introducer: true,
		rootProfile: cfg.rootProfile ? inviteRootProfile(cfg.rootProfile) : undefined,
	});
	spinner?.success({ text: "Invite ready" });
	spinner?.stop();

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
