import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStaticHandler, mimeFor, renderIndex } from "../../src/service/static.js";

const TOKEN = "deadbeef0123456789abcdef";

// Send a raw request line so a literal path (with `..` or a malformed escape)
// reaches the server unmodified — fetch() normalises/encodes these away.
function rawRequest(port: number, rawPath: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const sock = net.connect(port, "127.0.0.1", () => {
			sock.write(`GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
		});
		let raw = "";
		sock.setEncoding("utf-8");
		sock.on("data", (c) => {
			raw += c;
		});
		sock.on("error", reject);
		sock.on("end", () => {
			const status = Number(raw.match(/^HTTP\/1\.1 (\d{3})/)?.[1] ?? 0);
			const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
			resolve({ status, body });
		});
	});
}

describe("renderIndex", () => {
	it("injects the token right after <head>", () => {
		const out = renderIndex("<!doctype html><html><head><title>x</title></head></html>", TOKEN);
		expect(out).toContain(`<head><script>window.__CCSYNC_TOKEN__="${TOKEN}"</script>`);
	});

	it("throws when <head> is absent rather than serving un-injected html", () => {
		expect(() => renderIndex("<html><body>no head</body></html>", TOKEN)).toThrow(/<head>/);
	});
});

describe("mimeFor", () => {
	it("maps known extensions", () => {
		expect(mimeFor("/assets/app.js")).toBe("text/javascript; charset=utf-8");
		expect(mimeFor("/assets/app.css")).toBe("text/css; charset=utf-8");
		expect(mimeFor("/favicon.svg")).toBe("image/svg+xml");
	});

	it("falls back to octet-stream for unknown extensions", () => {
		expect(mimeFor("/weird.xyz")).toBe("application/octet-stream");
	});
});

describe("createStaticHandler", () => {
	let dir: string;
	let server: http.Server;
	let base: string;

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-static-"));
		await fs.writeFile(
			path.join(dir, "index.html"),
			"<!doctype html><html><head><title>ccsync</title></head><body></body></html>",
		);
		await fs.mkdir(path.join(dir, "assets"));
		await fs.writeFile(path.join(dir, "assets", "app.js"), "console.log('hi')");

		const handle = createStaticHandler({ uiDir: dir, token: TOKEN });
		server = http.createServer(handle);
		base = await new Promise<string>((resolve) => {
			server.listen(0, "127.0.0.1", () => {
				resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
			});
		});
	});

	afterEach(async () => {
		await new Promise<void>((r) => server.close(() => r()));
		await fs.rm(dir, { recursive: true, force: true });
	});

	it("serves the token-injected index at /", async () => {
		const res = await fetch(`${base}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		expect(await res.text()).toContain(`window.__CCSYNC_TOKEN__="${TOKEN}"`);
	});

	it("serves existing assets with the right MIME", async () => {
		const res = await fetch(`${base}/assets/app.js`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/javascript");
		expect(await res.text()).toContain("console.log");
	});

	it("404s a missing asset instead of serving HTML as JS", async () => {
		const res = await fetch(`${base}/assets/missing.js`);
		expect(res.status).toBe(404);
	});

	it("falls back to index.html for unknown client routes", async () => {
		const res = await fetch(`${base}/some/deep/route`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		expect(await res.text()).toContain("window.__CCSYNC_TOKEN__");
	});

	it("blocks path traversal that escapes the ui root", async () => {
		// A secret one level above the served root. Encoding both the dots and the
		// slash (%2e%2e%2f) keeps the `..` segment past WHATWG URL normalisation, so
		// only the handler's own guard can stop it; a raw socket keeps the literal
		// path that fetch() would have rewritten.
		const secret = path.join(os.tmpdir(), `ccsync-secret-${process.pid}-${Date.now()}.txt`);
		await fs.writeFile(secret, "TOP-SECRET");
		try {
			const port = (server.address() as AddressInfo).port;
			const res = await rawRequest(port, `/%2e%2e%2f${path.basename(secret)}`);
			expect(res.status).toBe(403);
			expect(res.body).not.toContain("TOP-SECRET");
		} finally {
			await fs.rm(secret, { force: true });
		}
	});

	it("returns 400 on a malformed percent-escape without crashing the server", async () => {
		const port = (server.address() as AddressInfo).port;
		const res = await rawRequest(port, "/%E0%A4%A");
		expect(res.status).toBe(400);
		// The server is still alive — a normal request after the bad one succeeds.
		const ok = await fetch(`${base}/`);
		expect(ok.status).toBe(200);
	});

	it("throws at construction when index.html lacks <head>", async () => {
		const bad = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-bad-"));
		await fs.writeFile(path.join(bad, "index.html"), "<html><body>no head</body></html>");
		expect(() => createStaticHandler({ uiDir: bad, token: TOKEN })).toThrow(/<head>/);
		await fs.rm(bad, { recursive: true, force: true });
	});

	it("throws at construction when the build is missing", () => {
		expect(() => createStaticHandler({ uiDir: "/no/such/ui/dir", token: TOKEN })).toThrow(
			/ui build not found/,
		);
	});
});
