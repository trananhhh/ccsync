import { readConfig } from "../../core/config-io.js";
import { encodeInvite } from "../../core/invite-token.js";
import { SyncthingApi } from "../../core/syncthing-api.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export interface ShareOptions {
	noIntroducer?: boolean;
}

export async function handleShare(opts: ShareOptions): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	if (!cfg.syncthing) {
		log.error("config.syncthing missing — run `ccsync init` first");
		process.exitCode = 1;
		return;
	}
	const api = new SyncthingApi({
		apiKey: cfg.syncthing.apiKey,
		guiAddress: cfg.syncthing.guiAddress,
	});
	const sys = await api.systemStatus();
	const token = encodeInvite({
		deviceId: sys.myID,
		name: cfg.machineName,
		introducer: !opts.noIntroducer,
	});

	log.success(`Share this code with the new machine:`);
	log.plain("");
	log.plain(`  ${token}`);
	log.plain("");
	log.plain("On the new machine, run:");
	log.plain(`  ccsync join ${token}`);
	log.plain("");
	log.plain("Then run `ccsync accept` on THIS machine to admit the new device.");
}
