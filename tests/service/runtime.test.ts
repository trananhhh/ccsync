import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pingService, readServiceUrl, serviceUrlFile } from "../../src/service/runtime.js";

describe("serviceUrlFile", () => {
	it("lives under the ccsync home", () => {
		expect(serviceUrlFile("/tmp/cc")).toBe("/tmp/cc/service-url");
	});
});

describe("readServiceUrl", () => {
	let dir: string;

	afterEach(async () => {
		if (dir) await fs.rm(dir, { recursive: true, force: true });
	});

	it("returns undefined when no service-url has been persisted", async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-url-"));
		expect(await readServiceUrl(dir)).toBeUndefined();
	});

	it("returns the trimmed persisted url", async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-url-"));
		await fs.writeFile(serviceUrlFile(dir), "http://127.0.0.1:54321\n");
		expect(await readServiceUrl(dir)).toBe("http://127.0.0.1:54321");
	});
});

describe("pingService", () => {
	let server: http.Server | undefined;

	afterEach(async () => {
		if (server) await new Promise<void>((r) => server?.close(() => r()));
		server = undefined;
	});

	function serve(handler: http.RequestListener): Promise<string> {
		server = http.createServer(handler);
		return new Promise<string>((resolve) => {
			server?.listen(0, "127.0.0.1", () =>
				resolve(`http://127.0.0.1:${(server?.address() as AddressInfo).port}`),
			);
		});
	}

	it("is true when /api/state returns the configured marker", async () => {
		const base = await serve((_req, res) => {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ configured: false, machineName: "m" }));
		});
		expect(await pingService(base)).toBe(true);
	});

	it("is false when a squatter returns 200 without the configured marker", async () => {
		const base = await serve((_req, res) => {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end("{}");
		});
		expect(await pingService(base)).toBe(false);
	});

	it("is false when the body is not JSON", async () => {
		const base = await serve((_req, res) => {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end("<html>not us</html>");
		});
		expect(await pingService(base)).toBe(false);
	});

	it("is false when nothing is listening", async () => {
		// Port 1 is privileged/unused on loopback in test environments.
		expect(await pingService("http://127.0.0.1:1", 200)).toBe(false);
	});
});
