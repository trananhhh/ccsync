import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readCcsyncignore } from "./ccsyncignore.js";
import type { Bucket } from "./config-schema.js";
import { buildStignore } from "./ignores-default.js";

export interface WriteStignoreInput {
	folderPath: string;
	bucket: Bucket;
	globalIgnore: string[];
	codeFolderRoot?: string;
}

export interface WriteStignoreResult {
	written: boolean;
	projectIgnore: string[];
}

export async function writeStignore(input: WriteStignoreInput): Promise<WriteStignoreResult> {
	try {
		const stat = await fs.stat(input.folderPath);
		if (!stat.isDirectory()) return { written: false, projectIgnore: [] };
	} catch {
		return { written: false, projectIgnore: [] };
	}

	let projectIgnore: string[] = [];
	if (input.codeFolderRoot) {
		try {
			projectIgnore = await readCcsyncignore(input.codeFolderRoot);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				throw err;
			}
		}
	}

	const content = buildStignore(input.bucket.ignore, input.globalIgnore, projectIgnore);
	const target = path.join(input.folderPath, ".stignore");
	await fs.writeFile(target, content, "utf-8");
	return { written: true, projectIgnore };
}
