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

/**
 * ccsync's dedicated Syncthing home. Lives inside `~/.ccsync` so ccsync never
 * touches the platform-default Syncthing a user may run themselves. This is the
 * DEFAULT used when bootstrapping a fresh home; at runtime ccsync trusts
 * `config.yaml`'s `syncthing.homeDir`, which legacy configs migrate onto this.
 */
export function syncthingHome(): string {
	return path.join(ccsyncHome(), "syncthing");
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
