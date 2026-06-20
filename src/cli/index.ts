import { Command } from "commander";
import { handleAccept } from "./commands/accept.js";
import { handleClaim } from "./commands/claim.js";
import { handleConfig } from "./commands/config.js";
import { handleConflicts } from "./commands/conflicts.js";
import { handleDiagnose } from "./commands/diagnose.js";
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
import { handleSetup } from "./commands/setup.js";
import { handleShare } from "./commands/share.js";
import { handleStatus } from "./commands/status.js";
import { handleSync } from "./commands/sync.js";
import { handleToggle } from "./commands/toggle.js";
import { runInteractive } from "./interactive.js";
import { CLI_VERSION } from "./version.js";

const program = new Command();

program
	.name("ccsync")
	.description(
		"One-command sync of Claude Code config, conversations, and project working trees between machines.\n\nRun `ccsync` with no arguments — it figures out what to do.",
	)
	.version(CLI_VERSION)
	.option("--fresh", "reset local ccsync config and run setup again")
	.action((opts: { fresh?: boolean }) => {
		if (opts.fresh) return handleSetup({ fresh: true });
		return runInteractive();
	});

program
	.command("setup [token]")
	.description("Install Syncthing, bootstrap config, optionally join via invite token")
	.option("--machine-name <name>", "machine label (defaults to hostname)")
	.option("--fresh", "reset local ccsync config before setup")
	.action((token: string | undefined, opts: { machineName?: string; fresh?: boolean }) =>
		handleSetup({ token, machineName: opts.machineName, fresh: opts.fresh }),
	);

program
	.command("status")
	.description("Show sync status across all buckets and peers")
	.option("-v, --verbose", "include per-folder details")
	.action(handleStatus);

program
	.command("diagnose")
	.description("Deep dump of peer connections + folder state for debugging")
	.action(handleDiagnose);

program
	.command("conflicts")
	.description("Auto-merge shell history conflicts, prompt to resolve the rest")
	.option("--auto", "auto-merge shell history conflicts, list the rest")
	.action(handleConflicts);

program
	.command("release")
	.description("Wait until 100% in-sync, then it's safe to switch machines")
	.option("--timeout <seconds>", "max seconds to wait (default 300)", "300")
	.action(handleRelease);

const advanced = program.command("advanced").description("Advanced / low-level commands");

advanced
	.command("init")
	.description("Bootstrap config (use `setup` instead)")
	.option("-f, --force", "overwrite existing config")
	.option("--machine-name <name>", "machine label (defaults to hostname)")
	.action(handleInit);

advanced.command("id").description("Print this machine's Syncthing device ID").action(handleId);

advanced
	.command("share")
	.description("Print an invite token (use `setup` on the new machine to consume)")
	.option("--no-introducer", "do not mark this machine as introducer in the invite")
	.action((opts: { noIntroducer?: boolean }) => handleShare(opts));

advanced
	.command("join <token>")
	.description("Pair using an invite token (use `setup <token>` instead)")
	.action((token: string) => handleJoin({ token }));

advanced
	.command("accept [deviceId]")
	.description("Accept a pending device (the main `ccsync` flow handles this for you)")
	.option("--all", "accept every pending device without prompting")
	.action((deviceId: string | undefined, opts: { all?: boolean }) =>
		handleAccept({ deviceId, all: opts.all }),
	);

advanced
	.command("pair <deviceId>")
	.description("Add a peer device by ID")
	.option("-n, --name <name>", "label for the peer (defaults to short device id)")
	.option("--introducer", "mark this peer as an introducer")
	.action((deviceId: string, opts: { name?: string; introducer?: boolean }) =>
		handlePair({ deviceId, name: opts.name, introducer: opts.introducer }),
	);

advanced
	.command("push")
	.description("Apply local YAML config to Syncthing and trigger rescan")
	.action(handlePush);

advanced
	.command("sync")
	.description("Force an immediate rescan on every bucket (pull-like)")
	.action(handleSync);

advanced
	.command("toggle <bucket>")
	.description("Enable or disable a bucket on this machine")
	.option("--on", "force enable")
	.option("--off", "force disable")
	.action((bucket: string, opts: { on?: boolean; off?: boolean }) =>
		handleToggle({ bucket, on: opts.on, off: opts.off }),
	);

const project = advanced.command("project").description("Manage the active-projects bucket");
project.command("add <path>").action((p: string) => handleProjectAdd(p));
project.command("remove <path>").action((p: string) => handleProjectRemove(p));
project.command("list").action(handleProjectList);
project
	.command("detect")
	.option("-y, --yes", "auto-add every suggestion")
	.action((opts: { yes?: boolean }) => handleProjectDetect(opts));

advanced
	.command("config")
	.description("Open config in $EDITOR")
	.option("--path", "print config path and exit")
	.action(handleConfig);

advanced
	.command("claim")
	.description("Mark this machine active (for shell-history coordination)")
	.action(handleClaim);

program.parseAsync(process.argv).catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
