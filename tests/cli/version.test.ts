import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { CLI_VERSION } from "../../src/cli/version.js";

describe("CLI version", () => {
	it("uses the package.json version", () => {
		expect(CLI_VERSION).toBe(packageJson.version);
	});
});
