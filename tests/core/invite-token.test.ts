import { describe, expect, it } from "vitest";
import { decodeInvite, encodeInvite } from "../../src/core/invite-token.js";

const ID = "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA";

describe("invite-token", () => {
	it("round-trips a token", () => {
		const enc = encodeInvite({ deviceId: ID, name: "macbook", introducer: true });
		expect(enc.startsWith("ccs1_")).toBe(true);
		const dec = decodeInvite(enc);
		expect(dec.deviceId).toBe(ID);
		expect(dec.name).toBe("macbook");
		expect(dec.introducer).toBe(true);
		expect(dec.version).toBe(1);
	});

	it("uses URL-safe base64 (no +/=)", () => {
		const enc = encodeInvite({ deviceId: ID, name: "x", introducer: false });
		expect(enc).not.toMatch(/[+/=]/);
	});

	it("rejects tokens without prefix", () => {
		expect(() => decodeInvite("nope")).toThrow(/prefix/);
	});

	it("rejects malformed payload", () => {
		expect(() => decodeInvite("ccs1_aGVsbG8")).toThrow();
	});

	it("rejects missing required fields", () => {
		const bad = "ccs1_" + Buffer.from(JSON.stringify({ deviceId: ID, version: 1 })).toString("base64").replace(/=+$/, "");
		expect(() => decodeInvite(bad)).toThrow(/missing/);
	});
});
