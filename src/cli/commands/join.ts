import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
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
import { log } from "../../lib/log.js";
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

	log.step("Applying config to local Syncthing…");
	const res = await apply(cfg);
	log.success(`Applied: ${res.foldersConfigured} folders, ${res.devicesConfigured} devices`);
}

async function promptLocalRoot(canonicalRoot: string): Promise<string> {
	log.plain("");
	log.plain(`Host canonical root: ${canonicalRoot}`);
	log.plain("Choose where this root should live on this machine.");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const ans = (await rl.question(`Local root [${canonicalRoot}]: `)).trim();
		return path.resolve(ans || canonicalRoot);
	} finally {
		rl.close();
	}
}

async function ensureConversationDirs(profile: RootProfile): Promise<void> {
	for (const conversation of rootConversations(profile)) {
		await fs.mkdir(rootConversationPath(profile, conversation), { recursive: true });
	}
}
