export interface Invite {
	deviceId: string;
	name: string;
	introducer: boolean;
	version: 1;
}

const PREFIX = "ccs1_";

export function encodeInvite(inv: Omit<Invite, "version">): string {
	const payload: Invite = { ...inv, version: 1 };
	const json = JSON.stringify(payload);
	const b64 = Buffer.from(json, "utf-8")
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	return PREFIX + b64;
}

export function decodeInvite(token: string): Invite {
	if (!token.startsWith(PREFIX)) {
		throw new Error(`Not a ccsync invite token (missing ${PREFIX} prefix)`);
	}
	const b64 = token.slice(PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
	const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
	let json: string;
	try {
		json = Buffer.from(padded, "base64").toString("utf-8");
	} catch {
		throw new Error("Invite token base64 decoding failed");
	}
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
		inv.version !== 1
	) {
		throw new Error("Invite token missing required fields");
	}
	return inv as Invite;
}
