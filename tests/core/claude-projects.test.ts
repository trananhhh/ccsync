import { describe, expect, it } from "vitest";
import { decodeProjectDir } from "../../src/core/claude-projects.js";

describe("decodeProjectDir", () => {
	it("decodes leading-dash encoded paths", () => {
		expect(decodeProjectDir("-Users-trananhhh")).toBe("/Users/trananhhh");
		expect(decodeProjectDir("-Users-trananhhh-work-myapp")).toBe(
			"/Users/trananhhh/work/myapp",
		);
	});

	it("passes through paths without leading dash", () => {
		expect(decodeProjectDir("relative-name")).toBe("relative-name");
	});

	it("handles project name fragments with dashes (best-effort)", () => {
		expect(decodeProjectDir("-Users-trananhhh-Coding-anby-meeting")).toBe(
			"/Users/trananhhh/Coding/anby/meeting",
		);
	});
});
