import { z } from "zod";

export const BucketSchema = z.object({
	enabled: z.boolean().default(true),
	paths: z.array(z.string()).default([]),
	ignore: z.array(z.string()).default([]),
	versioning: z
		.object({
			type: z.enum(["simple", "staggered", "trashcan", "none"]).default("simple"),
			keep: z.number().int().min(0).default(10),
		})
		.default({ type: "simple", keep: 10 }),
});

export type Bucket = z.infer<typeof BucketSchema>;

export const RootProjectSchema = z.object({
	relativePath: z.string().min(1),
});

export type RootProject = z.infer<typeof RootProjectSchema>;

export const RootCodeFolderSchema = z.object({
	relativePath: z.string().min(1),
});

export type RootCodeFolder = z.infer<typeof RootCodeFolderSchema>;

export const RootConversationSchema = z.object({
	encodedName: z.string().min(1),
	relativePath: z.string().min(1).optional(),
});

export type RootConversation = z.infer<typeof RootConversationSchema>;

export const RootProfileSchema = z.object({
	id: z.string().min(1),
	canonicalRoot: z.string().min(1),
	localRoot: z.string().min(1),
	conversationMode: z.enum(["direct", "symlink", "mirror"]).default("direct"),
	codeFolders: z.array(RootCodeFolderSchema).default([]),
	projects: z.array(RootProjectSchema).default([]),
	conversations: z.array(RootConversationSchema).default([]),
});

export type RootProfile = z.infer<typeof RootProfileSchema>;

export const PeerSchema = z.object({
	deviceId: z
		.string()
		.regex(
			/^[A-Z2-7]{7}-[A-Z2-7]{7}-[A-Z2-7]{7}-[A-Z2-7]{7}-[A-Z2-7]{7}-[A-Z2-7]{7}-[A-Z2-7]{7}-[A-Z2-7]{7}$/,
		),
	name: z.string().min(1),
	addresses: z.array(z.string()).default(["dynamic"]),
	introducer: z.boolean().default(false),
});

export type Peer = z.infer<typeof PeerSchema>;

export const ConfigSchema = z.object({
	machineName: z.string().min(1),
	syncthing: z
		.object({
			apiKey: z.string().min(1),
			guiAddress: z.string().default("127.0.0.1:8384"),
			homeDir: z.string().min(1),
		})
		.optional(),
	peers: z.array(PeerSchema).default([]),
	buckets: z.record(z.string(), BucketSchema).default({}),
	globalIgnore: z.array(z.string()).default([]),
	metered: z.boolean().default(false),
	/**
	 * "realtime" (the default when unset): Syncthing propagates changes
	 * continuously. "manual": owned devices stay paused so nothing transfers until
	 * an explicit `ccsync sync` (resume → wait for 100% → pause again). Left
	 * optional so older configs read back as undefined and are treated as realtime.
	 */
	syncMode: z.enum(["realtime", "manual"]).optional(),
	rootProfile: RootProfileSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
