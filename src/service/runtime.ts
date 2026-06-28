import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ccsyncConfigPath, ccsyncHome } from "../platform/paths.js";
import { apiFromConfig, createControlServer } from "./server.js";
import { createStaticHandler } from "./static.js";
import { ensureServiceToken } from "./token.js";

export function serviceUrlFile(homeDir: string = ccsyncHome()): string {
	return path.join(homeDir, "service-url");
}

export async function readServiceUrl(homeDir: string = ccsyncHome()): Promise<string | undefined> {
	try {
		const url = (await fs.readFile(serviceUrlFile(homeDir), "utf-8")).trim();
		return url || undefined;
	} catch {
		return undefined;
	}
}

export function openBrowser(url: string): void {
	const cmd =
		process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
	try {
		spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
	} catch {
		// non-fatal; user can open the URL manually
	}
}

/** True when a ccsync control service answers GET /api/state at `url`. */
export async function pingService(url: string, timeoutMs = 500): Promise<boolean> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(`${url}/api/state`, { signal: ctrl.signal });
		return res.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

function isPortAvailable(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = net.createServer();
		probe.once("error", () => resolve(false));
		probe.once("listening", () => probe.close(() => resolve(true)));
		probe.listen(port, "127.0.0.1");
	});
}

function probeFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});
}

function portOf(url: string): number | undefined {
	try {
		const p = Number(new URL(url).port);
		return p > 0 ? p : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Pick a stable loopback port: reuse the one persisted in `service-url` if it is
 * still free, otherwise probe a fresh free port. Probing once and persisting
 * keeps `service-url` (and the Vite dev proxy target) stable across runs.
 */
async function resolveStablePort(homeDir: string): Promise<number> {
	const saved = await readServiceUrl(homeDir);
	const savedPort = saved ? portOf(saved) : undefined;
	if (savedPort && (await isPortAvailable(savedPort))) return savedPort;
	return probeFreePort();
}

export async function startControlService(
	opts: { open?: boolean; port?: number } = {},
): Promise<{ url: string; close: () => Promise<void> }> {
	const token = await ensureServiceToken();
	const configPath = ccsyncConfigPath();
	const control = createControlServer({ token, configPath, apiFor: apiFromConfig });

	const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");
	const serveStatic = createStaticHandler({ uiDir, token });

	const server = http.createServer((req, res) => {
		if ((req.url ?? "/").startsWith("/api/")) {
			control.emit("request", req, res);
			return;
		}
		serveStatic(req, res);
	});

	const port = opts.port ?? (await resolveStablePort(ccsyncHome()));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", resolve);
	});
	const { port: boundPort } = server.address() as AddressInfo;
	const url = `http://127.0.0.1:${boundPort}`;
	await fs.mkdir(ccsyncHome(), { recursive: true });
	await fs.writeFile(serviceUrlFile(), url);
	if (opts.open) openBrowser(url);
	return {
		url,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
