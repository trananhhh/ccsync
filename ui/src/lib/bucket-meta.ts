/** Short, human descriptions for each known bucket — surfaced as toggle tooltips. */
export const BUCKET_META: Record<string, string> = {
	"claude-config": "Agents, commands, hooks, rules, skills and output-styles under ~/.claude.",
	"claude-conversations": "Chat history and per-project sessions under ~/.claude/projects.",
	"claude-agent-state": "Tasks, jobs, session-env and file-history under ~/.claude.",
	"claude-worktrees": "Git worktrees Claude creates under ~/.claude/worktrees.",
	"claude-plugins": "Installed plugins under ~/.claude/plugins (cache excluded).",
	"shell-history": "Your zsh / bash history files.",
	"code-root": "A root folder of code repositories synced between machines.",
	"active-projects": "Specific project working trees you opt into individually.",
};

export function bucketDescription(name: string): string {
	return BUCKET_META[name] ?? "Synced folder.";
}
