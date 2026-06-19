import type { SyncthingApi } from "./syncthing-api.js";

export interface PendingDevice {
	time: string;
	name: string;
	address: string;
}

export type PendingMap = Record<string, PendingDevice>;

export async function fetchPending(api: SyncthingApi): Promise<PendingMap> {
	try {
		return await (
			api as unknown as { request: <T>(m: string, p: string) => Promise<T> }
		).request<PendingMap>("GET", "/rest/cluster/pending/devices");
	} catch {
		return {};
	}
}
