import { apply } from "../../core/applier.js";
import { readConfig } from "../../core/config-io.js";
import { writeMachineInfo } from "../../core/machine-registry.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export async function handlePush(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	log.step("Applying config to Syncthing…");
	const res = await apply(cfg);
	// Publish this machine's identity/code-roots into the synced registry so the
	// other machine can show "this machine's code root is X". Non-critical.
	try {
		await writeMachineInfo(cfg, res.myDeviceId);
	} catch {
		// registry is visibility-only data
	}
	log.success(
		`Applied: ${res.foldersConfigured} folders, ${res.devicesConfigured} devices, ${res.stignoresWritten} .stignore files written`,
	);
}
