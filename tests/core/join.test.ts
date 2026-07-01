import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApplyResult } from "../../src/core/applier.js";
import type { Config } from "../../src/core/config-schema.js";
import { encodeInvite } from "../../src/core/invite-token.js";
import { joinWithToken } from "../../src/core/join.js";

const HOST_ID = "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA";

function baseConfig(): Config {
	return {
		machineName: "joiner",
		syncthing: { apiKey: "k", guiAddress: "127.0.0.1:1", homeDir: "/tmp/st" },
		peers: [],
		buckets: {},
		globalIgnore: [],
		metered: false,
	} as Config;
}

function deps(saved: { cfg: Config }) {
	const applied: Config[] = [];
	return {
		applied,
		opts: {
			configPath: "/tmp/ccsync-join-test.yaml",
			readConfig: async () => saved.cfg,
			writeConfig: async (_p: string, c: Config) => {
				saved.cfg = c;
			},
			apply: async (c: Config): Promise<ApplyResult> => {
				applied.push(c);
				return {
					foldersConfigured: 2,
					devicesConfigured: 1,
					stignoresWritten: 0,
					myDeviceId: "test-device",
				};
			},
			ensureSyncthing: async () => ({ installed: true, path: "/usr/bin/syncthing", message: "ok" }),
			ensureDaemonRunning: async () => "already-running" as const,
		},
	};
}

describe("joinWithToken", () => {
	let tmp: string | undefined;

	afterEach(async () => {
		if (tmp) {
			await fs.rm(tmp, { recursive: true, force: true });
			tmp = undefined;
		}
		vi.restoreAllMocks();
	});

	it("reconstructs the rootProfile from the invite using the supplied localRoot (no prompt)", async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-join-"));
		const localRoot = path.join(tmp, "code");
		const token = encodeInvite({
			deviceId: HOST_ID,
			name: "macbook",
			introducer: true,
			rootProfile: {
				id: "profile-abc",
				canonicalRoot: "/Users/host/code",
				codeFolders: [{ relativePath: "app" }, { relativePath: "lib" }],
				projects: [],
				conversations: [],
			},
		});
		const saved = { cfg: baseConfig() };
		const d = deps(saved);

		const result = await joinWithToken(token, { localRoot, ...d.opts });

		expect(result.rootProfileMapped).toBe(true);
		expect(result.peerAdded).toBe(true);
		expect(result.localRoot).toBe(localRoot);
		// rootProfile reconstructed from the invite, mapped onto the local root.
		expect(saved.cfg.rootProfile?.id).toBe("profile-abc");
		expect(saved.cfg.rootProfile?.canonicalRoot).toBe("/Users/host/code");
		expect(saved.cfg.rootProfile?.localRoot).toBe(localRoot);
		expect(saved.cfg.rootProfile?.codeFolders.map((f) => f.relativePath)).toEqual(["app", "lib"]);
		// code-root bucket points at the picked folders under the local root.
		expect(saved.cfg.buckets["code-root"]?.paths).toEqual([
			path.join(localRoot, "app"),
			path.join(localRoot, "lib"),
		]);
		// peer added + config applied.
		expect(saved.cfg.peers[0].deviceId).toBe(HOST_ID);
		expect(d.applied).toHaveLength(1);
	});

	it("throws (never prompts/hangs) when the invite carries a code root but no localRoot is supplied", async () => {
		const token = encodeInvite({
			deviceId: HOST_ID,
			name: "macbook",
			introducer: true,
			rootProfile: {
				id: "profile-abc",
				canonicalRoot: "/Users/host/code",
				projects: [],
				conversations: [],
			},
		});
		const saved = { cfg: baseConfig() };
		const d = deps(saved);

		await expect(joinWithToken(token, d.opts)).rejects.toThrow(/code root/i);
		expect(d.applied).toHaveLength(0);
	});

	it("adds the inviter as a peer for a plain invite (no rootProfile)", async () => {
		const token = encodeInvite({ deviceId: HOST_ID, name: "macbook", introducer: false });
		const saved = { cfg: baseConfig() };
		const d = deps(saved);

		const result = await joinWithToken(token, d.opts);

		expect(result.rootProfileMapped).toBe(false);
		expect(result.peerAdded).toBe(true);
		expect(saved.cfg.peers[0].name).toBe("macbook");
		expect(d.applied).toHaveLength(1);
	});
});
