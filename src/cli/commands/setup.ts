import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { input } from "@inquirer/prompts";
import { createSpinner } from "nanospinner";
import { apply } from "../../core/applier.js";
import { DEFAULT_BUCKETS, withCodeRootBucket } from "../../core/buckets-default.js";
import {
	detectClaudeConversationsForRoot,
	listClaudeProjects,
} from "../../core/claude-projects.js";
import { findCodeFolderCandidates } from "../../core/code-folders.js";
import { configExists, readConfig, writeConfig } from "../../core/config-io.js";
import { type Config, ConfigSchema, type RootProfile } from "../../core/config-schema.js";
import { resetCcsyncState } from "../../core/fresh-reset.js";
import { GLOBAL_IGNORE_PATTERNS } from "../../core/ignores-default.js";
import { encodeInvite } from "../../core/invite-token.js";
import {
	createRootProfile,
	inviteRootProfile,
	isPathInsideRoot,
	rootConversationPath,
	rootConversations,
	suggestRootFromProjects,
} from "../../core/root-profile.js";
import { SyncthingApi } from "../../core/syncthing-api.js";
import { ensureDaemonRunning, generateHome, readIdentity } from "../../core/syncthing-bootstrap.js";
import { log } from "../../lib/log.js";
import { isInteractive } from "../../lib/prompt-or.js";
import { ensureSyncthing } from "../../platform/installer.js";
import { ccsyncConfigPath, syncthingHome } from "../../platform/paths.js";
import { pickClaudeConfigPaths } from "../claude-config-picker.js";
import { pickBuckets, pickCodeFolders } from "../wizard.js";
import { handleJoin } from "./join.js";

export interface SetupOptions {
	token?: string;
	machineName?: string;
	fresh?: boolean;
}

export async function handleSetup(opts: SetupOptions): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	if (opts.fresh) {
		log.step("Resetting local ccsync config…");
		await resetCcsyncState();
	}
	if (!(await configExists(cfgPath))) {
		await bootstrap(opts.machineName);
	}

	if (opts.token) {
		await ensureConfiguredDaemon();
		await handleJoin({ token: opts.token });
		log.plain("");
		log.success(
			"Setup complete. The other machine will prompt to accept this device on its next `ccsync` run.",
		);
		return;
	}

	await configureBuckets();
	await configureRootProfile();
	await ensureConfiguredDaemon();
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
	const spinner = isInteractive()
		? createSpinner("Bootstrapping Syncthing identity…").start()
		: null;
	if (!spinner) log.step("Bootstrapping Syncthing identity…");
	await generateHome(stHome);
	const identity = await readIdentity(stHome);
	spinner?.success({ text: "Syncthing identity ready" });
	spinner?.stop();

	const cfg: Config = ConfigSchema.parse({
		machineName: machineName ?? os.hostname(),
		syncthing: { apiKey: identity.apiKey, guiAddress: identity.guiAddress, homeDir: stHome },
		peers: [],
		buckets: DEFAULT_BUCKETS,
		globalIgnore: GLOBAL_IGNORE_PATTERNS,
	});
	await writeConfig(ccsyncConfigPath(), cfg);

	await ensureConfiguredDaemon();
}

async function configureBuckets(): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	cfg.buckets = await pickBuckets(cfg.buckets);
	if (cfg.buckets["claude-config"]?.enabled) {
		cfg.buckets["claude-config"] = await pickClaudeConfigPaths(cfg.buckets["claude-config"]);
	}
	await writeConfig(cfgPath, cfg);
}

async function ensureConfiguredDaemon(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	if (!cfg.syncthing) return;
	const install = await ensureSyncthing();
	if (!install.installed) throw new Error(install.message);
	const status = await ensureDaemonRunning(cfg.syncthing.homeDir, cfg.syncthing.guiAddress);
	if (status === "started") log.success("Syncthing daemon started");
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
	const ans = await input({
		message: "Code root",
		default: suggestedRoot,
	});
	const root = path.resolve(ans.trim() || suggestedRoot);

	await fs.mkdir(root, { recursive: true });
	const rootConversations = await detectClaudeConversationsForRoot(root);
	const selectedCodeFolders = await pickCodeFolders(
		root,
		await findCodeFolderCandidates(
			root,
			rootConversations.projects.map((project) => project.relativePath),
		),
	);
	const ignoredCount = countCcsyncignores(root, selectedCodeFolders);
	if (ignoredCount > 0) {
		log.plain(
			`I scanned your code folders; I found a \`.ccsyncignore\` in ${ignoredCount} of them — they'll be applied automatically.`,
		);
	}
	const rootProjects = rootConversations.projects.filter((project) =>
		isPathInsideRoot(root, path.join(root, project.relativePath)),
	);
	cfg.rootProfile = createRootProfile({
		canonicalRoot: root,
		localRoot: root,
		codeFolders: selectedCodeFolders.map((relativePath) => ({ relativePath })),
		projects: rootProjects,
		conversations: rootConversations.conversations,
	});

	cfg.buckets = withCodeRootBucket(cfg.buckets, root, selectedCodeFolders);
	if (cfg.buckets["claude-conversations"]?.enabled) await ensureConversationDirs(cfg.rootProfile);
	await writeConfig(cfgPath, cfg);
	log.success(`Root profile configured: ${root}`);
	log.success(`Selected ${selectedCodeFolders.length} code folder(s)`);
	if (rootProjects.length > 0)
		log.success(`Mapped ${rootProjects.length} Claude conversation project(s)`);
	if (cfg.buckets["claude-conversations"]?.enabled) {
		log.success(`Selected ${rootConversations.conversations.length} total Claude conversation(s)`);
	} else {
		log.warn("Claude conversations disabled");
	}
}

async function applyConfig(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	const spinner = isInteractive() ? createSpinner("Applying config to Syncthing…").start() : null;
	if (!spinner) log.step("Applying to Syncthing…");
	try {
		await apply(cfg);
		spinner?.success({ text: "Config applied" });
	} catch (err) {
		spinner?.error({ text: `Could not apply: ${(err as Error).message}` });
	}
	spinner?.stop();
}

async function printShareInstructions(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	if (!cfg.syncthing) return;
	const api = new SyncthingApi({
		apiKey: cfg.syncthing.apiKey,
		guiAddress: cfg.syncthing.guiAddress,
	});
	const spinner = isInteractive() ? createSpinner("Preparing invite token…").start() : null;
	if (!spinner) log.step("Preparing invite token…");
	const sys = await api.systemStatus();
	const token = encodeInvite({
		deviceId: sys.myID,
		name: cfg.machineName,
		introducer: true,
		rootProfile: cfg.rootProfile ? inviteRootProfile(cfg.rootProfile) : undefined,
	});
	spinner?.success({ text: "Invite ready" });
	spinner?.stop();

	log.plain("");
	log.success(`Ready — you're "${cfg.machineName}"`);
	log.plain("");
	log.plain("To add another machine, run this on it:");
	log.plain(`  npx @trananhhh/ccsync setup ${token}`);
}

async function ensureConversationDirs(profile: RootProfile): Promise<void> {
	for (const conversation of rootConversations(profile)) {
		await fs.mkdir(rootConversationPath(profile, conversation), { recursive: true });
	}
}

function countCcsyncignores(root: string, folders: string[]): number {
	let count = 0;
	for (const relativePath of folders) {
		if (relativePath === ".") {
			if (existsSync(path.join(root, ".ccsyncignore"))) count++;
			continue;
		}
		if (existsSync(path.join(root, relativePath, ".ccsyncignore"))) count++;
	}
	return count;
}
