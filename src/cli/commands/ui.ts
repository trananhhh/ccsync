import { configExists, readConfig } from "../../core/config-io.js";
import { ensureDaemonRunning } from "../../core/syncthing-bootstrap.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";
import { startControlService } from "../../service/runtime.js";

export async function handleUi(): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	if (!(await configExists(cfgPath))) {
		log.error("No ccsync config yet. Run `ccsync setup` first.");
		process.exitCode = 1;
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
