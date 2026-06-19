import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Bucket } from "./config-schema.js";
import { buildStignore } from "./ignores-default.js";

export interface WriteStignoreInput {
	folderPath: string;
	bucket: Bucket;
	globalIgnore: string[];
}

export async function writeStignore(input: WriteStignoreInput): Promise<void> {
	try {
		const stat = await fs.stat(input.folderPath);
		if (!stat.isDirectory()) return;
	} catch {
		return;
	}
	const content = buildStignore(input.bucket.ignore, input.globalIgnore);
	const target = path.join(input.folderPath, ".stignore");
	await fs.writeFile(target, content, "utf-8");
}
