import * as os from "node:os";
import * as path from "node:path";

export function ccsyncHome(): string {
	return path.join(os.homedir(), ".ccsync");
}

export function ccsyncConfigPath(): string {
	return path.join(ccsyncHome(), "config.yaml");
}

export function ccsyncLockPath(): string {
	return path.join(ccsyncHome(), "active.lock");
}

export function syncthingHome(): string {
	const xdg = process.env.XDG_STATE_HOME;
	if (xdg) return path.join(xdg, "syncthing");
	if (process.platform === "darwin") {
		return path.join(os.homedir(), "Library", "Application Support", "Syncthing");
	}
	return path.join(os.homedir(), ".local", "state", "syncthing");
}

export function claudeHome(): string {
	return path.join(os.homedir(), ".claude");
}

export interface OsInfo {
	platform: NodeJS.Platform;
	pkgManager: "brew" | "apt" | "dnf" | "pacman" | "unknown";
}

export function detectOs(): OsInfo {
	const platform = process.platform;
	let pkgManager: OsInfo["pkgManager"] = "unknown";
	if (platform === "darwin") pkgManager = "brew";
	else if (platform === "linux") {
		if (fileExistsSync("/usr/bin/apt") || fileExistsSync("/usr/bin/apt-get")) pkgManager = "apt";
		else if (fileExistsSync("/usr/bin/dnf")) pkgManager = "dnf";
		else if (fileExistsSync("/usr/bin/pacman")) pkgManager = "pacman";
	}
	return { platform, pkgManager };
}

function fileExistsSync(p: string): boolean {
	try {
		require("node:fs").accessSync(p);
		return true;
	} catch {
		return false;
	}
}
