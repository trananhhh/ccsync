import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse, stringify } from "yaml";
import { type Config, ConfigSchema } from "./config-schema.js";

export async function readConfig(configPath: string): Promise<Config> {
	const raw = await fs.readFile(configPath, "utf-8");
	const parsed = parse(raw);
	return ConfigSchema.parse(parsed);
}

export async function writeConfig(configPath: string, config: Config): Promise<void> {
	const dir = path.dirname(configPath);
	await fs.mkdir(dir, { recursive: true });
	const validated = ConfigSchema.parse(config);
	const yaml = stringify(validated, { lineWidth: 0 });
	await fs.writeFile(configPath, yaml, "utf-8");
}

export async function configExists(configPath: string): Promise<boolean> {
	try {
		await fs.access(configPath);
		return true;
	} catch {
		return false;
	}
}

export function defaultConfigPath(): string {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	return path.join(home, ".ccsync", "config.yaml");
}
