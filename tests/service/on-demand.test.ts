import { describe, expect, it } from "vitest";
import type { SyncthingApi } from "../../src/core/syncthing-api.js";
import { ownedDeviceIds, runOnDemandSync } from "../../src/service/on-demand.js";

interface Recorded {
	putConfig: Array<{ devices: Array<{ deviceID: string; paused?: boolean }> }>;
	scan: string[];
}

function mockApi(folderStatus: () => Promise<Record<string, number>>) {
	const config = {
		devices: [
			{ deviceID: "SELF", paused: true },
			{ deviceID: "PEER", paused: true },
			{ deviceID: "FOREIGN", paused: true },
		],
	};
	const rec: Recorded = { putConfig: [], scan: [] };
	const api = {
		getConfig: async () => JSON.parse(JSON.stringify(config)),
		putConfig: async (c: Recorded["putConfig"][number]) => {
			rec.putConfig.push(c);
		},
		scan: async (id: string) => {
			rec.scan.push(id);
		},
		folderStatus,
	} as unknown as SyncthingApi;
	return { api, rec };
}

const synced = async () => ({ needFiles: 0, needBytes: 0, needDeletes: 0, pullErrors: 0 });
const pending = async () => ({ needFiles: 1, needBytes: 0, needDeletes: 0, pullErrors: 0 });

describe("ownedDeviceIds", () => {
	it("includes self and every peer, not foreign", () => {
		const ids = ownedDeviceIds("SELF", [
			{ deviceId: "PEER", name: "p", addresses: ["dynamic"], introducer: false },
		]);
		expect([...ids].sort()).toEqual(["PEER", "SELF"]);
	});
});

describe("runOnDemandSync", () => {
	it("resumes owned devices, scans, then re-pauses on success", async () => {
		const { api, rec } = mockApi(synced);
		const result = await runOnDemandSync({
			api,
			ownedIds: new Set(["SELF", "PEER"]),
			folderIds: ["f1", "f2"],
			timeoutMs: 5000,
		});
		expect(result).toBe("synced");
		expect(rec.scan).toEqual(["f1", "f2"]);
		expect(rec.putConfig).toHaveLength(2);
		const resumed = rec.putConfig[0].devices;
		expect(resumed.find((d) => d.deviceID === "SELF")?.paused).toBe(false);
		expect(resumed.find((d) => d.deviceID === "FOREIGN")?.paused).toBe(true); // untouched
		const repaused = rec.putConfig[1].devices;
		expect(repaused.find((d) => d.deviceID === "SELF")?.paused).toBe(true);
	});

	it("re-pauses even when the wait times out", async () => {
		const { api, rec } = mockApi(pending);
		const result = await runOnDemandSync({
			api,
			ownedIds: new Set(["SELF"]),
			folderIds: ["f1"],
			timeoutMs: 40,
		});
		expect(result).toBe("timeout");
		expect(rec.putConfig).toHaveLength(2);
		expect(rec.putConfig[1].devices.find((d) => d.deviceID === "SELF")?.paused).toBe(true);
	});
});
