import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import type * as http from "node:http";
import * as path from "node:path";

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".txt": "text/plain; charset=utf-8",
};

export function mimeFor(filePath: string): string {
	return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Insert a classic (non-module) script declaring the service token right after
 * `<head>` so it runs before the deferred module bundle and is available to the
 * app's first fetch. Throws if `<head>` is absent rather than serving an
 * un-injected page — otherwise every POST 401s with a confusing cause.
 *
 * The token is hex (`token.ts` charset `[0-9a-f]`) so `JSON.stringify` cannot
 * break out of the script; keep that invariant if the token format ever changes.
 */
export function renderIndex(html: string, token: string): string {
	const marker = "<head>";
	const at = html.indexOf(marker);
	if (at === -1) {
		throw new Error("ui index.html missing <head> — cannot inject service token");
	}
	const script = `<script>window.__CCSYNC_TOKEN__=${JSON.stringify(token)}</script>`;
	const cut = at + marker.length;
	return html.slice(0, cut) + script + html.slice(cut);
}

export type StaticHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/**
 * Hand-rolled zero-dep static handler for the built SPA in `uiDir`.
 *
 * - reads + token-injects `index.html` once at startup (fail-loud)
 * - `/` and `/index.html` → the injected index
 * - existing files → served with a MIME type
 * - missing `/assets/*` → 404 (never fall back to HTML, which would be parsed
 *   as JS and throw a cryptic error in the browser)
 * - any other miss → injected index (SPA client-route fallback)
 */
export function createStaticHandler(opts: { uiDir: string; token: string }): StaticHandler {
	const root = path.resolve(opts.uiDir);
	const indexPath = path.join(root, "index.html");

	let rawIndex: string;
	try {
		rawIndex = fs.readFileSync(indexPath, "utf-8");
	} catch (err) {
		throw new Error(
			`ui build not found at ${indexPath} — run \`pnpm build\` first (${
				err instanceof Error ? err.message : String(err)
			})`,
		);
	}
	const indexHtml = renderIndex(rawIndex, opts.token);

	const sendIndex = (res: http.ServerResponse): void => {
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(indexHtml);
	};

	return (req, res) => {
		const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
		let decoded: string;
		try {
			// Malformed percent-escapes (e.g. `/%` or `/%E0%A4%A`) throw URIError;
			// the request callback has no try/catch, so an uncaught throw here would
			// crash the dashboard process. Reject with 400 instead.
			decoded = decodeURIComponent(pathname);
		} catch {
			res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
			res.end("bad request");
			return;
		}

		if (decoded === "/" || decoded === "/index.html") {
			sendIndex(res);
			return;
		}

		const filePath = path.join(root, decoded);
		const resolved = path.resolve(filePath);
		// Path-traversal guard: keep every served file inside the UI root.
		if (resolved !== root && !resolved.startsWith(root + path.sep)) {
			res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
			res.end("forbidden");
			return;
		}

		fsp.readFile(resolved).then(
			(buf) => {
				res.writeHead(200, { "Content-Type": mimeFor(resolved) });
				res.end(buf);
			},
			() => {
				// A missing asset must 404 — falling back to HTML would be served
				// as JS/CSS and fail to parse in the browser.
				if (decoded.startsWith("/assets/")) {
					res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
					res.end("not found");
					return;
				}
				sendIndex(res);
			},
		);
	};
}
