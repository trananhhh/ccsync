import * as os from "node:os";
import { createInterface } from "node:readline/promises";
import { apply } from "../../core/applier.js";
import { DEFAULT_BUCKETS } from "../../core/buckets-default.js";
import { listClaudeProjects } from "../../core/claude-projects.js";
import { configExists, readConfig, writeConfig } from "../../core/config-io.js";
import { type Config, ConfigSchema } from "../../core/config-schema.js";
import { GLOBAL_IGNORE_PATTERNS } from "../../core/ignores-default.js";
import { encodeInvite } from "../../core/invite-token.js";
import { SyncthingApi } from "../../core/syncthing-api.js";
import {
	generateHome,
	isDaemonRunning,
	readIdentity,
	startDaemon,
} from "../../core/syncthing-bootstrap.js";
import { log } from "../../lib/log.js";
import { ensureSyncthing } from "../../platform/installer.js";
import { ccsyncConfigPath, syncthingHome } from "../../platform/paths.js";
import { handleJoin } from "./join.js";

export interface SetupOptions {
	token?: string;
	machineName?: string;
}

export async function handleSetup(opts: SetupOptions): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	if (!(await configExists(cfgPath))) {
		await bootstrap(opts.machineName);
	}

	if (opts.token) {
		await handleJoin({ token: opts.token });
		log.plain("");
		log.success(
			"Setup complete. The other machine will prompt to accept this device on its next `ccsync` run.",
		);
		return;
	}

	await autoAddProjects();
	await applyConfig();
	await printShareInstructions();
}

async function bootstrap(machineName?: string): Promise<void> {
	log.step("Installing Syncthing if needed…");
	const install = await ensureSyncthing();
	if (!install.installed) {
		log.error(install.message);
		throw new Error(install.message);
	}

	const stHome = syncthingHome();
	log.step("Bootstrapping Syncthing identity…");
	await generateHome(stHome);
	const identity = await readIdentity(stHome);

	const cfg: Config = ConfigSchema.parse({
		machineName: machineName ?? os.hostname(),
		syncthing: { apiKey: identity.apiKey, guiAddress: identity.guiAddress, homeDir: stHome },
		peers: [],
		buckets: DEFAULT_BUCKETS,
		globalIgnore: GLOBAL_IGNORE_PATTERNS,
	});
	await writeConfig(ccsyncConfigPath(), cfg);

	if (!(await isDaemonRunning(identity.guiAddress))) {
		log.step("Starting Syncthing daemon…");
		await startDaemon(stHome);
		await waitForDaemon(identity.guiAddress);
	}
}

async function waitForDaemon(guiAddress: string): Promise<void> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (await isDaemonRunning(guiAddress)) return;
		await new Promise((r) => setTimeout(r, 500));
	}
}

async function autoAddProjects(): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	const bucket = cfg.buckets["active-projects"];
	if (!bucket) return;
	const projects = await listClaudeProjects();
	const candidates = projects
		.filter((p) => p.exists && !bucket.paths.includes(p.projectPath))
		.map((p) => p.projectPath);
	if (candidates.length === 0) return;

	log.plain("");
	log.plain(`Detected ${candidates.length} Claude Code project(s):`);
	for (const p of candidates) log.plain(`  • ${p}`);
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const ans = (await rl.question("Sync them? [Y/n] ")).trim().toLowerCase();
		if (ans === "n" || ans === "no") return;
	} finally {
		rl.close();
	}
	bucket.paths.push(...candidates);
	bucket.enabled = true;
	await writeConfig(cfgPath, cfg);
	log.success(`Added ${candidates.length} project(s)`);
}

async function applyConfig(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	try {
		await apply(cfg);
	} catch (err) {
		log.warn(`Could not apply to Syncthing yet: ${(err as Error).message}`);
	}
}

async function printShareInstructions(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	if (!cfg.syncthing) return;
	const api = new SyncthingApi({
		apiKey: cfg.syncthing.apiKey,
		guiAddress: cfg.syncthing.guiAddress,
	});
	const sys = await api.systemStatus();
	const token = encodeInvite({
		deviceId: sys.myID,
		name: cfg.machineName,
		introducer: true,
	});

	log.plain("");
	log.success(`Ready — you're "${cfg.machineName}"`);
	log.plain("");
	log.plain("To add another machine, run this on it:");
	log.plain(`  npx @trananhhh/ccsync setup ${token}`);
}
