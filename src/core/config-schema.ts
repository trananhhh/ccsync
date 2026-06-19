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

export const PeerSchema = z.object({
	deviceId: z.string().regex(/^[A-Z2-7]{7}-[A-Z2-7]{7}-[A-Z2-7]{7}-[A-Z2-7]{7}-[A-Z2-7]{7}-[A-Z2-7]{7}-[A-Z2-7]{7}-[A-Z2-7]{7}$/),
	name: z.string().min(1),
	addresses: z.array(z.string()).default(["dynamic"]),
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
});

export type Config = z.infer<typeof ConfigSchema>;
