import * as fs from "node:fs/promises";
import * as path from "node:path";
import { run, spawnDetached, which } from "../lib/exec.js";

export interface SyncthingIdentity {
	deviceId: string;
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

export async function readIdentity(homeDir: string): Promise<SyncthingIdentity> {
	const xml = await fs.readFile(path.join(homeDir, "config.xml"), "utf-8");
	const deviceId = matchOne(xml, /<device id="([A-Z0-9-]+)"/);
	const apiKey = matchOne(xml, /<apikey>([^<]+)<\/apikey>/);
	const guiAddress = matchOne(xml, /<gui[^>]*>[\s\S]*?<address>([^<]+)<\/address>/);
	return { deviceId, apiKey, guiAddress: guiAddress || "127.0.0.1:8384" };
}

function matchOne(text: string, re: RegExp): string {
	const m = text.match(re);
	if (!m) throw new Error(`config.xml missing expected field for pattern ${re}`);
	return m[1];
}

export async function startDaemon(homeDir: string): Promise<number> {
	const syncthing = await which("syncthing");
	if (!syncthing) throw new Error("syncthing binary not found on PATH");
	return spawnDetached(syncthing, ["serve", `--home=${homeDir}`, "--no-browser", "--no-restart"]);
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
): Promise<"stopped" | "not-running"> {
	const check = opts.check ?? isDaemonRunning;
	const post = opts.post ?? postShutdown;
	if (!(await check(guiAddress))) return "not-running";

	await post(guiAddress, apiKey);
	const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
	const pollMs = opts.pollMs ?? 300;
	while (Date.now() < deadline) {
		if (!(await check(guiAddress))) return "stopped";
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
	return "stopped";
}
