import type { Bucket, Peer } from "./config-schema.js";
import type { SyncthingDevice, SyncthingFolder } from "./syncthing-api.js";

export interface BuildFoldersInput {
	machineName: string;
	myDeviceId: string;
	buckets: Record<string, Bucket>;
	peers: Peer[];
}

export function bucketToFolders(
	bucketName: string,
	bucket: Bucket,
	devices: string[],
): SyncthingFolder[] {
	if (!bucket.enabled || bucket.paths.length === 0) return [];
	return bucket.paths.map((p, idx) => ({
		id: `ccsync-${bucketName}-${idx}`,
		label: `${bucketName}: ${p}`,
		path: p,
		type: "sendreceive",
		devices: devices.map((d) => ({ deviceID: d })),
		versioning: versioningParams(bucket.versioning),
		ignorePerms: true,
		rescanIntervalS: 3600,
		fsWatcherEnabled: true,
	}));
}

function versioningParams(v: Bucket["versioning"]) {
	if (v.type === "none") return undefined;
	return {
		type: v.type,
		params: { keep: String(v.keep) },
	};
}

export function buildFolders(input: BuildFoldersInput): SyncthingFolder[] {
	const deviceIds = [input.myDeviceId, ...input.peers.map((p) => p.deviceId)];
	const out: SyncthingFolder[] = [];
	for (const [name, bucket] of Object.entries(input.buckets)) {
		out.push(...bucketToFolders(name, bucket, deviceIds));
	}
	return out;
}

export function buildDevices(myDeviceId: string, machineName: string, peers: Peer[]): SyncthingDevice[] {
	const self: SyncthingDevice = {
		deviceID: myDeviceId,
		name: machineName,
		addresses: ["dynamic"],
		compression: "metadata",
	};
	const remotes: SyncthingDevice[] = peers.map((p) => ({
		deviceID: p.deviceId,
		name: p.name,
		addresses: p.addresses,
		compression: "metadata",
	}));
	return [self, ...remotes];
}
