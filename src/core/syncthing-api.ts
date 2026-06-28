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
	state: string;
	stateChanged: string;
	inSyncBytes: number;
	inSyncFiles: number;
}

export interface ConnectionInfo {
	connected: boolean;
	address: string;
	clientVersion: string;
	inBytesTotal: number;
	outBytesTotal: number;
}

export interface ConnectionsResponse {
	connections: Record<string, ConnectionInfo>;
}

export class SyncthingApi {
	private base: string;
	private apiKey: string;

	constructor(opts: SyncthingApiOptions) {
		this.apiKey = opts.apiKey;
		const addr = opts.guiAddress.startsWith("http") ? opts.guiAddress : `http://${opts.guiAddress}`;
		this.base = addr.replace(/\/$/, "");
	}

	private async request<T>(method: string, pathname: string, body?: unknown): Promise<T> {
		const res = await fetch(`${this.base}${pathname}`, {
			method,
			headers: {
				"X-API-Key": this.apiKey,
				"Content-Type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
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
