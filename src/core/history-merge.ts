import * as fs from "node:fs/promises";
import * as path from "node:path";

export type HistoryFormat = "zsh-extended" | "bash" | "jsonl";

export function detectFormat(filePath: string): HistoryFormat {
	const base = path.basename(filePath);
	if (base.endsWith(".jsonl")) return "jsonl";
	if (base.includes("zsh")) return "zsh-extended";
	return "bash";
}

export interface HistoryEntry {
	ts: number;
	raw: string;
}

export function parse(content: string, format: HistoryFormat): HistoryEntry[] {
	const lines = content.split(/\r?\n/);
	const out: HistoryEntry[] = [];
	for (const line of lines) {
		if (!line.trim()) continue;
		out.push({ ts: extractTs(line, format), raw: line });
	}
	return out;
}

function extractTs(line: string, format: HistoryFormat): number {
	if (format === "zsh-extended") {
		const m = line.match(/^:\s+(\d+):/);
		return m ? Number.parseInt(m[1], 10) : 0;
	}
	if (format === "jsonl") {
		try {
			const obj = JSON.parse(line);
			const ts = obj.timestamp ?? obj.ts ?? obj.time;
			if (typeof ts === "number") return ts;
			if (typeof ts === "string") return Date.parse(ts) || 0;
		} catch {}
		return 0;
	}
	return 0;
}

export function merge(a: HistoryEntry[], b: HistoryEntry[]): HistoryEntry[] {
	const seen = new Set<string>();
	const all = [...a, ...b].filter((e) => {
		if (seen.has(e.raw)) return false;
		seen.add(e.raw);
		return true;
	});
	all.sort((x, y) => {
		if (x.ts !== y.ts) return x.ts - y.ts;
		return x.raw.localeCompare(y.raw);
	});
	return all;
}

export function serialize(entries: HistoryEntry[]): string {
	return entries.map((e) => e.raw).join("\n") + (entries.length > 0 ? "\n" : "");
}

export async function autoMergeFile(originalPath: string, conflictPath: string): Promise<void> {
	const format = detectFormat(originalPath);
	const [origContent, confContent] = await Promise.all([
		fs.readFile(originalPath, "utf-8").catch(() => ""),
		fs.readFile(conflictPath, "utf-8").catch(() => ""),
	]);
	const merged = merge(parse(origContent, format), parse(confContent, format));
	await fs.writeFile(originalPath, serialize(merged), "utf-8");
	await fs.unlink(conflictPath);
}
