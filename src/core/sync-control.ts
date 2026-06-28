import type { SyncthingApi, SyncthingConfig } from "./syncthing-api.js";

export function pauseAllTransfers(config: SyncthingConfig): SyncthingConfig {
	return { ...config, devices: config.devices.map((d) => ({ ...d, paused: true })) };
}

export function resumeAllTransfers(config: SyncthingConfig): SyncthingConfig {
	return { ...config, devices: config.devices.map((d) => ({ ...d, paused: false })) };
}

export function setFolderPaused(
	config: SyncthingConfig,
	folderId: string,
	paused: boolean,
): SyncthingConfig {
	return {
		...config,
		folders: config.folders.map((f) => (f.id === folderId ? { ...f, paused } : f)),
	};
}

export async function applyPause(
	api: SyncthingApi,
	action: "pause-all" | "resume-all",
): Promise<void> {
	const config = await api.getConfig();
	const next = action === "pause-all" ? pauseAllTransfers(config) : resumeAllTransfers(config);
	await api.putConfig(next);
}

export async function applyFolderPause(
	api: SyncthingApi,
	folderId: string,
	paused: boolean,
): Promise<void> {
	const config = await api.getConfig();
	await api.putConfig(setFolderPaused(config, folderId, paused));
}
