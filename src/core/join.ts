import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { log } from "../lib/log.js";
import { ensureSyncthing as defaultEnsureSyncthing } from "../platform/installer.js";
import { ccsyncConfigPath } from "../platform/paths.js";
import { apply as defaultApply } from "./applier.js";
import { withCodeRootBucket } from "./buckets-default.js";
import { readConfig as defaultReadConfig, writeConfig as defaultWriteConfig } from "./config-io.js";
import { type Peer, PeerSchema, type RootProfile } from "./config-schema.js";
import { decodeInvite } from "./invite-token.js";
import { createRootProfile, rootConversationPath, rootConversations } from "./root-profile.js";
import { ensureDaemonRunning as defaultEnsureDaemonRunning } from "./syncthing-bootstrap.js";

/**
 * Dependency seams so the join core can run head-less in the control service and
 * be unit-tested without touching Syncthing or the real config on disk. Defaults
 * wire up the production implementations.
 */
export interface JoinWithTokenOptions {
	/**
	 * Where the invite's code root should live on this machine. REQUIRED when the
	 * invite carries a `rootProfile` and the local config has none. `joinWithToken`
	 * NEVER prompts — a no-TTY caller (the service) would hang — so the CLI prompts
	 * first and passes the chosen value here.
	 */
	localRoot?: string;
	configPath?: string;
	readConfig?: typeof defaultReadConfig;
	writeConfig?: typeof defaultWriteConfig;
	apply?: typeof defaultApply;
	ensureSyncthing?: typeof defaultEnsureSyncthing;
	ensureDaemonRunning?: typeof defaultEnsureDaemonRunning;
}

export interface JoinResult {
	machineName: string;
	rootProfileMapped: boolean;
	localRoot?: string;
	peerAdded: boolean;
	alreadyPaired: boolean;
	peerName: string;
	deviceId: string;
	foldersConfigured: number;
	devicesConfigured: number;
}

/**
 * Apply an invite token to the local config and Syncthing: reconstruct the code
 * root profile (when the invite carries one and we don't already have one), add
 * the inviter as a peer, then ensure the daemon is up and apply. Pure of any
 * prompt so both the CLI and the control service can drive it.
 */
export async function joinWithToken(
	token: string,
	opts: JoinWithTokenOptions = {},
): Promise<JoinResult> {
	const readConfig = opts.readConfig ?? defaultReadConfig;
	const writeConfig = opts.writeConfig ?? defaultWriteConfig;
	const apply = opts.apply ?? defaultApply;
	const ensureSyncthing = opts.ensureSyncthing ?? defaultEnsureSyncthing;
	const ensureDaemonRunning = opts.ensureDaemonRunning ?? defaultEnsureDaemonRunning;
	const cfgPath = opts.configPath ?? ccsyncConfigPath();

	const cfg = await readConfig(cfgPath);
	const inv = decodeInvite(token);
	let changed = false;
	let rootProfileMapped = false;
	let mappedLocalRoot: string | undefined;

	if (inv.rootProfile && !cfg.rootProfile) {
		if (!opts.localRoot) {
			throw new Error(
				"This invite carries a code root — choose where it should live locally before joining.",
			);
		}
		const localRoot = path.resolve(opts.localRoot);
		await fs.mkdir(localRoot, { recursive: true });
		cfg.rootProfile = createRootProfile({
			id: inv.rootProfile.id,
			canonicalRoot: inv.rootProfile.canonicalRoot,
			localRoot,
			codeFolders: inv.rootProfile.codeFolders,
			projects: inv.rootProfile.projects,
			conversations: inv.rootProfile.conversations,
		});
		cfg.buckets = withCodeRootBucket(
			cfg.buckets,
			localRoot,
			cfg.rootProfile.codeFolders.map((folder) => folder.relativePath),
		);
		const ignoredCount = countCcsyncignores(
			localRoot,
			cfg.rootProfile.codeFolders.map((folder) => folder.relativePath),
		);
		if (ignoredCount > 0) {
			log.plain(
				`I scanned your code folders; I found a \`.ccsyncignore\` in ${ignoredCount} of them — they'll be applied automatically.`,
			);
		}
		await ensureConversationDirs(cfg.rootProfile);
		changed = true;
		rootProfileMapped = true;
		mappedLocalRoot = localRoot;
		log.success(`Root profile mapped to ${localRoot}`);
	}

	const alreadyPaired = Boolean(cfg.peers.find((p) => p.deviceId === inv.deviceId));
	let peerAdded = false;
	if (alreadyPaired) {
		log.warn(`Already paired with ${inv.name} (${inv.deviceId.slice(0, 7)}…)`);
	} else {
		const peer: Peer = PeerSchema.parse({
			deviceId: inv.deviceId,
			name: inv.name,
			addresses: ["dynamic"],
			introducer: inv.introducer,
		});
		cfg.peers.push(peer);
		changed = true;
		peerAdded = true;
		log.success(
			`Added ${inv.name} (${inv.deviceId.slice(0, 7)}…) as peer` +
				(inv.introducer ? " [introducer]" : ""),
		);
	}
	if (changed) await writeConfig(cfgPath, cfg);

	if (!cfg.syncthing) {
		throw new Error("config.syncthing missing — run `ccsync setup` first");
	}
	const install = await ensureSyncthing();
	if (!install.installed) throw new Error(install.message);
	const daemonStatus = await ensureDaemonRunning(cfg.syncthing.homeDir, cfg.syncthing.guiAddress);
	if (daemonStatus === "started") log.success("Syncthing daemon started");

	const res = await apply(cfg);

	return {
		machineName: cfg.machineName,
		rootProfileMapped,
		localRoot: mappedLocalRoot,
		peerAdded,
		alreadyPaired,
		peerName: inv.name,
		deviceId: inv.deviceId,
		foldersConfigured: res.foldersConfigured,
		devicesConfigured: res.devicesConfigured,
	};
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
