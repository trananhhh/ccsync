import { describe, expect, it } from "vitest";
import {
	applyPause,
	pauseAllTransfers,
	resumeAllTransfers,
	setFolderPaused,
} from "../../src/core/sync-control.js";
import type { SyncthingApi, SyncthingConfig } from "../../src/core/syncthing-api.js";

function baseConfig(): SyncthingConfig {
	return {
		version: 1,
		folders: [{ id: "ccsync-a", label: "a", path: "/a", type: "sendreceive", devices: [] }],
		devices: [
			{ deviceID: "D1", name: "self", addresses: ["dynamic"] },
			{ deviceID: "D2", name: "peer", addresses: ["dynamic"] },
		],
	};
}

describe("sync-control pure transforms", () => {
	it("pauseAllTransfers pauses every device, leaves folders running", () => {
		const out = pauseAllTransfers(baseConfig());
		expect(out.devices.every((d) => d.paused === true)).toBe(true);
		expect(out.folders[0].paused).toBeUndefined();
	});

	it("resumeAllTransfers unpauses every device", () => {
		const paused = pauseAllTransfers(baseConfig());
		const out = resumeAllTransfers(paused);
		expect(out.devices.every((d) => d.paused === false)).toBe(true);
	});

	it("setFolderPaused toggles one folder", () => {
		const out = setFolderPaused(baseConfig(), "ccsync-a", true);
		expect(out.folders[0].paused).toBe(true);
	});
});

describe("applyPause", () => {
	it("reads config, transforms, writes it back", async () => {
		let written: SyncthingConfig | undefined;
		const api = {
			getConfig: async () => baseConfig(),
			putConfig: async (c: SyncthingConfig) => {
				written = c;
			},
		} as unknown as SyncthingApi;
		await applyPause(api, "pause-all");
		expect(written?.devices.every((d) => d.paused === true)).toBe(true);
	});
});
