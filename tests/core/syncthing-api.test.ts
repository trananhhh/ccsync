import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncthingApi } from "../../src/core/syncthing-api.js";

describe("SyncthingApi", () => {
	let originalFetch: typeof fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("sends API key header and parses JSON", async () => {
		globalThis.fetch = vi.fn(async (_url, opts) => {
			const headers = opts?.headers as Record<string, string>;
			expect(headers["X-API-Key"]).toBe("secret");
			return new Response(JSON.stringify({ myID: "ID123", uptime: 5, startTime: "now" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
		const api = new SyncthingApi({ apiKey: "secret", guiAddress: "127.0.0.1:8384" });
		const s = await api.systemStatus();
		expect(s.myID).toBe("ID123");
	});

	it("throws on non-2xx with body in error", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response("nope", { status: 401 }),
		) as typeof fetch;
		const api = new SyncthingApi({ apiKey: "x", guiAddress: "127.0.0.1:8384" });
		await expect(api.systemStatus()).rejects.toThrow(/401/);
	});

	it("ping returns true on success, false on failure", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
		) as typeof fetch;
		const api = new SyncthingApi({ apiKey: "x", guiAddress: "127.0.0.1:8384" });
		expect(await api.ping()).toBe(true);

		globalThis.fetch = vi.fn(async () =>
			new Response("", { status: 500 }),
		) as typeof fetch;
		expect(await api.ping()).toBe(false);
	});

	it("normalises GUI address with and without scheme", async () => {
		const seen: string[] = [];
		globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
			seen.push(url.toString());
			return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
		}) as typeof fetch;
		await new SyncthingApi({ apiKey: "x", guiAddress: "127.0.0.1:8384" }).systemStatus();
		await new SyncthingApi({ apiKey: "x", guiAddress: "http://other:9999/" }).systemStatus();
		expect(seen[0]).toMatch(/^http:\/\/127\.0\.0\.1:8384\//);
		expect(seen[1]).toMatch(/^http:\/\/other:9999\//);
	});
});
