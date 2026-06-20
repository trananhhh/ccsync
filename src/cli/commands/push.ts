import { apply } from "../../core/applier.js";
import { readConfig } from "../../core/config-io.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export async function handlePush(): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	log.step("Applying config to Syncthing…");
	const res = await apply(cfg);
	log.success(
		`Applied: ${res.foldersConfigured} folders, ${res.devicesConfigured} devices, ${res.stignoresWritten} .stignore files written`,
	);
}
