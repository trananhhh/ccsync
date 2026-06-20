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

export async function isDaemonRunning(guiAddress: string): Promise<boolean> {
	const addr = guiAddress.startsWith("http") ? guiAddress : `http://${guiAddress}`;
	try {
		const res = await fetch(`${addr}/rest/system/ping`);
		return res.status === 200 || res.status === 403;
	} catch {
		return false;
	}
}
