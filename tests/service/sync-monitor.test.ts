import { describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/core/config-schema.js";
import type {
	CompletionInfo,
	ConnectionsResponse,
	EventsQuery,
	FolderStatus,
	SyncthingApi,
	SyncthingConfig,
	SyncthingEvent,
} from "../../src/core/syncthing-api.js";
import {
	computeThroughput,
	deriveState,
	isEventIdGap,
	SyncMonitor,
} from "../../src/service/sync-monitor.js";

function baseConfig(): Config {
	return {
		machineName: "m",
		peers: [{ deviceId: "PEER", name: "laptop", addresses: ["dynamic"], introducer: false }],
		buckets: {
			"claude-config": {
				enabled: true,
				paths: ["/home/x/.claude.json"],
				ignore: [],
				versioning: { type: "simple", keep: 10 },
			},
		},
		globalIgnore: [],
		metered: false,
	} as Config;
}

describe("computeThroughput", () => {
	it("returns the byte rate from the delta over the time window", () => {
		const prev = { inBytesTotal: 1000, outBytesTotal: 2000, at: 1000 };
		const cur = { inBytesTotal: 3000, outBytesTotal: 2500, at: 3000 };
		// dt = 2s; down = 2000/2 = 1000, up = 500/2 = 250
		expect(computeThroughput(prev, cur)).toEqual({ up: 250, down: 1000 });
	});

	it("never reports a negative rate when counters reset", () => {
		const prev = { inBytesTotal: 5000, outBytesTotal: 5000, at: 1000 };
		const cur = { inBytesTotal: 10, outBytesTotal: 10, at: 2000 };
		expect(computeThroughput(prev, cur)).toEqual({ up: 0, down: 0 });
	});

	it("returns zero when no time has elapsed", () => {
		const prev = { inBytesTotal: 0, outBytesTotal: 0, at: 1000 };
		const cur = { inBytesTotal: 100, outBytesTotal: 100, at: 1000 };
		expect(computeThroughput(prev, cur)).toEqual({ up: 0, down: 0 });
	});
});

describe("isEventIdGap", () => {
	it("detects a backwards id jump as a daemon restart", () => {
		expect(isEventIdGap(100, [{ id: 5 }, { id: 6 }])).toBe(true);
	});
	it("is false for forward progress or an empty batch", () => {
		expect(isEventIdGap(10, [{ id: 11 }, { id: 12 }])).toBe(false);
		expect(isEventIdGap(10, [])).toBe(false);
	});
});

describe("deriveState", () => {
	it("produces exactly the frozen payload shape", () => {
		const state = deriveState({
			cfg: baseConfig(),
			throughput: { up: 1, down: 2 },
			devices: [{ id: "PEER", name: "laptop", connected: true, paused: false }],
			folders: [
				{
					id: "ccsync-claude-config-0",
					label: "claude-config: /home/x/.claude.json",
					state: "idle",
					completion: 100,
					needBytes: 0,
				},
			],
			conflicts: 3,
		});

		expect(state).toEqual({
			throughput: { up: 1, down: 2 },
			devices: [{ id: "PEER", name: "laptop", connected: true, paused: false }],
			folders: [
				{
					id: "ccsync-claude-config-0",
					bucket: "claude-config",
					label: "claude-config: /home/x/.claude.json",
					state: "idle",
					completion: 100,
					needBytes: 0,
				},
			],
			conflicts: 3,
			metered: false,
		});
	});

	it("falls back to the folder id when it maps to no bucket", () => {
		const state = deriveState({
			cfg: baseConfig(),
			throughput: { up: 0, down: 0 },
			devices: [],
			folders: [{ id: "foreign-folder", label: "x", state: "idle", completion: 0, needBytes: 0 }],
			conflicts: 0,
		});
		expect(state.folders[0].bucket).toBe("foreign-folder");
	});
});

interface FakeApiOptions {
	eventsScript: Array<(q: EventsQuery) => SyncthingEvent[]>;
	folders?: Array<{ id: string; label: string }>;
}

function fakeApi(opts: FakeApiOptions) {
	const eventsCalls: EventsQuery[] = [];
	let connSample = 0;
	let scriptIndex = 0;
	const folders = opts.folders ?? [
		{ id: "ccsync-claude-config-0", label: "claude-config: /home/x/.claude.json" },
	];

	const api = {
		events: vi.fn(async (q: EventsQuery = {}, signal?: AbortSignal): Promise<SyncthingEvent[]> => {
			eventsCalls.push(q);
			if (scriptIndex < opts.eventsScript.length) {
				return opts.eventsScript[scriptIndex++](q);
			}
			// Park: a long-poll (with signal) blocks until aborted, mirroring a real
			// Syncthing long-poll; an unsignalled rebaseline resolves [] quickly.
			if (!signal) {
				await new Promise((r) => setTimeout(r, 5));
				return [];
			}
			return new Promise<SyncthingEvent[]>((_resolve, reject) => {
				const abort = () => {
					const err = new Error("aborted");
					err.name = "AbortError";
					reject(err);
				};
				if (signal.aborted) return abort();
				signal.addEventListener("abort", abort, { once: true });
			});
		}),
		getConfig: async (): Promise<SyncthingConfig> => ({
			version: 1,
			folders: folders.map((f) => ({
				id: f.id,
				label: f.label,
				path: "/p",
				type: "sendreceive" as const,
				devices: [],
			})),
			devices: [],
		}),
		connections: async (): Promise<ConnectionsResponse> => {
			connSample += 1;
			return {
				total: { inBytesTotal: connSample * 1000, outBytesTotal: connSample * 500, at: "now" },
				connections: {
					PEER: {
						connected: true,
						paused: false,
						isLocal: false,
						type: "TCP",
						address: "a",
						clientVersion: "v",
						inBytesTotal: 0,
						outBytesTotal: 0,
					},
				},
			};
		},
		completion: async (): Promise<CompletionInfo> => ({
			completion: 100,
			globalBytes: 0,
			needBytes: 0,
			needItems: 0,
			needDeletes: 0,
		}),
		folderStatus: async (): Promise<FolderStatus> =>
			({ state: "idle", needBytes: 0 }) as FolderStatus,
	} as unknown as SyncthingApi;

	return { api, eventsCalls, limitCalls: () => eventsCalls.filter((q) => q.limit === 1).length };
}

describe("SyncMonitor loop", () => {
	it("emits an initial snapshot and re-emits on an event, from one shared loop", async () => {
		const { api, limitCalls } = fakeApi({
			eventsScript: [
				() => [{ id: 10, type: "Starting", time: "now" }], // baseline
				() => [{ id: 11, type: "StateChanged", time: "now" }], // first poll -> resample
			],
		});
		const monitor = new SyncMonitor({
			api,
			configPath: "/x",
			readConfig: async () => baseConfig(),
			countConflicts: async () => 0,
			eventTimeoutS: 1,
			reconnectDelayMs: 5,
		});

		const states: number[] = [];
		monitor.subscribe(() => states.push(Date.now()));
		// A second subscriber must not spawn a second poll loop.
		monitor.subscribe(() => {});
		monitor.start();

		await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { timeout: 1000 });
		// Exactly one baseline => one loop, regardless of subscriber count.
		expect(limitCalls()).toBe(1);
		const snap = monitor.snapshot();
		expect(snap?.folders[0].bucket).toBe("claude-config");
		expect(snap?.devices[0].connected).toBe(true);
		await monitor.stop();
	});

	it("re-baselines with limit=1 when the event id gaps backwards", async () => {
		const { api, limitCalls } = fakeApi({
			eventsScript: [
				() => [{ id: 100, type: "Starting", time: "now" }], // baseline -> since=100
				() => [{ id: 5, type: "StateChanged", time: "now" }], // gap -> re-baseline
			],
		});
		const monitor = new SyncMonitor({
			api,
			configPath: "/x",
			readConfig: async () => baseConfig(),
			countConflicts: async () => 0,
			eventTimeoutS: 1,
			reconnectDelayMs: 5,
		});

		monitor.subscribe(() => {});
		monitor.start();

		await vi.waitFor(() => expect(limitCalls()).toBeGreaterThanOrEqual(2), { timeout: 1000 });
		await monitor.stop();
	});

	it("stop() resolves promptly by aborting the in-flight long-poll", async () => {
		// Only a baseline event; the loop then parks on a long-poll that resolves
		// only when its AbortSignal fires. Without abort, stop() would hang.
		const { api } = fakeApi({
			eventsScript: [() => [{ id: 10, type: "Starting", time: "now" }]],
		});
		const monitor = new SyncMonitor({
			api,
			configPath: "/x",
			readConfig: async () => baseConfig(),
			countConflicts: async () => 0,
			eventTimeoutS: 30, // a real long-poll would block this long
			reconnectDelayMs: 5,
		});

		let emits = 0;
		monitor.subscribe(() => {
			emits += 1;
		});
		monitor.start();

		await vi.waitFor(() => expect(emits).toBeGreaterThanOrEqual(1), { timeout: 1000 });
		const emitsBeforeStop = emits;

		const started = Date.now();
		await monitor.stop();
		// Resolves well under the 30s long-poll timeout because stop() aborts it.
		expect(Date.now() - started).toBeLessThan(1000);
		// No state is emitted after stop.
		expect(emits).toBe(emitsBeforeStop);
	});
});
