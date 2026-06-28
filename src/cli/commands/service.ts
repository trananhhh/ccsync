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
	if (result === "stopped") {
		log.success("Syncthing daemon stopped.");
	} else if (result === "not-running") {
		log.info("Syncthing daemon was not running.");
	} else {
		log.warn("Syncthing daemon did not stop within the timeout — it may still be running.");
		process.exitCode = 1;
	}
}
