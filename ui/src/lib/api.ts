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

export type SyncMode = "realtime" | "manual";

export interface State {
	machineName: string;
	metered: boolean;
	/** "realtime" (continuous) or "manual" (paused until an explicit sync). */
	syncMode?: SyncMode;
	peers: Peer[];
	buckets: Bucket[];
	/** Devices waiting to be admitted (joined without a fresh invite token). */
	pending: Peer[];
	/** False on a fresh machine → the SPA shows the onboarding wizard. */
	configured: boolean;
	/** Whether the Syncthing binary is on PATH (wizard step 1 gating). */
	syncthingInstalled: boolean;
	/** True while this machine is auto-accepting a freshly issued invite. */
	pairing: boolean;
}

export interface BrowseEntry {
	name: string;
	path: string;
	isDir: true;
}

export interface BrowseResult {
	path: string;
	parent: string | null;
	entries: BrowseEntry[];
}

export interface PairInvite {
	token: string;
	command: string;
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
	/** Short device id that produced the conflict copy, or null if unparsable. */
	sourceDevice: string | null;
	/** Friendly peer name for sourceDevice when known. */
	sourceName: string | null;
	/** Marker timestamp `YYYY-MM-DDTHH:MM:SS`. */
	conflictTime: string | null;
	conflictMtime: number | null;
	conflictSize: number | null;
	originalMtime: number | null;
	originalSize: number | null;
}

export interface ConflictDiff {
	status: "ok" | "binary" | "too-large" | "missing-original";
	patch?: string;
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

export interface Machine {
	deviceId: string;
	machineName: string;
	canonicalRoot: string | null;
	codeRoots: string[];
	conversationsEnabled: boolean;
	version: string;
	updatedAt: string;
	/** True for the machine serving this dashboard. */
	self: boolean;
	/** Connected right now (always true for self). */
	online: boolean;
}

export async function getMachines(): Promise<Machine[]> {
	const res = await fetch("/api/machines");
	if (!res.ok) throw new Error(`GET /api/machines failed: ${res.status}`);
	return ((await res.json()) as { machines: Machine[] }).machines;
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

export function setSyncMode(mode: SyncMode): Promise<{ ok: boolean; syncMode: SyncMode }> {
	return post("/api/sync-mode", { mode });
}

export function syncNow(): Promise<{ ok: boolean; result: string }> {
	return post("/api/sync-now", {});
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

export interface BulkResolveResult {
	ok: boolean;
	resolved: number;
	errors: Array<{ file: string; error: string }>;
	/** Where the losing files were copied before being overwritten/removed. */
	backupDir: string;
}

export function resolveConflictsBulk(
	items: Array<{ file: string; action: ConflictAction }>,
): Promise<BulkResolveResult> {
	return post("/api/conflicts/resolve-bulk", { items });
}

export async function getConflictDiff(file: string): Promise<ConflictDiff> {
	const res = await fetch(`/api/conflicts/diff?file=${encodeURIComponent(file)}`);
	if (!res.ok) throw new Error(`GET /api/conflicts/diff failed: ${res.status}`);
	return (await res.json()) as ConflictDiff;
}

export function acceptPending(
	deviceId?: string,
	all?: boolean,
): Promise<{ ok: boolean; accepted: number }> {
	return post("/api/pending/accept", all ? { all: true } : { deviceId });
}

export interface HandoffResult {
	status: "synced" | "pending";
}

export function handoffRelease(timeoutMs?: number): Promise<HandoffResult> {
	return post("/api/handoff/release", timeoutMs ? { timeoutMs } : {});
}

/** List the immediate subdirectories of `path` (home root when omitted). */
export async function browseFolders(path?: string): Promise<BrowseResult> {
	const qs = path ? `?path=${encodeURIComponent(path)}` : "";
	const res = await fetch(`/api/folders/browse${qs}`);
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `GET /api/folders/browse failed: ${res.status}`);
	}
	return (await res.json()) as BrowseResult;
}

export interface SetupInitInput {
	machineName: string;
	codeRoot?: string;
	codeFolders?: string[];
	buckets?: Record<string, boolean>;
}

export function setupInit(input: SetupInitInput): Promise<{ ok: boolean; configured: boolean }> {
	return post("/api/setup/init", input);
}

export function pairInvite(): Promise<PairInvite> {
	return post("/api/pair/invite", {});
}

export function pairJoin(token: string, localRoot?: string): Promise<{ ok: boolean }> {
	return post("/api/pair/join", { token, localRoot });
}
