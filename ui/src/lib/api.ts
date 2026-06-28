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

export async function getState(): Promise<State> {
	const res = await fetch("/api/state");
	if (!res.ok) throw new Error(`GET /api/state failed: ${res.status}`);
	return (await res.json()) as State;
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
