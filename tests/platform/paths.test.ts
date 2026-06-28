import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	ccsyncConfigPath,
	ccsyncHome,
	claudeHome,
	syncthingHome,
} from "../../src/platform/paths.js";

describe("paths", () => {
	it("ccsyncHome under user home", () => {
		expect(ccsyncHome()).toBe(path.join(os.homedir(), ".ccsync"));
	});

	it("ccsyncConfigPath ends in config.yaml", () => {
		expect(ccsyncConfigPath().endsWith("config.yaml")).toBe(true);
	});

	it("claudeHome under user home", () => {
		expect(claudeHome()).toBe(path.join(os.homedir(), ".claude"));
	});

	it("syncthingHome is ccsync-owned, nested inside ccsyncHome", () => {
		expect(syncthingHome()).toBe(path.join(ccsyncHome(), "syncthing"));
		expect(syncthingHome().startsWith(ccsyncHome())).toBe(true);
	});
});
