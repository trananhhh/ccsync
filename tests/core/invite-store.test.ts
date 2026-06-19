import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearAll, consumeOne, createInvite, listInvites } from "../../src/core/invite-store.js";

describe("invite-store", () => {
	let tmpHome: string;
	let originalHome: string | undefined;

	beforeEach(async () => {
		tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-inv-"));
		originalHome = process.env.HOME;
		process.env.HOME = tmpHome;
		await clearAll();
	});

	afterEach(async () => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		await fs.rm(tmpHome, { recursive: true, force: true });
	});

	it("creates and lists a live invite", async () => {
		await createInvite();
		const live = await listInvites();
		expect(live).toHaveLength(1);
		expect(live[0].uses).toBe(0);
		expect(live[0].maxUses).toBe(1);
	});

	it("excludes expired invites from list", async () => {
		const now = Date.now();
		await createInvite(now, 1000);
		const later = now + 5000;
		const live = await listInvites(later);
		expect(live).toEqual([]);
	});

	it("consumeOne increments uses and excludes invite once exhausted", async () => {
		await createInvite();
		const consumed = await consumeOne();
		expect(consumed).not.toBeNull();
		expect(consumed?.uses).toBe(1);
		expect(await listInvites()).toEqual([]);
	});

	it("consumeOne returns null when nothing valid", async () => {
		expect(await consumeOne()).toBeNull();
	});

	it("multi-use invite stays valid until exhausted", async () => {
		await createInvite(Date.now(), 60_000, 3);
		expect(await consumeOne()).not.toBeNull();
		expect(await consumeOne()).not.toBeNull();
		expect(await listInvites()).toHaveLength(1);
		expect(await consumeOne()).not.toBeNull();
		expect(await listInvites()).toEqual([]);
	});
});
