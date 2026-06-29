import { afterEach, describe, expect, it } from "vitest";
import { elevate } from "../../src/platform/installer.js";

describe("elevate", () => {
	const original = process.getuid;
	afterEach(() => {
		process.getuid = original;
	});

	function setUid(uid: number | undefined): void {
		process.getuid = uid === undefined ? undefined : () => uid;
	}

	it("runs the command directly when already root (no sudo)", () => {
		setUid(0);
		expect(elevate("apk", ["add", "syncthing"])).toEqual(["apk", ["add", "syncthing"]]);
	});

	it("prefixes sudo when not root", () => {
		setUid(1000);
		expect(elevate("apt-get", ["install", "-y", "syncthing"])).toEqual([
			"sudo",
			["apt-get", "install", "-y", "syncthing"],
		]);
	});

	it("prefixes sudo when getuid is unavailable (non-POSIX)", () => {
		setUid(undefined);
		expect(elevate("zypper", ["install", "-y", "syncthing"])).toEqual([
			"sudo",
			["zypper", "install", "-y", "syncthing"],
		]);
	});
});
