import { configExists, readConfig } from "../../core/config-io.js";
import { ensureDaemonRunning } from "../../core/syncthing-bootstrap.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";
import {
	openBrowser,
	pingService,
	readServiceUrl,
	startControlService,
} from "../../service/runtime.js";

export async function handleUi(): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	if (!(await configExists(cfgPath))) {
		log.error("No ccsync config yet. Run `ccsync setup` first.");
		process.exitCode = 1;
		return;
	}

	// Reuse an already-running service so a second `ccsync ui` does not spawn a
	// duplicate server (and, from Phase 2, a duplicate Syncthing events loop).
	const existing = await readServiceUrl();
	if (existing && (await pingService(existing))) {
		openBrowser(existing);
		log.success(`ccsync dashboard: ${existing}`);
		log.plain("Reused the running dashboard service.");
		return;
	}

	const cfg = await readConfig(cfgPath);
	if (cfg.syncthing) {
		await ensureDaemonRunning(cfg.syncthing.homeDir, cfg.syncthing.guiAddress);
	}
	const { url } = await startControlService({ open: true });
	log.success(`ccsync dashboard: ${url}`);
	log.plain("Press Ctrl+C to stop the dashboard (sync keeps running).");
}
