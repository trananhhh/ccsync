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

	// Reuse an already-running service so a second `ccsync ui` does not spawn a
	// duplicate server (and, from Phase 2, a duplicate Syncthing events loop).
	const existing = await readServiceUrl();
	if (existing && (await pingService(existing))) {
		openBrowser(existing);
		log.success(`ccsync dashboard: ${existing}`);
		log.plain("Reused the running dashboard service.");
		return;
	}

	// A fresh machine has no config yet — the browser onboarding wizard creates it.
	// The control service runs fine without a config, so start it and let the
	// wizard drive setup. When a config already exists, make sure the daemon is up.
	if (await configExists(cfgPath)) {
		const cfg = await readConfig(cfgPath);
		if (cfg.syncthing) {
			await ensureDaemonRunning(cfg.syncthing.homeDir, cfg.syncthing.guiAddress);
		}
	} else {
		log.step("No config yet — opening the setup wizard in your browser…");
	}
	const { url } = await startControlService({ open: true });
	log.success(`ccsync dashboard: ${url}`);
	log.plain("Press Ctrl+C to stop the dashboard (sync keeps running).");
}
