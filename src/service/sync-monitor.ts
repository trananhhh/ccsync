import { readConfig as defaultReadConfig } from "../core/config-io.js";
import type { Config } from "../core/config-schema.js";
import { findConflicts } from "../core/conflicts-scanner.js";
import type { SyncthingApi } from "../core/syncthing-api.js";
import { bucketForFolderId } from "../core/syncthing-config.js";

/** The realtime payload pushed to dashboard clients. FROZEN — Phase 3 binds verbatim. */
export interface MonitorState {
	throughput: { up: number; down: number };
	devices: Array<{ id: string; name: string; connected: boolean; paused: boolean }>;
	folders: Array<{
		id: string;
		bucket: string;
		label: string;
		state: string;
		completion: number;
		needBytes: number;
	}>;
	conflicts: number;
	metered: boolean;
}

/** Cumulative byte counters captured at a point in time, used to derive a rate. */
export interface ThroughputSample {
	inBytesTotal: number;
	outBytesTotal: number;
	at: number;
}

export interface DeviceSample {
	id: string;
	name: string;
	connected: boolean;
	paused: boolean;
}

export interface FolderSample {
	id: string;
	label: string;
	state: string;
	completion: number;
	needBytes: number;
}

export const MONITOR_EVENT_TYPES = [
	"FolderSummary",
	"StateChanged",
	"DownloadProgress",
	"DeviceConnected",
	"DeviceDisconnected",
	"FolderPaused",
	"FolderResumed",
] as const;

/** Bytes/sec from the delta between two cumulative samples; never negative. */
export function computeThroughput(
	prev: ThroughputSample,
	cur: ThroughputSample,
): { up: number; down: number } {
	const dtSeconds = (cur.at - prev.at) / 1000;
	if (dtSeconds <= 0) return { up: 0, down: 0 };
	const up = Math.max(0, (cur.outBytesTotal - prev.outBytesTotal) / dtSeconds);
	const down = Math.max(0, (cur.inBytesTotal - prev.inBytesTotal) / dtSeconds);
	return { up: Math.round(up), down: Math.round(down) };
}

/**
 * Syncthing's per-run event ids reset to a low value when the daemon restarts.
 * A non-empty batch whose newest id is below our cursor means the counter went
 * backwards, so we must re-baseline rather than keep waiting on a dead cursor.
 */
export function isEventIdGap(currentSince: number, events: Array<{ id: number }>): boolean {
	if (events.length === 0) return false;
	return maxEventId(events) < currentSince;
}

function maxEventId(events: Array<{ id: number }>): number {
	return events.reduce((acc, e) => (e.id > acc ? e.id : acc), 0);
}

/** Assemble the frozen payload from already-sampled parts. Pure for testability. */
export function deriveState(input: {
	cfg: Config;
	throughput: { up: number; down: number };
	devices: DeviceSample[];
	folders: FolderSample[];
	conflicts: number;
}): MonitorState {
	return {
		throughput: input.throughput,
		devices: input.devices,
		folders: input.folders.map((f) => ({
			id: f.id,
			bucket: bucketForFolderId(f.id, input.cfg) ?? f.id,
			label: f.label,
			state: f.state,
			completion: f.completion,
			needBytes: f.needBytes,
		})),
		conflicts: input.conflicts,
		metered: input.cfg.metered,
	};
}

export interface SyncMonitorDeps {
	api: SyncthingApi;
	configPath: string;
	readConfig?: typeof defaultReadConfig;
	countConflicts?: (cfg: Config) => Promise<number>;
	/** Server-side long-poll timeout in seconds (default 30). */
	eventTimeoutS?: number;
	/** Backoff after a failed poll before re-baselining (default 1000ms). */
	reconnectDelayMs?: number;
}

type Subscriber = (state: MonitorState) => void;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A single shared poll loop over the Syncthing event stream. Samples connection
 * + folder status on each change, derives the frozen state object, and fans it
 * out to all subscribers. One loop feeds every SSE client — subscribers never
 * spawn their own poll.
 */
export class SyncMonitor {
	private readonly api: SyncthingApi;
	private readonly configPath: string;
	private readonly readConfig: typeof defaultReadConfig;
	private readonly countConflicts: (cfg: Config) => Promise<number>;
	private readonly eventTimeoutS: number;
	private readonly reconnectDelayMs: number;

	private readonly subscribers = new Set<Subscriber>();
	private latest: MonitorState | undefined;
	private prevSample: ThroughputSample | undefined;
	private since = 0;
	private running = false;
	private loop: Promise<void> | undefined;

	constructor(deps: SyncMonitorDeps) {
		this.api = deps.api;
		this.configPath = deps.configPath;
		this.readConfig = deps.readConfig ?? defaultReadConfig;
		this.countConflicts = deps.countConflicts ?? (async (cfg) => (await findConflicts(cfg)).length);
		this.eventTimeoutS = deps.eventTimeoutS ?? 30;
		this.reconnectDelayMs = deps.reconnectDelayMs ?? 1000;
	}

	/** Register a listener; immediately replays the latest snapshot if present. */
	subscribe(fn: Subscriber): () => void {
		this.subscribers.add(fn);
		if (this.latest) fn(this.latest);
		return () => {
			this.subscribers.delete(fn);
		};
	}

	snapshot(): MonitorState | undefined {
		return this.latest;
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.loop = this.run();
	}

	async stop(): Promise<void> {
		this.running = false;
		await this.loop?.catch(() => {});
		this.loop = undefined;
		this.subscribers.clear();
	}

	private emit(state: MonitorState): void {
		this.latest = state;
		for (const fn of this.subscribers) fn(state);
	}

	private async run(): Promise<void> {
		await this.rebaseline();
		await this.sampleAndEmit();
		while (this.running) {
			try {
				const events = await this.api.events({
					since: this.since,
					timeout: this.eventTimeoutS,
					events: [...MONITOR_EVENT_TYPES],
				});
				if (!this.running) break;
				if (events.length === 0) continue;
				if (isEventIdGap(this.since, events)) {
					await this.rebaseline();
				} else {
					this.since = maxEventId(events);
				}
				await this.sampleAndEmit();
			} catch {
				if (!this.running) break;
				await this.rebaseline();
				await delay(this.reconnectDelayMs);
			}
		}
	}

	/** Reset the event cursor to the daemon's current latest id. */
	private async rebaseline(): Promise<void> {
		try {
			const latest = await this.api.events({ limit: 1 });
			this.since = latest.length > 0 ? maxEventId(latest) : 0;
		} catch {
			this.since = 0;
		}
	}

	private async sampleAndEmit(): Promise<void> {
		try {
			this.emit(await this.sample());
		} catch {
			// transient daemon hiccup; the next event tick re-samples
		}
	}

	private async sample(): Promise<MonitorState> {
		const cfg = await this.readConfig(this.configPath);
		const [stConfig, conns] = await Promise.all([this.api.getConfig(), this.api.connections()]);

		const cur: ThroughputSample = {
			inBytesTotal: conns.total?.inBytesTotal ?? 0,
			outBytesTotal: conns.total?.outBytesTotal ?? 0,
			at: Date.now(),
		};
		const throughput = this.prevSample
			? computeThroughput(this.prevSample, cur)
			: { up: 0, down: 0 };
		this.prevSample = cur;

		const devices: DeviceSample[] = cfg.peers.map((p) => {
			const c = conns.connections?.[p.deviceId];
			return {
				id: p.deviceId,
				name: p.name,
				connected: c?.connected ?? false,
				paused: c?.paused ?? false,
			};
		});

		const folders: FolderSample[] = [];
		for (const f of stConfig.folders) {
			const [comp, status] = await Promise.all([
				this.api.completion(f.id).catch(() => undefined),
				this.api.folderStatus(f.id).catch(() => undefined),
			]);
			folders.push({
				id: f.id,
				label: f.label,
				state: status?.state ?? "unknown",
				completion: Math.round(comp?.completion ?? 0),
				needBytes: status?.needBytes ?? 0,
			});
		}

		const conflicts = await this.countConflicts(cfg);
		return deriveState({ cfg, throughput, devices, folders, conflicts });
	}
}
