import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import { configExists, readConfig } from "../core/config-io.js";
import { SyncthingApi } from "../core/syncthing-api.js";
import { log } from "../lib/log.js";
import { ccsyncConfigPath } from "../platform/paths.js";
import { handleClaim } from "./commands/claim.js";
import { handleConfig } from "./commands/config.js";
import { handleConflicts } from "./commands/conflicts.js";
import { handleId } from "./commands/id.js";
import { handleInit } from "./commands/init.js";
import { handlePair } from "./commands/pair.js";
import { handlePush } from "./commands/push.js";
import { handleRelease } from "./commands/release.js";
import { handleStatus } from "./commands/status.js";
import { handleSync } from "./commands/sync.js";
import { handleToggle } from "./commands/toggle.js";

interface MenuItem {
	label: string;
	hint?: string;
	run: () => Promise<void> | void;
}

async function printHeader(): Promise<void> {
	const banner = pc.bold(pc.cyan("ccsync"));
	console.log(`\n${banner} — Claude Code multi-machine sync`);
	const cfgPath = ccsyncConfigPath();
	if (!(await configExists(cfgPath))) {
		log.warn("No config yet. Pick \"Initialise\" to set up this machine.");
		return;
	}
	try {
		const cfg = await readConfig(cfgPath);
		const peers = cfg.peers.length;
		const buckets = Object.values(cfg.buckets).filter((b) => b.enabled).length;
		log.plain(
			pc.dim(
				`  machine=${cfg.machineName}  peers=${peers}  enabled_buckets=${buckets}`,
			),
		);
		if (cfg.syncthing) {
			const api = new SyncthingApi({
				apiKey: cfg.syncthing.apiKey,
				guiAddress: cfg.syncthing.guiAddress,
			});
			const reachable = await api.ping();
			log.plain(
				pc.dim(`  daemon=${reachable ? pc.green("up") : pc.red("down")} (${cfg.syncthing.guiAddress})`),
			);
		}
	} catch {
		log.warn("Config exists but failed to parse. Pick \"Edit config\" to inspect.");
	}
}

async function ask(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
	const answer = await rl.question(prompt);
	return answer.trim();
}

function items(): MenuItem[] {
	return [
		{ label: "Status", hint: "show peers + folder sync state", run: () => handleStatus({}) },
		{ label: "Show my device ID", hint: "for pairing on the other machine", run: handleId },
		{
			label: "Pair a device",
			hint: "add a peer by device ID",
			run: async () => {
				const rl = createInterface({ input: process.stdin, output: process.stdout });
				try {
					const deviceId = await ask(rl, "Device ID: ");
					const name = await ask(rl, "Label (optional): ");
					await handlePair({ deviceId, name: name || undefined });
				} finally {
					rl.close();
				}
			},
		},
		{ label: "Push config to Syncthing", hint: "apply local YAML", run: handlePush },
		{ label: "Force rescan now", hint: "trigger immediate sync", run: handleSync },
		{
			label: "Toggle a bucket",
			hint: "enable / disable on this machine",
			run: async () => {
				const rl = createInterface({ input: process.stdin, output: process.stdout });
				try {
					const cfg = await readConfig(ccsyncConfigPath());
					const names = Object.keys(cfg.buckets);
					console.log(pc.dim(`  available: ${names.join(", ")}`));
					const bucket = await ask(rl, "Bucket: ");
					await handleToggle({ bucket });
				} finally {
					rl.close();
				}
			},
		},
		{ label: "Conflicts", hint: "scan + interactively resolve", run: () => handleConflicts({}) },
		{ label: "Claim this machine", run: handleClaim },
		{
			label: "Release & switch",
			hint: "wait for 100% in-sync",
			run: () => handleRelease({ timeout: "300" }),
		},
		{ label: "Edit config", run: () => handleConfig({}) },
		{ label: "Initialise (re-run init)", run: () => handleInit({}) },
		{ label: "Exit", run: () => {} },
	];
}

export async function runInteractive(): Promise<void> {
	await printHeader();
	const menu = items();
	console.log("");
	menu.forEach((m, i) => {
		const num = pc.dim(String(i + 1).padStart(2, " "));
		const hint = m.hint ? pc.dim(`  — ${m.hint}`) : "";
		console.log(`  ${num}  ${m.label}${hint}`);
	});
	console.log("");

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	let chosen: MenuItem | null = null;
	try {
		const raw = await ask(rl, pc.cyan("? ") + "Choose [1-" + menu.length + "]: ");
		const n = Number.parseInt(raw, 10);
		if (Number.isNaN(n) || n < 1 || n > menu.length) {
			log.warn("Invalid selection");
			return;
		}
		chosen = menu[n - 1];
	} finally {
		rl.close();
	}

	if (chosen.label === "Exit") return;
	console.log("");
	await chosen.run();
}
