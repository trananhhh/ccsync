import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { browseDirectory } from "../../src/service/folders.js";

describe("browseDirectory", () => {
	let home: string;

	beforeEach(async () => {
		home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-home-")));
		await fs.mkdir(path.join(home, "code", "app"), { recursive: true });
		await fs.mkdir(path.join(home, "code", "lib"), { recursive: true });
		await fs.writeFile(path.join(home, "code", "readme.md"), "x");
		await fs.mkdir(path.join(home, ".hidden"), { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(home, { recursive: true, force: true });
	});

	it("lists immediate subdirectories (dirs only, hidden skipped) sorted by name", async () => {
		const result = await browseDirectory(path.join(home, "code"), home);
		expect(result.entries.map((e) => e.name)).toEqual(["app", "lib"]);
		expect(result.entries.every((e) => e.isDir)).toBe(true);
		expect(result.parent).toBe(home);
	});

	it("defaults to the home root and reports a null parent there", async () => {
		const result = await browseDirectory(undefined, home);
		expect(result.path).toBe(home);
		expect(result.parent).toBeNull();
		expect(result.entries.map((e) => e.name)).toContain("code");
	});

	it("rejects a traversal attempt that escapes the home root", async () => {
		await expect(browseDirectory(path.join(home, "..", ".."), home)).rejects.toThrow(/outside/i);
		await expect(browseDirectory("/etc", home)).rejects.toThrow(/outside|not found/i);
	});

	it("does not follow a symlink that points outside the home root", async () => {
		const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-out-")));
		try {
			// A symlink at the home root pointing outside must not appear as a child,
			// and browsing into it must be rejected by the canonical-path guard.
			await fs.symlink(outside, path.join(home, "escape"));
			const listing = await browseDirectory(home, home);
			expect(listing.entries.map((e) => e.name)).not.toContain("escape");
			await expect(browseDirectory(path.join(home, "escape"), home)).rejects.toThrow(/outside/i);
		} finally {
			await fs.rm(outside, { recursive: true, force: true });
		}
	});
});
