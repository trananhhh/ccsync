import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ccsyncHome } from "../platform/paths.js";

export async function ensureServiceToken(homeDir: string = ccsyncHome()): Promise<string> {
	const tokenPath = path.join(homeDir, "service-token");
	try {
		const existing = (await fs.readFile(tokenPath, "utf-8")).trim();
		if (existing) return existing;
	} catch {
		// not created yet
	}
	const token = randomBytes(24).toString("hex");
	await fs.mkdir(homeDir, { recursive: true });
	await fs.writeFile(tokenPath, token, { mode: 0o600 });
	return token;
}
