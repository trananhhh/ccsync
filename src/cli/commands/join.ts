import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { input } from "@inquirer/prompts";
import { createSpinner } from "nanospinner";
import { apply } from "../../core/applier.js";
import { withCodeRootBucket } from "../../core/buckets-default.js";
import { readConfig, writeConfig } from "../../core/config-io.js";
import { type Peer, PeerSchema, type RootProfile } from "../../core/config-schema.js";
import { decodeInvite } from "../../core/invite-token.js";
import {
	createRootProfile,
	rootConversationPath,
	rootConversations,
} from "../../core/root-profile.js";
import { ensureDaemonRunning } from "../../core/syncthing-bootstrap.js";
import { log } from "../../lib/log.js";
import { isInteractive } from "../../lib/prompt-or.js";
import { ensureSyncthing } from "../../platform/installer.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export interface JoinOptions {
	token: string;
}

export async function handleJoin(opts: JoinOptions): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	const inv = decodeInvite(opts.token);
	let changed = false;

	if (inv.rootProfile && !cfg.rootProfile) {
		const localRoot = await promptLocalRoot(inv.rootProfile.canonicalRoot);
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
		log.success(`Root profile mapped to ${localRoot}`);
	}

	if (cfg.peers.find((p) => p.deviceId === inv.deviceId)) {
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
		log.success(
			`Added ${inv.name} (${inv.deviceId.slice(0, 7)}…) as peer` +
				(inv.introducer ? " [introducer]" : ""),
		);
	}
	if (changed) await writeConfig(cfgPath, cfg);

	if (!cfg.syncthing) {
		log.error("config.syncthing missing — run `ccsync setup` first");
		process.exitCode = 1;
		return;
	}
	const install = await ensureSyncthing();
	if (!install.installed) throw new Error(install.message);
	const daemonStatus = await ensureDaemonRunning(cfg.syncthing.homeDir, cfg.syncthing.guiAddress);
	if (daemonStatus === "started") log.success("Syncthing daemon started");

	const spinner = isInteractive()
		? createSpinner("Applying config to local Syncthing…").start()
		: null;
	if (!spinner) log.step("Applying config to local Syncthing…");
	const res = await apply(cfg);
	spinner?.success({
		text: `Applied: ${res.foldersConfigured} folders, ${res.devicesConfigured} devices`,
	});
	spinner?.stop();
}

async function promptLocalRoot(canonicalRoot: string): Promise<string> {
	log.plain("");
	log.plain(`Host canonical root: ${canonicalRoot}`);
	log.plain("Choose where this root should live on this machine.");
	const ans = await input({
		message: "Local root",
		default: canonicalRoot,
	});
	return path.resolve(ans.trim() || canonicalRoot);
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
