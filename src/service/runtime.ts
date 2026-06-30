import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "../core/config-io.js";
import type { Config } from "../core/config-schema.js";
import { createConflictCounter } from "../core/conflicts-scanner.js";
import { writeMachineInfo } from "../core/machine-registry.js";
import { ccsyncConfigPath, ccsyncHome } from "../platform/paths.js";
import { apiFromConfig, createControlServer } from "./server.js";
import { createStaticHandler } from "./static.js";
import { SyncMonitor } from "./sync-monitor.js";
import { ensureServiceToken } from "./token.js";

export function serviceUrlFile(homeDir: string = ccsyncHome()): string {
	return path.join(homeDir, "service-url");
}

/** Best-effort: stamp this machine's info into the synced registry. */
async function publishMachineInfo(cfg: Config): Promise<void> {
	try {
		const { myID } = await apiFromConfig(cfg).systemStatus();
		await writeMachineInfo(cfg, myID);
	} catch {
		// daemon not up yet or registry unwritable — visibility data only
	}
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

/**
 * True when a *ccsync* control service answers GET /api/state at `url`. A bare
 * 200 isn't enough — some other process could be squatting the persisted port —
 * so the body must parse as JSON and carry the stable `configured: boolean`
 * marker that every /api/state response returns. Any parse failure or missing
 * marker is treated as "not our service".
 */
export async function pingService(url: string, timeoutMs = 500): Promise<boolean> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(`${url}/api/state`, { signal: ctrl.signal });
		if (!res.ok) return false;
		const body = (await res.json()) as { configured?: unknown };
		return typeof body.configured === "boolean";
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

function isAddrInUse(err: unknown): boolean {
	return (err as NodeJS.ErrnoException | undefined)?.code === "EADDRINUSE";
}

/** Listen on `port`, resolving on "listening" and rejecting on "error" — with
 * the paired listeners cleaned up so a later attempt can re-listen cleanly. */
function listenOnce(server: http.Server, port: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const onError = (err: Error) => {
			server.removeListener("listening", onListening);
			reject(err);
		};
		const onListening = () => {
			server.removeListener("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, "127.0.0.1");
	});
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
	//
	// Note: the monitor binds an api handle from this config snapshot. If a CLI
	// `migrate` to the dedicated home runs while this service is live, that handle
	// keeps pointing at the now-stopped old daemon until the service restarts;
	// SyncMonitor degrades gracefully (its polls fail and it rebaselines) rather
	// than crashing, but the live feed is stale until a restart picks up the new
	// homeDir/apiKey.
	// One cached counter shared by every monitor instance so a `migrate`-driven
	// rebuild keeps the warm cache instead of re-walking the tree from scratch.
	const countConflicts = createConflictCounter();
	const cfg = await readConfig(configPath).catch(() => undefined);
	let monitor: SyncMonitor | undefined;
	if (cfg?.syncthing) {
		monitor = new SyncMonitor({ api: apiFromConfig(cfg), configPath, countConflicts });
		monitor.start();
		// Publish this machine into the synced registry so peers can show its code
		// roots. Fire-and-forget — visibility data must never block service start.
		void publishMachineInfo(cfg);
	}

	// Lazily start the monitor once a config is written at runtime (browser
	// onboarding creates one on a fresh machine), so the SSE feed comes alive
	// without restarting the service. Idempotent — returns the running monitor.
	async function ensureMonitor(): Promise<SyncMonitor | undefined> {
		if (monitor) return monitor;
		const fresh = await readConfig(configPath).catch(() => undefined);
		if (!fresh?.syncthing) return undefined;
		monitor = new SyncMonitor({ api: apiFromConfig(fresh), configPath, countConflicts });
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

	// resolveStablePort probes for a free port, but another process can grab it in
	// the gap before listen (a TOCTOU race). On EADDRINUSE re-probe a fresh port
	// and retry — unless the caller pinned an explicit port, in which case the
	// failure is intentional and propagates.
	let port = opts.port ?? (await resolveStablePort(ccsyncHome()));
	const maxAttempts = 3;
	for (let attempt = 1; ; attempt++) {
		try {
			await listenOnce(server, port);
			break;
		} catch (err) {
			if (opts.port === undefined && isAddrInUse(err) && attempt < maxAttempts) {
				port = await probeFreePort();
				continue;
			}
			throw err;
		}
	}
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
