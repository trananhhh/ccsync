import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { run, spawnDetached, which } from "../lib/exec.js";
import { probeFreePort } from "./free-port.js";
import { SyncthingApi } from "./syncthing-api.js";

export interface SyncthingIdentity {
	apiKey: string;
	guiAddress: string;
}

export async function generateHome(homeDir: string): Promise<void> {
	try {
		await fs.access(path.join(homeDir, "config.xml"));
		return;
	} catch {}
	await fs.mkdir(homeDir, { recursive: true });
	await run("syncthing", ["generate", `--home=${homeDir}`]);
}

/**
 * Parse the pre-start identity from config.xml. We only read what's needed to
 * make the first REST call — the API key and GUI address. The device ID is NOT
 * parsed here; it is read post-start from `GET /rest/system/status.myID`.
 */
export async function readIdentity(homeDir: string): Promise<SyncthingIdentity> {
	const xml = await fs.readFile(path.join(homeDir, "config.xml"), "utf-8");
	const apiKey = matchOne(xml, /<apikey>([^<]+)<\/apikey>/);
	const guiAddress = matchOne(xml, /<gui[^>]*>[\s\S]*?<address>([^<]+)<\/address>/);
	return { apiKey, guiAddress };
}

function matchOne(text: string, re: RegExp): string {
	const m = text.match(re);
	if (!m) throw new Error(`config.xml missing expected field for pattern ${re}`);
	return m[1];
}

/**
 * Rewrite the `<gui><address>` in a home's config.xml. Targets only the address
 * inside the `<gui>` block (the first `<address>` after `<gui …>`), leaving the
 * device `<address>dynamic</address>` entries untouched.
 */
export async function setGuiAddress(homeDir: string, guiAddress: string): Promise<void> {
	const cfgPath = path.join(homeDir, "config.xml");
	const xml = await fs.readFile(cfgPath, "utf-8");
	const re = /(<gui[^>]*>[\s\S]*?<address>)[^<]*(<\/address>)/;
	if (!re.test(xml)) {
		throw new Error("config.xml: could not locate <gui><address> to set");
	}
	await fs.writeFile(cfgPath, xml.replace(re, `$1${guiAddress}$2`), "utf-8");
}

/** Read the device ID from the running daemon via REST (`status.myID`). */
export async function fetchDeviceId(guiAddress: string, apiKey: string): Promise<string> {
	const api = new SyncthingApi({ guiAddress, apiKey });
	const status = await api.systemStatus();
	return status.myID;
}

export async function startDaemon(homeDir: string): Promise<number> {
	const syncthing = await which("syncthing");
	if (!syncthing) throw new Error("syncthing binary not found on PATH");
	return spawnDetached(syncthing, ["serve", `--home=${homeDir}`, "--no-browser", "--no-restart"]);
}

/** A handle over a spawned `syncthing serve` child used during fresh bootstrap. */
export interface DaemonHandle {
	pid: number;
	/** Resolves when the child exits (used to detect early bind failure). */
	exited: Promise<void>;
	/** Detach the child so it keeps running after we stop tracking it. */
	release(): void;
	/** Best-effort terminate (used before retrying on a fresh port). */
	kill(): void;
}

async function spawnDaemonHandle(homeDir: string): Promise<DaemonHandle> {
	const syncthing = await which("syncthing");
	if (!syncthing) throw new Error("syncthing binary not found on PATH");
	const child = spawn(syncthing, ["serve", `--home=${homeDir}`, "--no-browser", "--no-restart"], {
		detached: true,
		stdio: "ignore",
	});
	const exited = new Promise<void>((resolve) => {
		child.once("exit", () => resolve());
		child.once("error", () => resolve());
	});
	return {
		pid: child.pid ?? -1,
		exited,
		release: () => child.unref(),
		kill: () => {
			try {
				child.kill();
			} catch {
				// already gone
			}
		},
	};
}

export interface BootstrapFreshHomeResult extends SyncthingIdentity {
	deviceId: string;
	pid: number;
}

export interface BootstrapFreshHomeOptions {
	host?: string;
	maxRetries?: number;
	timeoutMs?: number;
	pollMs?: number;
	generate?: (homeDir: string) => Promise<void>;
	probePort?: (host: string) => Promise<number>;
	writeGuiAddress?: (homeDir: string, guiAddress: string) => Promise<void>;
	readApiKey?: (homeDir: string) => Promise<string>;
	start?: (homeDir: string) => Promise<DaemonHandle>;
	check?: (guiAddress: string) => Promise<boolean>;
	fetchDeviceId?: (guiAddress: string, apiKey: string) => Promise<string>;
}

/**
 * Bootstrap a FRESH dedicated home end-to-end: generate (if needed), probe ONE
 * free loopback port, write it into config.xml's `<gui><address>`, start the
 * daemon, and read the device ID from REST. If `serve` fails to bind the chosen
 * port (free-port TOCTOU), re-probe a new port, rewrite config.xml, and retry
 * (capped). Returns the final identity — the caller persists it to config.yaml.
 */
export async function bootstrapFreshHome(
	homeDir: string,
	opts: BootstrapFreshHomeOptions = {},
): Promise<BootstrapFreshHomeResult> {
	const host = opts.host ?? "127.0.0.1";
	const maxRetries = opts.maxRetries ?? 3;
	const timeoutMs = opts.timeoutMs ?? 15_000;
	const pollMs = opts.pollMs ?? 500;
	const generate = opts.generate ?? generateHome;
	const probePort = opts.probePort ?? probeFreePort;
	const writeGui = opts.writeGuiAddress ?? setGuiAddress;
	const readKey = opts.readApiKey ?? readApiKeyFromHome;
	const start = opts.start ?? spawnDaemonHandle;
	const check = opts.check ?? isDaemonRunning;
	const fetchId = opts.fetchDeviceId ?? fetchDeviceId;

	await generate(homeDir);
	const apiKey = await readKey(homeDir);

	let lastError: Error | undefined;
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		const port = await probePort(host);
		const guiAddress = `${host}:${port}`;
		await writeGui(homeDir, guiAddress);

		const proc = await start(homeDir);
		let exitedEarly = false;
		void proc.exited.then(() => {
			exitedEarly = true;
		});

		const deadline = Date.now() + timeoutMs;
		let reachable = false;
		while (Date.now() < deadline && !exitedEarly) {
			if (await check(guiAddress)) {
				reachable = true;
				break;
			}
			await sleep(pollMs);
		}

		if (reachable) {
			proc.release();
			const deviceId = await fetchId(guiAddress, apiKey);
			return { apiKey, guiAddress, deviceId, pid: proc.pid };
		}

		proc.kill();
		lastError = new Error(
			`Syncthing failed to bind ${guiAddress} (attempt ${attempt}/${maxRetries})`,
		);
	}
	throw lastError ?? new Error("Syncthing failed to start on a free port");
}

async function readApiKeyFromHome(homeDir: string): Promise<string> {
	const xml = await fs.readFile(path.join(homeDir, "config.xml"), "utf-8");
	return matchOne(xml, /<apikey>([^<]+)<\/apikey>/);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface EnsureDaemonRunningOptions {
	timeoutMs?: number;
	pollMs?: number;
	check?: (guiAddress: string) => Promise<boolean>;
	start?: (homeDir: string) => Promise<unknown>;
}

export async function ensureDaemonRunning(
	homeDir: string,
	guiAddress: string,
	opts: EnsureDaemonRunningOptions = {},
): Promise<"already-running" | "started"> {
	const check = opts.check ?? isDaemonRunning;
	const start = opts.start ?? startDaemon;
	if (await check(guiAddress)) return "already-running";

	await start(homeDir);
	const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
	const pollMs = opts.pollMs ?? 500;
	while (Date.now() < deadline) {
		if (await check(guiAddress)) return "started";
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
	throw new Error(`Syncthing daemon did not become reachable at ${guiAddress}`);
}

export async function isDaemonRunning(guiAddress: string): Promise<boolean> {
	const addr = guiAddress.startsWith("http") ? guiAddress : `http://${guiAddress}`;
	try {
		const res = await fetch(`${addr}/rest/system/ping`);
		return res.status === 200 || res.status === 403;
	} catch {
		return false;
	}
}

async function postShutdown(guiAddress: string, apiKey: string): Promise<boolean> {
	const addr = guiAddress.startsWith("http") ? guiAddress : `http://${guiAddress}`;
	try {
		const res = await fetch(`${addr}/rest/system/shutdown`, {
			method: "POST",
			headers: { "X-API-Key": apiKey },
		});
		return res.ok;
	} catch {
		return false;
	}
}

export interface StopDaemonOptions {
	post?: (guiAddress: string, apiKey: string) => Promise<boolean>;
	check?: (guiAddress: string) => Promise<boolean>;
	timeoutMs?: number;
	pollMs?: number;
}

export async function stopDaemon(
	guiAddress: string,
	apiKey: string,
	opts: StopDaemonOptions = {},
): Promise<"stopped" | "not-running" | "timeout"> {
	const check = opts.check ?? isDaemonRunning;
	const post = opts.post ?? postShutdown;
	if (!(await check(guiAddress))) return "not-running";

	const accepted = await post(guiAddress, apiKey);
	if (!accepted) return "timeout";
	const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
	const pollMs = opts.pollMs ?? 300;
	while (Date.now() < deadline) {
		if (!(await check(guiAddress))) return "stopped";
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
	return "timeout";
}
