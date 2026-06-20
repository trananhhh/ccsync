import * as fs from "node:fs/promises";
import * as path from "node:path";
import { claudeHome } from "../platform/paths.js";

export interface DetectedProject {
	projectPath: string;
	exists: boolean;
	encodedDir: string;
}

export function decodeProjectDir(encoded: string): string {
	if (!encoded.startsWith("-")) return encoded;
	return `/${encoded.slice(1).replaceAll("-", "/")}`;
}

export async function listClaudeProjects(): Promise<DetectedProject[]> {
	const root = path.join(claudeHome(), "projects");
	let entries: string[] = [];
	try {
		entries = (await fs.readdir(root, { withFileTypes: true }))
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
	} catch {
		return [];
	}
	const out: DetectedProject[] = [];
	for (const name of entries) {
		const projectPath = decodeProjectDir(name);
		const exists = await pathExists(projectPath);
		out.push({ projectPath, exists, encodedDir: path.join(root, name) });
	}
	return out;
}

async function pathExists(p: string): Promise<boolean> {
	try {
		const stat = await fs.stat(p);
		return stat.isDirectory();
	} catch {
		return false;
	}
}
