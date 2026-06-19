import { spawn } from "node:child_process";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export interface ConfigOptions {
	path?: boolean;
}

export async function handleConfig(opts: ConfigOptions): Promise<void> {
	const p = ccsyncConfigPath();
	if (opts.path) {
		log.plain(p);
		return;
	}
	const editor = process.env.EDITOR || process.env.VISUAL || "vi";
	await new Promise<void>((resolve, reject) => {
		const child = spawn(editor, [p], { stdio: "inherit" });
		child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`editor exit ${code}`))));
		child.on("error", reject);
	});
}
