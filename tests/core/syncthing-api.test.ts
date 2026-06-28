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
		globalThis.fetch = vi.fn(async () => new Response("nope", { status: 401 })) as typeof fetch;
		const api = new SyncthingApi({ apiKey: "x", guiAddress: "127.0.0.1:8384" });
		await expect(api.systemStatus()).rejects.toThrow(/401/);
	});

	it("ping returns true on success, false on failure", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
		) as typeof fetch;
		const api = new SyncthingApi({ apiKey: "x", guiAddress: "127.0.0.1:8384" });
		expect(await api.ping()).toBe(true);

		globalThis.fetch = vi.fn(async () => new Response("", { status: 500 })) as typeof fetch;
		expect(await api.ping()).toBe(false);
	});

	it("events() builds the long-poll query and parses the array", async () => {
		const seen: string[] = [];
		globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
			seen.push(url.toString());
			return new Response(JSON.stringify([{ id: 7, type: "StateChanged", time: "now" }]), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
		const api = new SyncthingApi({ apiKey: "x", guiAddress: "127.0.0.1:8384" });
		const events = await api.events({
			since: 5,
			timeout: 30,
			events: ["StateChanged", "FolderSummary"],
		});
		expect(events[0].id).toBe(7);
		expect(seen[0]).toContain("/rest/events?");
		expect(seen[0]).toContain("since=5");
		expect(seen[0]).toContain("timeout=30");
		expect(seen[0]).toContain("events=StateChanged%2CFolderSummary");
	});

	it("events() re-baselines with limit=1 and no since", async () => {
		const seen: string[] = [];
		globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
			seen.push(url.toString());
			return new Response(JSON.stringify([{ id: 42, type: "Starting", time: "now" }]), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
		const api = new SyncthingApi({ apiKey: "x", guiAddress: "127.0.0.1:8384" });
		await api.events({ limit: 1 });
		expect(seen[0]).toContain("limit=1");
		expect(seen[0]).not.toContain("since=");
	});

	it("completion() targets a folder and parses completion %", async () => {
		const seen: string[] = [];
		globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
			seen.push(url.toString());
			return new Response(JSON.stringify({ completion: 87.5, globalBytes: 100, needBytes: 12 }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
		const api = new SyncthingApi({ apiKey: "x", guiAddress: "127.0.0.1:8384" });
		const c = await api.completion("ccsync-claude-config-0");
		expect(c.completion).toBe(87.5);
		expect(seen[0]).toContain("/rest/db/completion?folder=ccsync-claude-config-0");
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
