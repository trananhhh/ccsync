import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { ccsyncConfigPath, ccsyncHome } from "../platform/paths.js";
import { apiFromConfig, createControlServer } from "./server.js";
import { ensureServiceToken } from "./token.js";
import { UI_PLACEHOLDER_HTML } from "./ui-placeholder.js";

export function serviceUrlFile(homeDir: string = ccsyncHome()): string {
	return path.join(homeDir, "service-url");
}

function openBrowser(url: string): void {
	const cmd =
		process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
	try {
		spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
	} catch {
		// non-fatal; user can open the URL manually
	}
}

export async function startControlService(
	opts: { open?: boolean; port?: number } = {},
): Promise<{ url: string; close: () => Promise<void> }> {
	const token = await ensureServiceToken();
	const configPath = ccsyncConfigPath();
	const control = createControlServer({ token, configPath, apiFor: apiFromConfig });

	const server = http.createServer((req, res) => {
		if (req.url === "/" || req.url === "/index.html") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(UI_PLACEHOLDER_HTML);
			return;
		}
		control.emit("request", req, res);
	});

	await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	const url = `http://127.0.0.1:${port}`;
	await fs.mkdir(ccsyncHome(), { recursive: true });
	await fs.writeFile(serviceUrlFile(), url);
	if (opts.open) openBrowser(url);
	return {
		url,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
