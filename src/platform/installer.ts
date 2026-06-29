import { run, which } from "../lib/exec.js";
import { detectOs, type OsInfo } from "./paths.js";

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
			// Homebrew refuses to run under sudo, so never elevate it.
			return runInstall("brew", ["install", "syncthing"]);
		case "apt":
			return runInstall(...elevate("apt-get", ["install", "-y", "syncthing"]));
		case "dnf":
			return runInstall(...elevate("dnf", ["install", "-y", "syncthing"]));
		case "pacman":
			return runInstall(...elevate("pacman", ["-S", "--noconfirm", "syncthing"]));
		case "zypper":
			return runInstall(...elevate("zypper", ["install", "-y", "syncthing"]));
		case "apk":
			return runInstall(...elevate("apk", ["add", "syncthing"]));
		default:
			return {
				installed: false,
				path: null,
				message:
					"Unsupported package manager. Install Syncthing manually from https://syncthing.net/downloads/",
			};
	}
}

/**
 * Prefix a privileged install command with `sudo` only when we are not already
 * root. Headless Linux (containers, minimal servers) commonly runs as root with
 * no `sudo` binary present, where prefixing `sudo` would fail spuriously.
 */
export function elevate(cmd: string, args: string[]): [string, string[]] {
	const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
	return isRoot ? [cmd, args] : ["sudo", [cmd, ...args]];
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
