import * as fs from "node:fs/promises";
import { ccsyncHome } from "../platform/paths.js";

export async function resetCcsyncState(homeDir: string = ccsyncHome()): Promise<void> {
	await fs.rm(homeDir, { recursive: true, force: true });
}
