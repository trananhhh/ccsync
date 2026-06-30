import { describe, expect, it } from "vitest";
import type { Config } from "../../src/core/config-schema.js";
import {
	buildMachineInfo,
	REGISTRY_FOLDER_ID,
	registryFolder,
} from "../../src/core/machine-registry.js";
import { createRootProfile } from "../../src/core/root-profile.js";

function baseConfig(over: Partial<Config> = {}): Config {
	return {
		machineName: "macbook",
		peers: [],
		globalIgnore: [],
		metered: false,
		buckets: {},
		...over,
	};
}

describe("registryFolder", () => {
	it("is a sendreceive folder shared with every device", () => {
		const f = registryFolder(["SELF", "PEER"]);
		expect(f.id).toBe(REGISTRY_FOLDER_ID);
		expect(f.type).toBe("sendreceive");
		expect(f.devices.map((d) => d.deviceID)).toEqual(["SELF", "PEER"]);
	});
});

describe("buildMachineInfo", () => {
	it("derives code roots from the rootProfile", () => {
		const cfg = baseConfig({
			rootProfile: createRootProfile({
				id: "p",
				canonicalRoot: "/Users/alice/Coding",
				localRoot: "/Users/alice/Coding",
				codeFolders: [{ relativePath: "app" }, { relativePath: "lib" }],
			}),
			buckets: {
				"claude-conversations": {
					enabled: true,
					paths: [],
					ignore: [],
					versioning: { type: "simple", keep: 5 },
				},
			},
		});
		const info = buildMachineInfo(cfg, "DEV123");
		expect(info.deviceId).toBe("DEV123");
		expect(info.machineName).toBe("macbook");
		expect(info.canonicalRoot).toBe("/Users/alice/Coding");
		expect(info.codeRoots).toEqual(["/Users/alice/Coding/app", "/Users/alice/Coding/lib"]);
		expect(info.conversationsEnabled).toBe(true);
		expect(info.version).toBeTruthy();
	});

	it("falls back to the code-root bucket paths when no rootProfile", () => {
		const cfg = baseConfig({
			buckets: {
				"code-root": {
					enabled: true,
					paths: ["/Users/alice/work/proj"],
					ignore: [],
					versioning: { type: "staggered", keep: 30 },
				},
			},
		});
		const info = buildMachineInfo(cfg, "DEV123");
		expect(info.canonicalRoot).toBeNull();
		expect(info.codeRoots).toEqual(["/Users/alice/work/proj"]);
	});
});
