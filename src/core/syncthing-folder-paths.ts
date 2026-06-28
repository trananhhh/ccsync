import * as os from "node:os";
import * as path from "node:path";

export function isLegacySingleFileBucketPath(folderPath: string): boolean {
	const home = os.homedir();
	const claude = path.join(home, ".claude");
	const normalized = path.normalize(folderPath);
	const legacyFiles = new Set([
		path.join(claude, "settings.json"),
		path.join(claude, "CLAUDE.md"),
		path.join(claude, "keybindings.json"),
		path.join(claude, "history.jsonl"),
		path.join(home, ".zsh_history"),
		path.join(home, ".bash_history"),
	]);
	return legacyFiles.has(normalized);
}
