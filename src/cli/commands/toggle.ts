import { readConfig, writeConfig } from "../../core/config-io.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export interface ToggleOptions {
	bucket: string;
	on?: boolean;
	off?: boolean;
}

export async function handleToggle(opts: ToggleOptions): Promise<void> {
	const cfgPath = ccsyncConfigPath();
	const cfg = await readConfig(cfgPath);
	const bucket = cfg.buckets[opts.bucket];
	if (!bucket) {
		log.error(`Unknown bucket: ${opts.bucket}`);
		log.plain(`Available: ${Object.keys(cfg.buckets).join(", ")}`);
		process.exitCode = 1;
		return;
	}
	const next = opts.on ? true : opts.off ? false : !bucket.enabled;
	bucket.enabled = next;
	await writeConfig(cfgPath, cfg);
	log.success(`Bucket ${opts.bucket} ${next ? "enabled" : "disabled"}`);
	log.plain("Run `ccsync push` to apply.");
}
