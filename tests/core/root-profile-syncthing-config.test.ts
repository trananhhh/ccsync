import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { Bucket } from "../../src/core/config-schema.js";
import { createRootProfile } from "../../src/core/root-profile.js";
import { buildFolders } from "../../src/core/syncthing-config.js";

const ID_A = "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA";
const ID_B = "BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB";

const enabledBucket: Bucket = {
	enabled: true,
	paths: [],
	ignore: [],
	versioning: { type: "simple", keep: 5 },
};

describe("root profile Syncthing folders", () => {
	it("uses stable folder IDs with machine-local paths", () => {
		const hostProfile = createRootProfile({
			id: "profile-a",
			canonicalRoot: "/Users/alice/work",
			localRoot: "/Users/alice/work",
			projects: [{ relativePath: "ccsync" }],
		});
		const joinedProfile = createRootProfile({
			id: hostProfile.id,
			canonicalRoot: hostProfile.canonicalRoot,
			localRoot: "/Users/bob/Coding",
			projects: hostProfile.projects,
		});

		const hostFolders = buildFolders({
			machineName: "host",
			myDeviceId: ID_A,
			peers: [{ deviceId: ID_B, name: "joined", addresses: ["dynamic"], introducer: true }],
			buckets: { "code-root": enabledBucket, "claude-conversations": enabledBucket },
			rootProfile: hostProfile,
		});
		const joinedFolders = buildFolders({
			machineName: "joined",
			myDeviceId: ID_B,
			peers: [{ deviceId: ID_A, name: "host", addresses: ["dynamic"], introducer: true }],
			buckets: { "code-root": enabledBucket, "claude-conversations": enabledBucket },
			rootProfile: joinedProfile,
		});

		expect(hostFolders.map((f) => f.id)).toEqual(joinedFolders.map((f) => f.id));
		expect(hostFolders[0].path).toBe(path.normalize("/Users/alice/work"));
		expect(joinedFolders[0].path).toBe(path.normalize("/Users/bob/Coding"));
		expect(hostFolders[1].path).toBe(
			path.normalize(`${process.env.HOME}/.claude/projects/-Users-alice-work-ccsync`),
		);
		expect(joinedFolders[1].path).toBe(
			path.normalize(`${process.env.HOME}/.claude/projects/-Users-bob-Coding-ccsync`),
		);
	});
});
