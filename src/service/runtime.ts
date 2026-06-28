import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "../core/config-io.js";
import { ccsyncConfigPath, ccsyncHome } from "../platform/paths.js";
import { apiFromConfig, createControlServer } from "./server.js";
import { createStaticHandler } from "./static.js";
import { SyncMonitor } from "./sync-monitor.js";
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

	// One shared monitor drives the SSE feed for every client. Only start it when
	// Syncthing is configured; without it the /api/events route returns 503.
	const cfg = await readConfig(configPath).catch(() => undefined);
	let monitor: SyncMonitor | undefined;
	if (cfg?.syncthing) {
		monitor = new SyncMonitor({ api: apiFromConfig(cfg), configPath });
		monitor.start();
	}

	// Lazily start the monitor once a config is written at runtime (browser
	// onboarding creates one on a fresh machine), so the SSE feed comes alive
	// without restarting the service. Idempotent — returns the running monitor.
	async function ensureMonitor(): Promise<SyncMonitor | undefined> {
		if (monitor) return monitor;
		const fresh = await readConfig(configPath).catch(() => undefined);
		if (!fresh?.syncthing) return undefined;
		monitor = new SyncMonitor({ api: apiFromConfig(fresh), configPath });
		monitor.start();
		return monitor;
	}

	const control = createControlServer({
		token,
		configPath,
		apiFor: apiFromConfig,
		monitor,
		ensureMonitor,
	});

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
		close: async () => {
			await monitor?.stop();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
