import { run, which } from "../lib/exec.js";
import { type OsInfo, detectOs } from "./paths.js";

export interface InstallResult {
	installed: boolean;
	path: string | null;
	message: string;
}

export async function ensureSyncthing(): Promise<InstallResult> {
	const existing = await which("syncthing");
	if (existing) return { installed: true, path: existing, message: "already installed" };
	const os = detectOs();
	return installViaPkg(os);
}

async function installViaPkg(os: OsInfo): Promise<InstallResult> {
	switch (os.pkgManager) {
		case "brew":
			return runInstall("brew", ["install", "syncthing"]);
		case "apt":
			return runInstall("sudo", ["apt-get", "install", "-y", "syncthing"]);
		case "dnf":
			return runInstall("sudo", ["dnf", "install", "-y", "syncthing"]);
		case "pacman":
			return runInstall("sudo", ["pacman", "-S", "--noconfirm", "syncthing"]);
		default:
			return {
				installed: false,
				path: null,
				message:
					"Unsupported package manager. Install Syncthing manually from https://syncthing.net/downloads/",
			};
	}
}

async function runInstall(cmd: string, args: string[]): Promise<InstallResult> {
	try {
		await run(cmd, args);
	} catch (err) {
		return {
			installed: false,
			path: null,
			message: `Install failed: ${(err as Error).message}`,
		};
	}
	const located = await which("syncthing");
	if (!located) {
		return { installed: false, path: null, message: "Installed but not on PATH" };
	}
	return { installed: true, path: located, message: "installed via package manager" };
}
