import { describe, expect, it } from "vitest";
import { decodeInvite, encodeInvite, encodeLegacyInvite } from "../../src/core/invite-token.js";

const ID = "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA";

describe("invite-token", () => {
	it("round-trips a token", () => {
		const enc = encodeInvite({ deviceId: ID, name: "macbook", introducer: true });
		expect(enc.startsWith("ccs2_")).toBe(true);
		const dec = decodeInvite(enc);
		expect(dec.deviceId).toBe(ID);
		expect(dec.name).toBe("macbook");
		expect(dec.introducer).toBe(true);
		expect(dec.version).toBe(1);
	});

	it("round-trips root profile metadata", () => {
		const enc = encodeInvite({
			deviceId: ID,
			name: "macbook",
			introducer: true,
			rootProfile: {
				id: "profile-a",
				canonicalRoot: "/Users/alice/work",
				codeFolders: [{ relativePath: "ccsync" }],
				projects: [{ relativePath: "ccsync" }],
				conversations: [
					{ encodedName: "-Users-alice-work-ccsync", relativePath: "ccsync" },
					{ encodedName: "-Users-alice-Downloads-scratch" },
				],
			},
		});
		const dec = decodeInvite(enc);

		expect(dec.rootProfile).toEqual({
			id: "profile-a",
			canonicalRoot: "/Users/alice/work",
			codeFolders: [{ relativePath: "ccsync" }],
			projects: [{ relativePath: "ccsync" }],
			conversations: [
				{ encodedName: "-Users-alice-work-ccsync", relativePath: "ccsync" },
				{ encodedName: "-Users-alice-Downloads-scratch" },
			],
		});
	});

	it("uses URL-safe base64 (no +/=)", () => {
		const enc = encodeInvite({ deviceId: ID, name: "x", introducer: false });
		expect(enc).not.toMatch(/[+/=]/);
	});

	it("keeps large root profile invites compact", () => {
		const rootProfile = {
			id: "profile-a",
			canonicalRoot: "/Users/alice/work",
			codeFolders: Array.from({ length: 20 }, (_, i) => ({ relativePath: `repo-${i}` })),
			projects: Array.from({ length: 20 }, (_, i) => ({ relativePath: `repo-${i}` })),
			conversations: Array.from({ length: 80 }, (_, i) => ({
				encodedName: `-Users-alice-work-repo-${i}`,
				relativePath: `repo-${i}`,
			})),
		};

		const compact = encodeInvite({ deviceId: ID, name: "macbook", introducer: true, rootProfile });
		const legacy = encodeLegacyInvite({
			deviceId: ID,
			name: "macbook",
			introducer: true,
			rootProfile,
		});

		expect(compact.length).toBeLessThan(legacy.length * 0.45);
		expect(decodeInvite(compact).rootProfile).toEqual(rootProfile);
	});

	it("decodes legacy ccs1 tokens", () => {
		const enc = encodeLegacyInvite({ deviceId: ID, name: "macbook", introducer: true });
		expect(enc.startsWith("ccs1_")).toBe(true);
		expect(decodeInvite(enc).deviceId).toBe(ID);
	});

	it("rejects tokens without prefix", () => {
		expect(() => decodeInvite("nope")).toThrow(/prefix/);
	});

	it("rejects malformed payload", () => {
		expect(() => decodeInvite("ccs1_aGVsbG8")).toThrow();
	});

	it("rejects missing required fields", () => {
		const bad =
			"ccs1_" +
			Buffer.from(JSON.stringify({ deviceId: ID, version: 1 }))
				.toString("base64")
				.replace(/=+$/, "");
		expect(() => decodeInvite(bad)).toThrow(/missing/);
	});
});
