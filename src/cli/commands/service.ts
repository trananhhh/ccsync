import { readConfig } from "../../core/config-io.js";
import { ensureDaemonRunning, stopDaemon } from "../../core/syncthing-bootstrap.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export async function handleServiceStart(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	if (!cfg.syncthing) {
		log.error("config.syncthing not initialised — run `ccsync setup` first.");
		process.exitCode = 1;
		return;
	}
	const state = await ensureDaemonRunning(cfg.syncthing.homeDir, cfg.syncthing.guiAddress);
	log.success(`Syncthing daemon ${state}.`);
}

export async function handleServiceStop(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	if (!cfg.syncthing) {
		log.error("config.syncthing not initialised.");
		process.exitCode = 1;
		return;
	}
	const result = await stopDaemon(cfg.syncthing.guiAddress, cfg.syncthing.apiKey);
	log.success(`Syncthing daemon ${result}.`);
}
