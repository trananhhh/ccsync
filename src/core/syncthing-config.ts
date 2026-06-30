import type { Bucket, Config, Peer, RootProfile } from "./config-schema.js";
import { registryFolder } from "./machine-registry.js";
import {
	localProjectPath,
	rootCodeFolderId,
	rootCodeFolders,
	rootConversationFolderId,
	rootConversationPath,
	rootConversations,
} from "./root-profile.js";
import type { SyncthingDevice, SyncthingFolder } from "./syncthing-api.js";
import { isLegacySingleFileBucketPath } from "./syncthing-folder-paths.js";

export interface BuildFoldersInput {
	machineName: string;
	myDeviceId: string;
	buckets: Record<string, Bucket>;
	peers: Peer[];
	rootProfile?: RootProfile;
}

export function bucketToFolders(
	bucketName: string,
	bucket: Bucket,
	devices: string[],
): SyncthingFolder[] {
	if (!bucket.enabled || bucket.paths.length === 0) return [];
	return bucket.paths.flatMap((p, idx) => {
		if (isLegacySingleFileBucketPath(p)) return [];
		return [
			{
				id: `ccsync-${bucketName}-${idx}`,
				label: `${bucketName}: ${p}`,
				path: p,
				type: "sendreceive" as const,
				devices: devices.map((d) => ({ deviceID: d })),
				versioning: versioningParams(bucket.versioning),
				ignorePerms: true,
				rescanIntervalS: 3600,
				fsWatcherEnabled: true,
			},
		];
	});
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
	if (input.rootProfile) {
		out.push(...rootProfileToFolders(input.rootProfile, input.buckets, deviceIds));
	}
	for (const [name, bucket] of Object.entries(input.buckets)) {
		if (input.rootProfile && (name === "code-root" || name === "claude-conversations")) {
			continue;
		}
		out.push(...bucketToFolders(name, bucket, deviceIds));
	}
	// Always sync the cross-machine registry (infrastructure, not a user bucket).
	out.push(registryFolder(deviceIds));
	return out;
}

function rootProfileToFolders(
	profile: RootProfile,
	buckets: Record<string, Bucket>,
	devices: string[],
): SyncthingFolder[] {
	const out: SyncthingFolder[] = [];
	const rootBucket = buckets["code-root"];
	if (rootBucket?.enabled) {
		for (const folder of rootCodeFolders(profile)) {
			out.push(
				folderFromBucket(
					rootCodeFolderId(profile, folder.relativePath),
					`code-root: ${folder.relativePath}`,
					localProjectPath(profile, folder.relativePath),
					rootBucket,
					devices,
				),
			);
		}
	}

	const conversationBucket = buckets["claude-conversations"];
	if (conversationBucket?.enabled) {
		for (const conversation of rootConversations(profile)) {
			out.push(
				folderFromBucket(
					rootConversationFolderId(profile, conversation),
					`claude-conversations: ${conversation.relativePath ?? conversation.encodedName}`,
					rootConversationPath(profile, conversation),
					conversationBucket,
					devices,
				),
			);
		}
	}

	return out;
}

function folderFromBucket(
	id: string,
	label: string,
	folderPath: string,
	bucket: Bucket,
	devices: string[],
): SyncthingFolder {
	return {
		id,
		label,
		path: folderPath,
		type: "sendreceive",
		devices: devices.map((d) => ({ deviceID: d })),
		versioning: versioningParams(bucket.versioning),
		ignorePerms: true,
		rescanIntervalS: 3600,
		fsWatcherEnabled: true,
	};
}

/**
 * Map every ccsync-owned folder id to the config bucket that owns it. Mirrors
 * `buildFolders` exactly so the id forms round-trip without lossy string parsing
 * (bucket names contain hyphens, so splitting `ccsync-<bucket>-<idx>` is unsafe).
 */
export function folderIdBucketMap(input: {
	buckets: Record<string, Bucket>;
	rootProfile?: RootProfile;
}): Map<string, string> {
	const map = new Map<string, string>();
	const { buckets, rootProfile } = input;

	if (rootProfile) {
		const rootBucket = buckets["code-root"];
		if (rootBucket?.enabled) {
			for (const folder of rootCodeFolders(rootProfile)) {
				map.set(rootCodeFolderId(rootProfile, folder.relativePath), "code-root");
			}
		}
		const conversationBucket = buckets["claude-conversations"];
		if (conversationBucket?.enabled) {
			for (const conversation of rootConversations(rootProfile)) {
				map.set(rootConversationFolderId(rootProfile, conversation), "claude-conversations");
			}
		}
	}

	for (const [name, bucket] of Object.entries(buckets)) {
		if (rootProfile && (name === "code-root" || name === "claude-conversations")) continue;
		if (!bucket.enabled || bucket.paths.length === 0) continue;
		bucket.paths.forEach((p, idx) => {
			if (isLegacySingleFileBucketPath(p)) return;
			map.set(`ccsync-${name}-${idx}`, name);
		});
	}

	return map;
}

/** Resolve the owning bucket/project name for a Syncthing folder id, or undefined. */
export function bucketForFolderId(id: string, cfg: Config): string | undefined {
	return folderIdBucketMap({ buckets: cfg.buckets, rootProfile: cfg.rootProfile }).get(id);
}

export function buildDevices(
	myDeviceId: string,
	machineName: string,
	peers: Peer[],
): SyncthingDevice[] {
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
		introducer: p.introducer,
		autoAcceptFolders: true,
	}));
	return [self, ...remotes];
}
