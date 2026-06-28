import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	CCSYNC_FOLDER_PREFIX,
	collectStignoreTargets,
	isCcsyncFolder,
	mergeDevices,
	mergeFolders,
} from "../../src/core/applier.js";
import type { Config } from "../../src/core/config-schema.js";
import { createRootProfile } from "../../src/core/root-profile.js";
import type { SyncthingDevice, SyncthingFolder } from "../../src/core/syncthing-api.js";

function folder(id: string): SyncthingFolder {
	return { id, label: id, path: `/tmp/${id}`, type: "sendreceive", devices: [] };
}

function device(deviceID: string): SyncthingDevice {
	return { deviceID, name: deviceID, addresses: ["dynamic"], compression: "metadata" };
}

describe("mergeFolders", () => {
	it("keeps foreign folders and replaces only ccsync-owned ones", () => {
		const remote = [folder("user-photos"), folder("ccsync-claude-config-0")];
		const owned = [folder("ccsync-claude-config-0"), folder("ccsync-root-abc")];
		const merged = mergeFolders(remote, owned);
		const ids = merged.map((f) => f.id).sort();
		expect(ids).toEqual(["ccsync-claude-config-0", "ccsync-root-abc", "user-photos"]);
	});

	it("drops ccsync folders that are no longer owned", () => {
		const remote = [folder("ccsync-stale-0"), folder("keep-me")];
		const merged = mergeFolders(remote, []);
		expect(merged.map((f) => f.id)).toEqual(["keep-me"]);
	});

	it("recognises every ccsync folder id prefix", () => {
		expect(isCcsyncFolder("ccsync-conv-x")).toBe(true);
		expect(isCcsyncFolder("user-photos")).toBe(false);
		expect(CCSYNC_FOLDER_PREFIX).toBe("ccsync-");
	});
});

describe("mergeDevices", () => {
	it("pauses owned devices when metered is on", () => {
		const owned = [device("SELF"), device("PEER")];
		const merged = mergeDevices(owned, owned, true);
		expect(merged.every((d) => d.paused === true)).toBe(true);
	});

	it("unpauses owned devices when metered is off", () => {
		const owned = [device("SELF"), device("PEER")];
		const remote = [
			{ ...device("SELF"), paused: true },
			{ ...device("PEER"), paused: true },
		];
		const merged = mergeDevices(remote, owned, false);
		expect(merged.every((d) => d.paused === false)).toBe(true);
	});

	it("preserves foreign devices unchanged", () => {
		const owned = [device("SELF"), device("PEER")];
		const foreign = { ...device("FOREIGN"), paused: true, introducer: true };
		const remote = [device("SELF"), foreign];
		const merged = mergeDevices(remote, owned, true);
		const kept = merged.find((d) => d.deviceID === "FOREIGN");
		expect(kept).toEqual(foreign);
		for (const d of merged) {
			if (d.deviceID !== "FOREIGN") expect(d.paused).toBe(true);
		}
	});
});

describe("collectStignoreTargets", () => {
	it("includes mapped conversation folders instead of the raw legacy conversations root", () => {
		const cfg: Config = {
			machineName: "macbook",
			peers: [],
			globalIgnore: [],
			metered: false,
			rootProfile: createRootProfile({
				id: "profile-a",
				canonicalRoot: "/Users/alice/work",
				localRoot: "/Users/alice/work",
				projects: [{ relativePath: "ccsync" }],
			}),
			buckets: {
				"code-root": {
					enabled: true,
					paths: ["/Users/alice/work"],
					ignore: ["node_modules"],
					versioning: { type: "staggered", keep: 30 },
				},
				"claude-conversations": {
					enabled: true,
					paths: ["/Users/alice/.claude/projects"],
					ignore: ["*.tmp"],
					versioning: { type: "simple", keep: 5 },
				},
			},
		};

		const targets = collectStignoreTargets(cfg);

		expect(targets.map((target) => target.folderPath)).toEqual([
			path.normalize("/Users/alice/work"),
			path.normalize(`${process.env.HOME}/.claude/projects/-Users-alice-work-ccsync`),
		]);
		expect(targets[1].bucket.ignore).toEqual(["*.tmp"]);
	});

	it("tags code-root targets with codeFolderRoot so writer can read .ccsyncignore", () => {
		const cfg: Config = {
			machineName: "macbook",
			peers: [],
			globalIgnore: [],
			metered: false,
			buckets: {
				"code-root": {
					enabled: true,
					paths: [path.normalize("/Users/alice/work/project-a")],
					ignore: [],
					versioning: { type: "simple", keep: 5 },
				},
				"claude-config": {
					enabled: true,
					paths: [path.normalize("/Users/alice/.claude")],
					ignore: [],
					versioning: { type: "simple", keep: 5 },
				},
			},
		};

		const targets = collectStignoreTargets(cfg);
		const codeRootTarget = targets.find((t) => t.bucket === cfg.buckets["code-root"]);
		const claudeConfigTarget = targets.find((t) => t.bucket === cfg.buckets["claude-config"]);

		expect(codeRootTarget?.codeFolderRoot).toBe(codeRootTarget?.folderPath);
		expect(claudeConfigTarget?.codeFolderRoot).toBeUndefined();
	});

	it("skips legacy single-file paths when collecting .stignore targets", () => {
		const cfg: Config = {
			machineName: "macbook",
			peers: [],
			globalIgnore: [],
			metered: false,
			buckets: {
				"claude-config": {
					enabled: true,
					paths: [
						path.normalize(`${process.env.HOME}/.claude/agents`),
						path.normalize(`${process.env.HOME}/.claude/settings.json`),
						path.normalize(`${process.env.HOME}/.claude/CLAUDE.md`),
					],
					ignore: [],
					versioning: { type: "simple", keep: 5 },
				},
			},
		};

		expect(collectStignoreTargets(cfg).map((target) => target.folderPath)).toEqual([
			path.normalize(`${process.env.HOME}/.claude/agents`),
		]);
	});
});
