import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ccsyncHome } from "../platform/paths.js";

export interface StoredInvite {
	id: string;
	issuedAt: string;
	expiresAt: string;
	maxUses: number;
	uses: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function storePath(): string {
	return path.join(ccsyncHome(), "pending-invites.json");
}

export async function listInvites(now: number = Date.now()): Promise<StoredInvite[]> {
	let raw: string;
	try {
		raw = await fs.readFile(storePath(), "utf-8");
	} catch {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const all = parsed as StoredInvite[];
	return all.filter((i) => Date.parse(i.expiresAt) > now && i.uses < i.maxUses);
}

export async function createInvite(
	now: number = Date.now(),
	ttlMs: number = DEFAULT_TTL_MS,
	maxUses = 1,
): Promise<StoredInvite> {
	const inv: StoredInvite = {
		id: `${now.toString(36)}-${Math.floor(now / 7).toString(36)}`,
		issuedAt: new Date(now).toISOString(),
		expiresAt: new Date(now + ttlMs).toISOString(),
		maxUses,
		uses: 0,
	};
	const all = await readAll();
	const live = all.filter((i) => Date.parse(i.expiresAt) > now);
	live.push(inv);
	await writeAll(live);
	return inv;
}

export async function consumeOne(now: number = Date.now()): Promise<StoredInvite | null> {
	const all = await readAll();
	const valid = all
		.filter((i) => Date.parse(i.expiresAt) > now && i.uses < i.maxUses)
		.sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
	if (valid.length === 0) return null;
	const target = valid[0];
	target.uses += 1;
	const updated = all.map((i) => (i.id === target.id ? target : i));
	await writeAll(updated);
	return target;
}

export async function clearAll(): Promise<void> {
	await writeAll([]);
}

async function readAll(): Promise<StoredInvite[]> {
	try {
		const raw = await fs.readFile(storePath(), "utf-8");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function writeAll(items: StoredInvite[]): Promise<void> {
	await fs.mkdir(ccsyncHome(), { recursive: true });
	await fs.writeFile(storePath(), JSON.stringify(items, null, 2), "utf-8");
}
