import { describe, expect, it } from "vitest";
import type { Bucket } from "../../src/core/config-schema.js";
import { bucketToFolders, buildDevices, buildFolders } from "../../src/core/syncthing-config.js";

const ID_A = "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA";
const ID_B = "BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB";

describe("bucketToFolders", () => {
	it("returns empty array when bucket disabled", () => {
		const b: Bucket = {
			enabled: false,
			paths: ["/tmp/a"],
			ignore: [],
			versioning: { type: "simple", keep: 5 },
		};
		expect(bucketToFolders("x", b, [ID_A])).toEqual([]);
	});

	it("returns empty when no paths", () => {
		const b: Bucket = {
			enabled: true,
			paths: [],
			ignore: [],
			versioning: { type: "simple", keep: 5 },
		};
		expect(bucketToFolders("x", b, [ID_A])).toEqual([]);
	});

	it("creates one folder per path with sendreceive and fsWatcher on", () => {
		const b: Bucket = {
			enabled: true,
			paths: ["/tmp/a", "/tmp/b"],
			ignore: [],
			versioning: { type: "simple", keep: 5 },
		};
		const out = bucketToFolders("claude-config", b, [ID_A, ID_B]);
		expect(out).toHaveLength(2);
		expect(out[0].id).toBe("ccsync-claude-config-0");
		expect(out[0].type).toBe("sendreceive");
		expect(out[0].fsWatcherEnabled).toBe(true);
		expect(out[0].devices.map((d) => d.deviceID)).toEqual([ID_A, ID_B]);
	});

	it("omits versioning when type=none", () => {
		const b: Bucket = {
			enabled: true,
			paths: ["/tmp/a"],
			ignore: [],
			versioning: { type: "none", keep: 0 },
		};
		const out = bucketToFolders("x", b, [ID_A]);
		expect(out[0].versioning).toBeUndefined();
	});

	it("emits versioning params with keep when type set", () => {
		const b: Bucket = {
			enabled: true,
			paths: ["/tmp/a"],
			ignore: [],
			versioning: { type: "staggered", keep: 30 },
		};
		const out = bucketToFolders("x", b, [ID_A]);
		expect(out[0].versioning).toEqual({ type: "staggered", params: { keep: "30" } });
	});
});

describe("buildDevices", () => {
	it("places self first then peers", () => {
		const out = buildDevices(ID_A, "macbook", [
			{ deviceId: ID_B, name: "linux-desk", addresses: ["dynamic"], introducer: false },
		]);
		expect(out[0].deviceID).toBe(ID_A);
		expect(out[0].name).toBe("macbook");
		expect(out[1].deviceID).toBe(ID_B);
	});
});

describe("buildFolders", () => {
	it("combines multiple buckets and includes all device IDs", () => {
		const out = buildFolders({
			machineName: "test",
			myDeviceId: ID_A,
			peers: [{ deviceId: ID_B, name: "peer", addresses: ["dynamic"], introducer: true }],
			buckets: {
				a: { enabled: true, paths: ["/a"], ignore: [], versioning: { type: "simple", keep: 5 } },
				b: {
					enabled: true,
					paths: ["/b", "/c"],
					ignore: [],
					versioning: { type: "simple", keep: 5 },
				},
			},
		});
		expect(out).toHaveLength(3);
		expect(out.every((f) => f.devices.length === 2)).toBe(true);
	});
});
