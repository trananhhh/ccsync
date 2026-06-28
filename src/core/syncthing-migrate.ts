import * as path from "node:path";
import type { Config } from "./config-schema.js";

/**
 * A configured machine needs migration when its `config.yaml` still points
 * `syncthing.homeDir` at a home other than ccsync's dedicated one (i.e. a legacy
 * shared platform-default home). Runtime trusts `config.yaml`, so detection must
 * compare against the configured home — changing `syncthingHome()` alone does
 * not move an already-configured user.
 */
export function needsMigration(cfg: Config, dedicatedHome: string): boolean {
	if (!cfg.syncthing) return false;
	return path.resolve(cfg.syncthing.homeDir) !== path.resolve(dedicatedHome);
}

export interface MigrationDeps {
	/** Stop the legacy daemon (best-effort) before generating a new identity. */
	stopOldDaemon: (guiAddress: string, apiKey: string) => Promise<void>;
	/** Generate + start a fresh dedicated home, returning its new identity. */
	bootstrapFresh: (
		homeDir: string,
	) => Promise<{ apiKey: string; guiAddress: string; deviceId: string }>;
	/** Persist the rewritten config. */
	writeConfig: (cfg: Config) => Promise<void>;
}

export interface MigrationResult {
	deviceId: string;
	guiAddress: string;
	homeDir: string;
	previousHomeDir: string;
}

/**
 * Perform a clean re-pair migration onto the dedicated home: stop the legacy
 * daemon, generate a fresh identity at `dedicatedHome`, then REWRITE
 * `config.yaml`'s `syncthing.{homeDir,guiAddress,apiKey}` so every runtime path
 * (`apply`, the monitor, `release`, `ui`) points at the new home. Old keys are
 * deliberately NOT copied — the device identity changes and peers must re-pair.
 */
export async function migrateToDedicatedHome(
	cfg: Config,
	dedicatedHome: string,
	deps: MigrationDeps,
): Promise<MigrationResult> {
	if (!cfg.syncthing) {
		throw new Error("cannot migrate: config has no syncthing section");
	}
	const previousHomeDir = cfg.syncthing.homeDir;
	const { guiAddress: oldGuiAddress, apiKey: oldApiKey } = cfg.syncthing;

	await deps.stopOldDaemon(oldGuiAddress, oldApiKey);
	const fresh = await deps.bootstrapFresh(dedicatedHome);

	cfg.syncthing = {
		apiKey: fresh.apiKey,
		guiAddress: fresh.guiAddress,
		homeDir: dedicatedHome,
	};
	await deps.writeConfig(cfg);

	return {
		deviceId: fresh.deviceId,
		guiAddress: fresh.guiAddress,
		homeDir: dedicatedHome,
		previousHomeDir,
	};
}
