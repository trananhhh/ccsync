import { Command } from "commander";
import { handleClaim } from "./commands/claim.js";
import { handleConfig } from "./commands/config.js";
import { handleConflicts } from "./commands/conflicts.js";
import { handleInit } from "./commands/init.js";
import { handlePair } from "./commands/pair.js";
import { handlePush } from "./commands/push.js";
import { handleRelease } from "./commands/release.js";
import { handleStatus } from "./commands/status.js";
import { handleToggle } from "./commands/toggle.js";

const program = new Command();

program
	.name("ccsync")
	.description(
		"Sync Claude Code config, conversations, plugins and active project working trees between machines via Syncthing",
	)
	.version("0.1.0");

program
	.command("init")
	.description("Install Syncthing, bootstrap config, start daemon")
	.option("-f, --force", "overwrite existing config")
	.option("--machine-name <name>", "machine label (defaults to hostname)")
	.action(handleInit);

program
	.command("pair <deviceId>")
	.description("Add a peer device")
	.option("-n, --name <name>", "label for the peer (defaults to short device id)")
	.action((deviceId: string, opts: { name?: string }) => handlePair({ deviceId, name: opts.name }));

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
	.command("toggle <bucket>")
	.description("Enable or disable a bucket on this machine")
	.option("--on", "force enable")
	.option("--off", "force disable")
	.action((bucket: string, opts: { on?: boolean; off?: boolean }) =>
		handleToggle({ bucket, on: opts.on, off: opts.off }),
	);

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

program.parseAsync(process.argv).catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
