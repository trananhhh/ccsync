import { type ApplyResult, apply } from "./applier.js";
import { readConfig, writeConfig } from "./config-io.js";
import type { Config } from "./config-schema.js";

export interface MutateDeps {
	read?: typeof readConfig;
	write?: typeof writeConfig;
	applyFn?: typeof apply;
}

export async function applyAndSave(
	configPath: string,
	mutate: (cfg: Config) => void,
	deps: MutateDeps = {},
): Promise<ApplyResult> {
	const read = deps.read ?? readConfig;
	const write = deps.write ?? writeConfig;
	const applyFn = deps.applyFn ?? apply;
	const cfg = await read(configPath);
	mutate(cfg);
	await write(configPath, cfg);
	return applyFn(cfg);
}
