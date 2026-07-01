import { readConfig } from "../../core/config-io.js";
import { applyAndSave } from "../../core/mutate.js";
import { setOwnedDevicesPaused } from "../../core/sync-control.js";
import { SyncthingApi } from "../../core/syncthing-api.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";
import { ownedDeviceIds } from "../../service/on-demand.js";

/**
 * `ccsync mode` (no arg prints the current mode) / `ccsync mode realtime|manual`.
 * Switching to manual pauses owned devices so nothing transfers until an explicit
 * `ccsync sync`. Switching to realtime resumes them.
 */
export async function handleMode(mode?: string): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	if (!cfg.syncthing) {
		log.error("config.syncthing missing — run `ccsync setup` first");
		process.exitCode = 1;
		return;
	}
	if (!mode) {
		log.info(`Sync mode: ${cfg.syncMode ?? "realtime"}`);
		return;
	}
	if (mode !== "realtime" && mode !== "manual") {
		log.error('mode must be "realtime" or "manual"');
		process.exitCode = 1;
		return;
	}
	const next: "realtime" | "manual" = mode;

	const api = new SyncthingApi({
		apiKey: cfg.syncthing.apiKey,
		guiAddress: cfg.syncthing.guiAddress,
	});
	if (next === "realtime") {
		// Leaving manual mode: explicitly resume owned devices. apply() now preserves
		// a device's pause state, so without this they would stay paused.
		const sys = await api.systemStatus();
		const ownedIds = ownedDeviceIds(sys.myID, cfg.peers);
		await api.putConfig(setOwnedDevicesPaused(await api.getConfig(), ownedIds, false));
	}
	await applyAndSave(
		cfgPath,
		(c) => {
			c.syncMode = next;
		},
		{ api },
	);
	if (next === "manual") {
		log.success("Sync mode: manual — transfers paused. Run `ccsync sync` to sync on demand.");
	} else {
		log.success("Sync mode: realtime — transfers resumed.");
	}
}
