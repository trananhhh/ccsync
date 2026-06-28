import * as os from "node:os";
import { createSpinner } from "nanospinner";
import { DEFAULT_BUCKETS } from "../../core/buckets-default.js";
import { configExists, readConfig, writeConfig } from "../../core/config-io.js";
import { type Config, ConfigSchema } from "../../core/config-schema.js";
import { GLOBAL_IGNORE_PATTERNS } from "../../core/ignores-default.js";
import {
	bootstrapFreshHome,
	ensureDaemonRunning,
	fetchDeviceId,
} from "../../core/syncthing-bootstrap.js";
import { log } from "../../lib/log.js";
import { isInteractive } from "../../lib/prompt-or.js";
import { ensureSyncthing } from "../../platform/installer.js";
import { ccsyncConfigPath, syncthingHome } from "../../platform/paths.js";

export interface InitOptions {
	force?: boolean;
	machineName?: string;
}

export async function handleInit(opts: InitOptions): Promise<void> {
	const installSpinner = isInteractive()
		? createSpinner("Checking Syncthing installation…").start()
		: null;
	if (!installSpinner) log.step("Checking Syncthing installation…");
	const install = await ensureSyncthing();
	if (!install.installed) {
		installSpinner?.error({ text: install.message });
		installSpinner?.stop();
		log.error(install.message);
		process.exitCode = 1;
		return;
	}
	installSpinner?.success({ text: `Syncthing: ${install.path} (${install.message})` });
	installSpinner?.stop();

	const configPath = ccsyncConfigPath();
	if ((await configExists(configPath)) && !opts.force) {
		// Respect the existing dedicated home — never re-probe its GUI port.
		log.warn(`Config already exists at ${configPath} (use --force to overwrite)`);
		const cfg = await readConfig(configPath);
		if (!cfg.syncthing) {
			log.error("config.syncthing missing — re-run with --force to bootstrap");
			process.exitCode = 1;
			return;
		}
		await ensureDaemonRunning(cfg.syncthing.homeDir, cfg.syncthing.guiAddress);
		const deviceId = await fetchDeviceId(cfg.syncthing.guiAddress, cfg.syncthing.apiKey);
		printNextSteps(deviceId);
		return;
	}

	const stHome = syncthingHome();
	const bootstrapSpinner = isInteractive()
		? createSpinner(`Bootstrapping Syncthing home at ${stHome}`).start()
		: null;
	if (!bootstrapSpinner) log.step(`Bootstrapping Syncthing home at ${stHome}`);
	const identity = await bootstrapFreshHome(stHome);
	bootstrapSpinner?.success({ text: `Device ID: ${identity.deviceId}` });
	bootstrapSpinner?.stop();

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
	log.success("Syncthing daemon running");

	printNextSteps(identity.deviceId);
}

function printNextSteps(deviceId: string): void {
	log.plain("");
	log.plain("Next steps:");
	log.plain(`  1. Run \`ccsync init\` on your other machine`);
	log.plain(`  2. On this machine: \`ccsync pair <other-device-id>\``);
	log.plain(`  3. On the other machine: \`ccsync pair ${deviceId}\``);
	log.plain(`  4. \`ccsync push\` to apply config and start syncing`);
}
