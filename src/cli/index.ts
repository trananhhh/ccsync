import { Command } from "commander";
import { handleAccept } from "./commands/accept.js";
import { handleClaim } from "./commands/claim.js";
import { handleConfig } from "./commands/config.js";
import { handleConflicts } from "./commands/conflicts.js";
import { handleId } from "./commands/id.js";
import { handleInit } from "./commands/init.js";
import { handleJoin } from "./commands/join.js";
import { handlePair } from "./commands/pair.js";
import {
	handleProjectAdd,
	handleProjectDetect,
	handleProjectList,
	handleProjectRemove,
} from "./commands/project.js";
import { handlePush } from "./commands/push.js";
import { handleRelease } from "./commands/release.js";
import { handleShare } from "./commands/share.js";
import { handleStatus } from "./commands/status.js";
import { handleSync } from "./commands/sync.js";
import { handleToggle } from "./commands/toggle.js";
import { runInteractive } from "./interactive.js";

const program = new Command();

program
	.name("ccsync")
	.description(
		"Sync Claude Code config, conversations, plugins and active project working trees between machines via Syncthing",
	)
	.version("0.3.0");

program
	.command("init")
	.description("Install Syncthing, bootstrap config, start daemon")
	.option("-f, --force", "overwrite existing config")
	.option("--machine-name <name>", "machine label (defaults to hostname)")
	.action(handleInit);

program.command("id").description("Print this machine's Syncthing device ID").action(handleId);

program
	.command("share")
	.description("Print an invite token for a new machine to join via `ccsync join`")
	.option("--no-introducer", "do not mark this machine as introducer in the invite")
	.action((opts: { noIntroducer?: boolean }) => handleShare(opts));

program
	.command("join <token>")
	.description("Join a network using an invite token from `ccsync share`")
	.action((token: string) => handleJoin({ token }));

program
	.command("accept [deviceId]")
	.description("Accept a pending device (interactive if no ID given)")
	.option("--all", "accept every pending device without prompting")
	.action((deviceId: string | undefined, opts: { all?: boolean }) =>
		handleAccept({ deviceId, all: opts.all }),
	);

program
	.command("pair <deviceId>")
	.description("Add a peer device by ID (low-level; prefer share/join)")
	.option("-n, --name <name>", "label for the peer (defaults to short device id)")
	.option("--introducer", "mark this peer as an introducer")
	.action((deviceId: string, opts: { name?: string; introducer?: boolean }) =>
		handlePair({ deviceId, name: opts.name, introducer: opts.introducer }),
	);

program
	.command("status")
	.description("Show sync status across all buckets and peers")
	.option("-v, --verbose", "include per-folder details")
	.action(handleStatus);

program
	.command("push")
	.description("Apply local config to Syncthing and trigger rescan")
	.action(handlePush);

program
	.command("sync")
	.description("Force an immediate rescan on every bucket (pull-like)")
	.action(handleSync);

program
	.command("toggle <bucket>")
	.description("Enable or disable a bucket on this machine")
	.option("--on", "force enable")
	.option("--off", "force disable")
	.action((bucket: string, opts: { on?: boolean; off?: boolean }) =>
		handleToggle({ bucket, on: opts.on, off: opts.off }),
	);

const project = program.command("project").description("Manage the active-projects bucket");
project
	.command("add <path>")
	.description("Track a project working tree")
	.action((p: string) => handleProjectAdd(p));
project
	.command("remove <path>")
	.description("Stop tracking a project")
	.action((p: string) => handleProjectRemove(p));
project.command("list").description("List tracked projects").action(handleProjectList);
project
	.command("detect")
	.description("Suggest projects from ~/.claude/projects/")
	.option("-y, --yes", "auto-add every suggestion")
	.action((opts: { yes?: boolean }) => handleProjectDetect(opts));

program
	.command("config")
	.description("Open config in $EDITOR")
	.option("--path", "print config path and exit")
	.action(handleConfig);

program
	.command("conflicts")
	.description("List and resolve Syncthing .sync-conflict-* files")
	.option("--auto", "auto-merge shell history conflicts, list the rest")
	.action(handleConflicts);

program
	.command("claim")
	.description("Mark this machine active (for shell-history coordination)")
	.action(handleClaim);

program
	.command("release")
	.description("Wait until 100% in-sync, then release active flag")
	.option("--timeout <seconds>", "max seconds to wait (default 300)", "300")
	.action(handleRelease);

if (process.argv.length <= 2) {
	runInteractive().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
} else {
	program.parseAsync(process.argv).catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}
