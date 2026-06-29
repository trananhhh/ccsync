import * as path from "node:path";
import { input } from "@inquirer/prompts";
import { createSpinner } from "nanospinner";
import { readConfig } from "../../core/config-io.js";
import { decodeInvite } from "../../core/invite-token.js";
import { joinWithToken } from "../../core/join.js";
import { log } from "../../lib/log.js";
import { isInteractive } from "../../lib/prompt-or.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export interface JoinOptions {
	token: string;
}

export async function handleJoin(opts: JoinOptions): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	const inv = decodeInvite(opts.token);

	// The only interactive decision lives here, in the CLI: where the invited code
	// root should live locally. The core `joinWithToken` never prompts.
	let localRoot: string | undefined;
	if (inv.rootProfile && !cfg.rootProfile) {
		localRoot = await promptLocalRoot(inv.rootProfile.canonicalRoot);
	}

	const spinner = isInteractive()
		? createSpinner("Applying config to local Syncthing…").start()
		: null;
	if (!spinner) log.step("Applying config to local Syncthing…");
	try {
		const res = await joinWithToken(opts.token, { localRoot, configPath: cfgPath });
		spinner?.success({
			text: `Applied: ${res.foldersConfigured} folders, ${res.devicesConfigured} devices`,
		});
		spinner?.stop();
	} catch (err) {
		spinner?.error({ text: (err as Error).message });
		spinner?.stop();
		throw err;
	}
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
