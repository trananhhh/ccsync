import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { ccsyncConfigPath, ccsyncHome, claudeHome } from "../../src/platform/paths.js";

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
});
