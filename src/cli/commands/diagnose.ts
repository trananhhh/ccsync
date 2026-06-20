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
