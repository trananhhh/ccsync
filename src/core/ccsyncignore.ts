import * as fs from "node:fs/promises";

export async function readCcsyncignore(folderPath: string): Promise<string[]> {
	let content: string;
	try {
		content = await fs.readFile(`${folderPath}/.ccsyncignore`, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw err;
	}
	return parseCcsyncignore(content);
}

export function parseCcsyncignore(content: string): string[] {
	return content
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0 && !line.startsWith("//"));
}

export function findUnanchoredNegations(lines: string[]): string[] {
	return lines.filter((line) => {
		if (!line.startsWith("!")) return false;
		const after = line.slice(1).trimStart();
		return after.length > 0 && !after.startsWith("/");
	});
}

export function usesBackslash(lines: string[]): boolean {
	return lines.some((line) => line.includes("\\"));
}
