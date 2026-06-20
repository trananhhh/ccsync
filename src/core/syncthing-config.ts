import type { Bucket, Peer, RootProfile } from "./config-schema.js";
import {
	localProjectPath,
	rootCodeFolderId,
	rootCodeFolders,
	rootConversationFolderId,
	rootConversationPath,
	rootConversations,
} from "./root-profile.js";
import type { SyncthingDevice, SyncthingFolder } from "./syncthing-api.js";

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
	if (input.rootProfile) {
		out.push(...rootProfileToFolders(input.rootProfile, input.buckets, deviceIds));
	}
	for (const [name, bucket] of Object.entries(input.buckets)) {
		if (input.rootProfile && (name === "code-root" || name === "claude-conversations")) {
			continue;
		}
		out.push(...bucketToFolders(name, bucket, deviceIds));
	}
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
