import type { Peer } from "../core/config-schema.js";
import { setOwnedDevicesPaused } from "../core/sync-control.js";
import type { SyncthingApi } from "../core/syncthing-api.js";
import { type WaitResult, waitUntilSynced } from "./handoff.js";

/** Device IDs this machine owns: itself plus every configured peer. */
export function ownedDeviceIds(myDeviceId: string, peers: Peer[]): Set<string> {
	return new Set([myDeviceId, ...peers.map((p) => p.deviceId)]);
}

export interface OnDemandSyncDeps {
	api: SyncthingApi;
	ownedIds: Set<string>;
	folderIds: string[];
	timeoutMs: number;
	onProgress?: (pending: number) => void;
}

/**
 * One on-demand sync pass for manual mode: resume owned devices, rescan every
 * folder, wait for 100% in-sync, then re-pause — even if the wait throws or
 * times out, so transfers never stay running. Foreign devices are never touched.
 */
export async function runOnDemandSync(deps: OnDemandSyncDeps): Promise<WaitResult> {
	const { api, ownedIds, folderIds, timeoutMs, onProgress } = deps;
	await api.putConfig(setOwnedDevicesPaused(await api.getConfig(), ownedIds, false));
	for (const id of folderIds) {
		try {
			await api.scan(id);
		} catch {
			// folder may not yet be known to Syncthing; safe to skip
		}
	}
	try {
		return await waitUntilSynced(
			{ api, folderIds },
			{ timeoutMs, onProgress: (pending) => onProgress?.(pending) },
		);
	} finally {
		await api.putConfig(setOwnedDevicesPaused(await api.getConfig(), ownedIds, true));
	}
}
