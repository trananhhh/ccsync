import * as fs from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { readConfig } from "../../core/config-io.js";
import { findConflicts } from "../../core/conflicts-scanner.js";
import { autoMergeFile } from "../../core/history-merge.js";
import { log } from "../../lib/log.js";
import { ccsyncConfigPath } from "../../platform/paths.js";

export interface ConflictsOptions {
	auto?: boolean;
}

export async function handleConflicts(opts: ConflictsOptions): Promise<void> {
	const cfg = await readConfig(ccsyncConfigPath());
	const conflicts = await findConflicts(cfg);
	if (conflicts.length === 0) {
		log.success("No conflicts found");
		return;
	}
	log.warn(`Found ${conflicts.length} conflict file(s)`);

	let mergedHistory = 0;
	for (const c of conflicts) {
		if (c.isHistoryFile) {
			await autoMergeFile(c.original, c.path);
			mergedHistory++;
		}
	}
	if (mergedHistory > 0) log.success(`Auto-merged ${mergedHistory} shell history conflict(s)`);

	const remaining = conflicts.filter((c) => !c.isHistoryFile);
	if (remaining.length === 0) return;

	if (opts.auto) {
		log.plain("");
		log.plain("Non-history conflicts (resolve manually):");
		for (const c of remaining) log.plain(`  ${c.path}`);
		return;
	}

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		for (const c of remaining) {
			log.plain("");
			log.plain(`Conflict: ${c.path}`);
			log.plain(`Original: ${c.original}`);
			const answer = (await rl.question("[k]eep local / [t]ake remote / [s]kip? "))
				.trim()
				.toLowerCase();
			if (answer === "t") {
				await fs.rename(c.path, c.original);
				log.success(`Took remote for ${c.original}`);
			} else if (answer === "k") {
				await fs.unlink(c.path);
				log.success(`Kept local, removed conflict file`);
			} else {
				log.plain("Skipped");
			}
		}
	} finally {
		rl.close();
	}
}
