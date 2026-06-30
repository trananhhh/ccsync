import * as fs from "node:fs/promises";
import pc from "picocolors";
import { readConfig } from "../../core/config-io.js";
import { SyncthingApi } from "../../core/syncthing-api.js";
import { buildFolders } from "../../core/syncthing-config.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export async function handleDiagnose(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	if (!cfg.syncthing) {
		log.error("config.syncthing missing");
		return;
	}
	const api = new SyncthingApi({
		apiKey: cfg.syncthing.apiKey,
		guiAddress: cfg.syncthing.guiAddress,
	});

	const sys = await api.systemStatus();
	const conns = await api.connections();
	const stConfig = await api.getConfig();

	console.log("");
	console.log(pc.bold("Machine"));
	console.log(`  name        ${cfg.machineName}`);
	console.log(`  device id   ${sys.myID}`);
	console.log(`  daemon      ${cfg.syncthing.guiAddress}`);
	console.log(`  home        ${cfg.syncthing.homeDir}`);

	await reportNativeSyncthing(cfg.syncthing.guiAddress);

	console.log("");
	console.log(pc.bold("Peers"));
	if (cfg.peers.length === 0) {
		console.log(pc.dim("  (none paired)"));
	}
	for (const p of cfg.peers) {
		const c = conns.connections[p.deviceId];
		const status = c?.connected ? pc.green("connected") : pc.red("disconnected");
		console.log(`  ${p.name}  ${pc.dim(`${p.deviceId.slice(0, 14)}…`)}  ${status}`);
		if (c?.connected) {
			console.log(
				pc.dim(
					`    address=${c.address}  in=${human(c.inBytesTotal)}  out=${human(c.outBytesTotal)}`,
				),
			);
		}
		if (p.introducer) console.log(pc.dim("    (introducer)"));
	}

	console.log("");
	console.log(pc.bold("Folders"));
	const planned = buildFolders({
		machineName: cfg.machineName,
		myDeviceId: sys.myID,
		buckets: cfg.buckets,
		peers: cfg.peers,
		rootProfile: cfg.rootProfile,
	});

	for (const f of planned) {
		const exists = await pathInfo(f.path);
		const inSt = stConfig.folders.find((x) => x.id === f.id);
		const stStatus = await api.folderStatus(f.id).catch(() => null);
		console.log(`  ${pc.cyan(f.id)}`);
		console.log(`    path        ${f.path} ${exists}`);
		console.log(`    in syncthing ${inSt ? pc.green("yes") : pc.red("NO — push needed")}`);
		if (stStatus) {
			console.log(
				`    state       ${stStatus.state}  files=${stStatus.localFiles}/${stStatus.globalFiles}  bytes=${human(stStatus.localBytes)}/${human(stStatus.globalBytes)}  need=${stStatus.needFiles}`,
			);
		}
	}

	console.log("");
	console.log(pc.bold("Hints"));
	const fileOnlyPaths = planned
		.filter((f) => !f.path.endsWith("/"))
		.map((f) => f.path)
		.filter((p) => p.match(/\.(json|md|sh|cjs|js|ts)$/));
	if (fileOnlyPaths.length > 0) {
		console.log(
			pc.yellow(
				"  • Some bucket paths point to single files (settings.json, CLAUDE.md, etc.).\n" +
					"    Syncthing folders are directory-based, so single-file shares may not work as expected.\n" +
					"    Affected: " +
					fileOnlyPaths.slice(0, 3).join(", "),
			),
		);
	}
}

/**
 * ccsync runs its OWN Syncthing daemon (dedicated home + private port). If the
 * user also runs the official Syncthing desktop app it normally drives the
 * platform daemon on :8384 — a SEPARATE daemon with its own identity. Two
 * separate daemons syncing the same folders both write deletes/conflicts into the
 * same tree and corrupt each other's view. Detect a stray :8384 daemon (only when
 * ccsync itself isn't the one on :8384) and warn.
 */
async function reportNativeSyncthing(ccsyncGui: string): Promise<void> {
	const ccsyncPort = ccsyncGui.split(":").pop();
	if (ccsyncPort === "8384") return; // ccsync IS the :8384 daemon — nothing separate to collide.

	const found = await probe("http://127.0.0.1:8384/rest/noauth/health");
	console.log("");
	console.log(pc.bold("Native Syncthing app"));
	if (!found) {
		console.log(pc.dim("  No separate Syncthing detected on :8384 — good."));
		return;
	}
	console.log(
		pc.yellow(
			"  ⚠ A separate Syncthing is running on :8384 (likely the desktop app).\n" +
				`    ccsync drives its own daemon at ${ccsyncGui} with a different device id.\n` +
				"    Do NOT add or manage ccsync's folders in that app — two daemons syncing the\n" +
				"    same paths corrupt each other. Pause/resume ccsync folders from ccsync only.",
		),
	);
}

async function probe(url: string): Promise<boolean> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 1000);
	try {
		await fetch(url, { signal: ctrl.signal });
		return true; // any HTTP response means something is listening.
	} catch {
		return false;
	} finally {
		clearTimeout(t);
	}
}

async function pathInfo(p: string): Promise<string> {
	try {
		const s = await fs.stat(p);
		return pc.green(s.isDirectory() ? "(dir)" : "(file)");
	} catch {
		return pc.red("(MISSING)");
	}
}

function human(b: number): string {
	if (b < 1024) return `${b} B`;
	if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
	if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
	return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
