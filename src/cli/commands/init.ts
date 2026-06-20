import * as os from "node:os";
import { DEFAULT_BUCKETS } from "../../core/buckets-default.js";
import { configExists, writeConfig } from "../../core/config-io.js";
import { type Config, ConfigSchema } from "../../core/config-schema.js";
import { GLOBAL_IGNORE_PATTERNS } from "../../core/ignores-default.js";
import {
	generateHome,
	isDaemonRunning,
	readIdentity,
	startDaemon,
} from "../../core/syncthing-bootstrap.js";
import { log } from "../../lib/log.js";
import { ensureSyncthing } from "../../platform/installer.js";
import { ccsyncConfigPath, syncthingHome } from "../../platform/paths.js";

export interface InitOptions {
	force?: boolean;
	machineName?: string;
}

export async function handleInit(opts: InitOptions): Promise<void> {
	log.step("Checking Syncthing installation…");
	const install = await ensureSyncthing();
	if (!install.installed) {
		log.error(install.message);
		process.exitCode = 1;
		return;
	}
	log.success(`Syncthing: ${install.path} (${install.message})`);

	const stHome = syncthingHome();
	log.step(`Bootstrapping Syncthing home at ${stHome}`);
	await generateHome(stHome);
	const identity = await readIdentity(stHome);
	log.success(`Device ID: ${identity.deviceId}`);

	const configPath = ccsyncConfigPath();
	if ((await configExists(configPath)) && !opts.force) {
		log.warn(`Config already exists at ${configPath} (use --force to overwrite)`);
	} else {
		const cfg: Config = ConfigSchema.parse({
			machineName: opts.machineName ?? os.hostname(),
			syncthing: {
				apiKey: identity.apiKey,
				guiAddress: identity.guiAddress,
				homeDir: stHome,
			},
			peers: [],
			buckets: DEFAULT_BUCKETS,
			globalIgnore: GLOBAL_IGNORE_PATTERNS,
		});
		await writeConfig(configPath, cfg);
		log.success(`Wrote config to ${configPath}`);
	}

	if (!(await isDaemonRunning(identity.guiAddress))) {
		log.step("Starting Syncthing daemon…");
		const pid = await startDaemon(stHome);
		log.success(`Daemon started (pid ${pid})`);
	} else {
		log.success("Syncthing daemon already running");
	}

	log.plain("");
	log.plain("Next steps:");
	log.plain(`  1. Run \`ccsync init\` on your other machine`);
	log.plain(`  2. On this machine: \`ccsync pair <other-device-id>\``);
	log.plain(`  3. On the other machine: \`ccsync pair ${identity.deviceId}\``);
	log.plain(`  4. \`ccsync push\` to apply config and start syncing`);
}
