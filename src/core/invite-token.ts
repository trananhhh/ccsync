import { deflateRawSync, inflateRawSync } from "node:zlib";

export interface Invite {
	deviceId: string;
	name: string;
	introducer: boolean;
	rootProfile?: InviteRootProfile;
	version: 1;
}

export interface InviteRootProfile {
	id: string;
	canonicalRoot: string;
	codeFolders?: Array<{ relativePath: string }>;
	projects: Array<{ relativePath: string }>;
	conversations?: Array<{ encodedName: string; relativePath?: string }>;
}

const LEGACY_PREFIX = "ccs1_";
const PREFIX = "ccs2_";

export function encodeInvite(inv: Omit<Invite, "version">): string {
	const payload: Invite = { ...inv, version: 1 };
	const json = JSON.stringify(payload);
	return PREFIX + base64UrlEncode(deflateRawSync(Buffer.from(json, "utf-8")));
}

export function encodeLegacyInvite(inv: Omit<Invite, "version">): string {
	const payload: Invite = { ...inv, version: 1 };
	return LEGACY_PREFIX + base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf-8"));
}

export function decodeInvite(token: string): Invite {
	if (token.startsWith(PREFIX)) {
		return parseInviteJson(inflateTokenBody(token.slice(PREFIX.length)));
	}
	if (token.startsWith(LEGACY_PREFIX)) {
		return parseInviteJson(decodeLegacyTokenBody(token.slice(LEGACY_PREFIX.length)));
	}
	throw new Error(`Not a ccsync invite token (missing ${PREFIX} or ${LEGACY_PREFIX} prefix)`);
}

function inflateTokenBody(body: string): string {
	try {
		return inflateRawSync(base64UrlDecode(body)).toString("utf-8");
	} catch {
		throw new Error("Invite token compressed body decoding failed");
	}
}

function decodeLegacyTokenBody(body: string): string {
	return base64UrlDecode(body).toString("utf-8");
}

function parseInviteJson(json: string): Invite {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error("Invite token body is not valid JSON");
	}
	const inv = parsed as Partial<Invite>;
	if (
		typeof inv.deviceId !== "string" ||
		typeof inv.name !== "string" ||
		typeof inv.introducer !== "boolean" ||
		(inv.rootProfile !== undefined && !isInviteRootProfile(inv.rootProfile)) ||
		inv.version !== 1
	) {
		throw new Error("Invite token missing required fields");
	}
	return inv as Invite;
}

function base64UrlEncode(buffer: Buffer): string {
	return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Buffer {
	try {
		const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
		const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
		return Buffer.from(padded, "base64");
	} catch {
		throw new Error("Invite token base64 decoding failed");
	}
}

function isInviteRootProfile(value: unknown): value is InviteRootProfile {
	if (!value || typeof value !== "object") return false;
	const profile = value as Partial<InviteRootProfile>;
	return (
		typeof profile.id === "string" &&
		typeof profile.canonicalRoot === "string" &&
		(profile.codeFolders === undefined ||
			(Array.isArray(profile.codeFolders) &&
				profile.codeFolders.every((folder) => typeof folder?.relativePath === "string"))) &&
		Array.isArray(profile.projects) &&
		profile.projects.every((project) => typeof project?.relativePath === "string") &&
		(profile.conversations === undefined ||
			(Array.isArray(profile.conversations) &&
				profile.conversations.every(
					(conversation) =>
						typeof conversation?.encodedName === "string" &&
						(conversation.relativePath === undefined ||
							typeof conversation.relativePath === "string"),
				)))
	);
}
