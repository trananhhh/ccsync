import { describe, expect, it } from "vitest";
import type { FolderStatus, SyncthingApi } from "../../src/core/syncthing-api.js";
import { waitUntilSynced } from "../../src/service/handoff.js";

function status(over: Partial<FolderStatus>): FolderStatus {
	return {
		globalBytes: 0,
		globalFiles: 0,
		localBytes: 0,
		localFiles: 0,
		needBytes: 0,
		needFiles: 0,
		needDeletes: 0,
		state: "idle",
		stateChanged: "",
		...over,
	} as FolderStatus;
}

function apiWith(map: Record<string, FolderStatus>): Pick<SyncthingApi, "folderStatus"> {
	return { folderStatus: async (id: string) => map[id] };
}

describe("waitUntilSynced", () => {
	it("resolves synced when every folder reports nothing pending", async () => {
		const api = apiWith({ a: status({}), b: status({}) });
		const result = await waitUntilSynced(
			{ api, folderIds: ["a", "b"] },
			{ timeoutMs: 1000, pollMs: 10 },
		);
		expect(result).toBe("synced");
	});

	it("returns synced immediately with no folders to watch", async () => {
		const api = apiWith({});
		const result = await waitUntilSynced({ api, folderIds: [] }, { timeoutMs: 1000, pollMs: 10 });
		expect(result).toBe("synced");
	});

	it("returns timeout while a folder stays pending", async () => {
		const api = apiWith({ a: status({ needBytes: 42 }) });
		const result = await waitUntilSynced({ api, folderIds: ["a"] }, { timeoutMs: 60, pollMs: 10 });
		expect(result).toBe("timeout");
	});

	it("treats a status read error as pending", async () => {
		const api: Pick<SyncthingApi, "folderStatus"> = {
			folderStatus: async () => {
				throw new Error("daemon down");
			},
		};
		const result = await waitUntilSynced({ api, folderIds: ["a"] }, { timeoutMs: 60, pollMs: 10 });
		expect(result).toBe("timeout");
	});

	it("aborts when the signal fires mid-wait", async () => {
		const api = apiWith({ a: status({ needFiles: 1 }) });
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 15);
		const result = await waitUntilSynced(
			{ api, folderIds: ["a"] },
			{ timeoutMs: 5000, pollMs: 50, signal: controller.signal },
		);
		expect(result).toBe("aborted");
	});

	it("reports pending counts via onProgress", async () => {
		const api = apiWith({ a: status({ needBytes: 1 }), b: status({}) });
		const seen: number[] = [];
		await waitUntilSynced(
			{ api, folderIds: ["a", "b"] },
			{ timeoutMs: 40, pollMs: 10, onProgress: (p) => seen.push(p) },
		);
		expect(seen.every((p) => p === 1)).toBe(true);
		expect(seen.length).toBeGreaterThan(0);
	});
});
