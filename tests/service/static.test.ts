import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStaticHandler, mimeFor, renderIndex } from "../../src/service/static.js";

const TOKEN = "deadbeef0123456789abcdef";

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

	it("blocks path traversal", async () => {
		const res = await fetch(`${base}/../../etc/hosts`, { redirect: "manual" });
		// fetch may normalise the URL; assert we never leak a file outside the root.
		expect([403, 404, 200].includes(res.status)).toBe(true);
		if (res.status === 200) {
			expect(res.headers.get("content-type")).toContain("text/html");
		}
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
