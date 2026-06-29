import * as os from "node:os";
import { ensureSyncthing as defaultEnsureSyncthing } from "../platform/installer.js";
import { syncthingHome as defaultSyncthingHome } from "../platform/paths.js";
import { DEFAULT_BUCKETS } from "./buckets-default.js";
import { type Config, ConfigSchema } from "./config-schema.js";
import { GLOBAL_IGNORE_PATTERNS } from "./ignores-default.js";
import { bootstrapFreshHome as defaultBootstrapFreshHome } from "./syncthing-bootstrap.js";

export interface BootstrapFirstMachineOptions {
	machineName?: string;
	ensureSyncthing?: typeof defaultEnsureSyncthing;
	bootstrapFreshHome?: typeof defaultBootstrapFreshHome;
	syncthingHome?: typeof defaultSyncthingHome;
}

/**
 * Stand up a brand-new ccsync identity: ensure Syncthing is installed, bootstrap
 * a fresh dedicated home (its own port + device id, started daemon), and return a
 * base `Config` with default buckets and no peers. This is the single bootstrap
 * cut point shared by both create-first (`/api/setup/init`) and a fresh-machine
 * browser join (`/api/pair/join`), so the two paths converge on one config shape.
 *
 * The caller persists the returned config and decides what to layer on top
 * (a code-root profile, the inviting peer, etc.). Call only when there is no
 * existing `config.syncthing` — bootstrapping twice would orphan a daemon.
 */
export async function bootstrapFirstMachine(
	opts: BootstrapFirstMachineOptions = {},
): Promise<Config> {
	const ensureSyncthing = opts.ensureSyncthing ?? defaultEnsureSyncthing;
	const bootstrapFreshHome = opts.bootstrapFreshHome ?? defaultBootstrapFreshHome;
	const stHome = (opts.syncthingHome ?? defaultSyncthingHome)();

	const install = await ensureSyncthing();
	if (!install.installed) throw new Error(install.message);

	const identity = await bootstrapFreshHome(stHome);
	return ConfigSchema.parse({
		machineName: opts.machineName || os.hostname(),
		syncthing: { apiKey: identity.apiKey, guiAddress: identity.guiAddress, homeDir: stHome },
		peers: [],
		buckets: DEFAULT_BUCKETS,
		globalIgnore: GLOBAL_IGNORE_PATTERNS,
	});
}
