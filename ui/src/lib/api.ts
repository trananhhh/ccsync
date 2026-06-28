declare global {
	interface Window {
		__CCSYNC_TOKEN__?: string;
	}
}

/** Token injected into the served HTML, or (in `vite dev`) the build-time define. */
function token(): string {
	return window.__CCSYNC_TOKEN__ ?? import.meta.env.VITE_CCSYNC_TOKEN ?? "";
}

export interface Bucket {
	name: string;
	enabled: boolean;
	paths: string[];
}

export interface Peer {
	name: string;
	deviceId: string;
}

export interface State {
	machineName: string;
	metered: boolean;
	peers: Peer[];
	buckets: Bucket[];
}

/** The realtime SSE payload. Mirrors the FROZEN server `MonitorState` contract. */
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

export interface Conflict {
	file: string;
	original: string;
	bucket: string;
	isHistoryFile: boolean;
}

export type ConflictAction = "keep-local" | "keep-remote" | "skip";

export async function getState(): Promise<State> {
	const res = await fetch("/api/state");
	if (!res.ok) throw new Error(`GET /api/state failed: ${res.status}`);
	return (await res.json()) as State;
}

/** Build the token-bearing SSE URL the EventSource connects to. */
export function eventsUrl(): string {
	return `/api/events?token=${encodeURIComponent(token())}`;
}

export async function getConflicts(): Promise<Conflict[]> {
	const res = await fetch("/api/conflicts");
	if (!res.ok) throw new Error(`GET /api/conflicts failed: ${res.status}`);
	return ((await res.json()) as { conflicts: Conflict[] }).conflicts;
}

export async function post<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(path, {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-ccsync-token": token() },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
	return (await res.json()) as T;
}

export function toggleBucket(target: string, on: boolean): Promise<{ ok: boolean }> {
	return post("/api/toggle", { target, on });
}

export function setMetered(on: boolean): Promise<{ ok: boolean; metered: boolean }> {
	return post("/api/metered", { on });
}

export function resolveConflict(
	file: string,
	action: ConflictAction,
): Promise<{ ok: boolean; file: string; action: ConflictAction }> {
	return post("/api/conflicts/resolve", { file, action });
}

export interface HandoffResult {
	status: "synced" | "pending";
}

export function handoffRelease(timeoutMs?: number): Promise<HandoffResult> {
	return post("/api/handoff/release", timeoutMs ? { timeoutMs } : {});
}
