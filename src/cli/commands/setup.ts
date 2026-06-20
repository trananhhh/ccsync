import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import { apply } from "../../core/applier.js";
import { DEFAULT_BUCKETS, withCodeRootBucket } from "../../core/buckets-default.js";
import { listClaudeProjects } from "../../core/claude-projects.js";
import { configExists, readConfig, writeConfig } from "../../core/config-io.js";
import { type Config, ConfigSchema, type RootProfile } from "../../core/config-schema.js";
import { GLOBAL_IGNORE_PATTERNS } from "../../core/ignores-default.js";
import { encodeInvite } from "../../core/invite-token.js";
import {
	claudeConversationPath,
	createRootProfile,
	inviteRootProfile,
	isPathInsideRoot,
	suggestRootFromProjects,
} from "../../core/root-profile.js";
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

	await configureRootProfile();
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

async function configureRootProfile(): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	if (cfg.rootProfile) return;

	const projects = await listClaudeProjects();
	const existingProjects = projects.filter((p) => p.exists).map((p) => p.projectPath);
	const suggestedRoot = suggestRootFromProjects(existingProjects, process.cwd());
	log.plain("");
	log.plain(
		"Choose one code root to sync. Projects under this root can keep Claude conversations mapped across machines.",
	);
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	let root: string;
	try {
		const ans = (await rl.question(`Code root [${suggestedRoot}]: `)).trim();
		root = path.resolve(ans || suggestedRoot);
	} finally {
		rl.close();
	}

	await fs.mkdir(root, { recursive: true });
	const rootProjects = existingProjects
		.filter((projectPath) => isPathInsideRoot(root, projectPath))
		.map((projectPath) => ({ relativePath: path.relative(root, projectPath) || "." }));
	cfg.rootProfile = createRootProfile({
		canonicalRoot: root,
		localRoot: root,
		projects: rootProjects,
	});

	cfg.buckets = withCodeRootBucket(cfg.buckets, root);
	await ensureConversationDirs(cfg.rootProfile);
	await writeConfig(cfgPath, cfg);
	log.success(`Root profile configured: ${root}`);
	if (rootProjects.length > 0)
		log.success(`Mapped ${rootProjects.length} Claude conversation project(s)`);
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
		rootProfile: cfg.rootProfile ? inviteRootProfile(cfg.rootProfile) : undefined,
	});

	log.plain("");
	log.success(`Ready — you're "${cfg.machineName}"`);
	log.plain("");
	log.plain("To add another machine, run this on it:");
	log.plain(`  npx @trananhhh/ccsync setup ${token}`);
}

async function ensureConversationDirs(profile: RootProfile): Promise<void> {
	for (const project of profile.projects) {
		await fs.mkdir(claudeConversationPath(profile, project.relativePath), { recursive: true });
	}
}
