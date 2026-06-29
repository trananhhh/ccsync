export interface SyncthingApiOptions {
	apiKey: string;
	guiAddress: string;
}

export interface SystemStatus {
	myID: string;
	uptime: number;
	startTime: string;
}

export interface FolderStatus {
	globalBytes: number;
	globalFiles: number;
	localBytes: number;
	localFiles: number;
	needBytes: number;
	needFiles: number;
	needDeletes: number;
	state: string;
	stateChanged: string;
	inSyncBytes: number;
	inSyncFiles: number;
	pullErrors: number;
}

export interface ConnectionInfo {
	connected: boolean;
	paused: boolean;
	isLocal: boolean;
	type: string;
	address: string;
	clientVersion: string;
	inBytesTotal: number;
	outBytesTotal: number;
}

export interface ConnectionTotals {
	inBytesTotal: number;
	outBytesTotal: number;
	at: string;
}

export interface ConnectionsResponse {
	total: ConnectionTotals;
	connections: Record<string, ConnectionInfo>;
}

export interface CompletionInfo {
	completion: number;
	globalBytes: number;
	needBytes: number;
	needItems: number;
	needDeletes: number;
}

export interface SyncthingEvent {
	id: number;
	globalID?: number;
	type: string;
	time: string;
	data?: unknown;
}

export interface EventsQuery {
	since?: number;
	timeout?: number;
	events?: string[];
	limit?: number;
}

export class SyncthingApi {
	private base: string;
	private apiKey: string;

	constructor(opts: SyncthingApiOptions) {
		this.apiKey = opts.apiKey;
		const addr = opts.guiAddress.startsWith("http") ? opts.guiAddress : `http://${opts.guiAddress}`;
		this.base = addr.replace(/\/$/, "");
	}

	private async request<T>(
		method: string,
		pathname: string,
		body?: unknown,
		signal?: AbortSignal,
	): Promise<T> {
		const res = await fetch(`${this.base}${pathname}`, {
			method,
			headers: {
				"X-API-Key": this.apiKey,
				"Content-Type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal,
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`Syncthing API ${method} ${pathname} -> ${res.status}: ${text}`);
		}
		const contentType = res.headers.get("content-type") || "";
		if (contentType.includes("application/json")) {
			return (await res.json()) as T;
		}
		return (await res.text()) as unknown as T;
	}

	async systemStatus(): Promise<SystemStatus> {
		return this.request<SystemStatus>("GET", "/rest/system/status");
	}

	async getConfig(): Promise<SyncthingConfig> {
		return this.request<SyncthingConfig>("GET", "/rest/config");
	}

	async putConfig(config: SyncthingConfig): Promise<void> {
		await this.request("PUT", "/rest/config", config);
	}

	async restart(): Promise<void> {
		await this.request("POST", "/rest/system/restart");
	}

	async scan(folderId: string): Promise<void> {
		await this.request("POST", `/rest/db/scan?folder=${encodeURIComponent(folderId)}`);
	}

	async folderStatus(folderId: string): Promise<FolderStatus> {
		return this.request<FolderStatus>(
			"GET",
			`/rest/db/status?folder=${encodeURIComponent(folderId)}`,
		);
	}

	async connections(): Promise<ConnectionsResponse> {
		return this.request<ConnectionsResponse>("GET", "/rest/system/connections");
	}

	async completion(folderId: string, deviceId?: string): Promise<CompletionInfo> {
		const params = new URLSearchParams({ folder: folderId });
		if (deviceId) params.set("device", deviceId);
		return this.request<CompletionInfo>("GET", `/rest/db/completion?${params.toString()}`);
	}

	/**
	 * Long-poll the Syncthing event stream. With `timeout` the request blocks
	 * server-side until an event arrives or the timeout elapses; `since` returns
	 * only events newer than that id; `limit` (with no `since`) re-baselines to the
	 * latest id after a daemon restart resets the event counter.
	 */
	async events(query: EventsQuery = {}, signal?: AbortSignal): Promise<SyncthingEvent[]> {
		const params = new URLSearchParams();
		if (query.since !== undefined) params.set("since", String(query.since));
		if (query.timeout !== undefined) params.set("timeout", String(query.timeout));
		if (query.events && query.events.length > 0) params.set("events", query.events.join(","));
		if (query.limit !== undefined) params.set("limit", String(query.limit));
		const qs = params.toString();
		return this.request<SyncthingEvent[]>(
			"GET",
			`/rest/events${qs ? `?${qs}` : ""}`,
			undefined,
			signal,
		);
	}

	async ping(): Promise<boolean> {
		try {
			await this.request("GET", "/rest/system/ping");
			return true;
		} catch {
			return false;
		}
	}
}

export interface SyncthingFolder {
	id: string;
	label: string;
	path: string;
	type: "sendreceive" | "sendonly" | "receiveonly";
	devices: Array<{ deviceID: string }>;
	versioning?: {
		type: string;
		params: Record<string, string>;
	};
	ignorePerms?: boolean;
	rescanIntervalS?: number;
	fsWatcherEnabled?: boolean;
	paused?: boolean;
}

export interface SyncthingDevice {
	deviceID: string;
	name: string;
	addresses: string[];
	compression?: "metadata" | "always" | "never";
	introducer?: boolean;
	paused?: boolean;
}

export interface SyncthingConfig {
	version: number;
	folders: SyncthingFolder[];
	devices: SyncthingDevice[];
	gui?: {
		address: string;
		apiKey: string;
		theme?: string;
	};
	options?: Record<string, unknown>;
}
