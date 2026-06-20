import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeProjectDir, listClaudeProjectsUnderRoot } from "../../src/core/claude-projects.js";
import { encodeClaudeProjectPath } from "../../src/core/root-profile.js";

describe("decodeProjectDir", () => {
	it("decodes leading-dash encoded paths", () => {
		expect(decodeProjectDir("-Users-trananhhh")).toBe("/Users/trananhhh");
		expect(decodeProjectDir("-Users-trananhhh-work-myapp")).toBe("/Users/trananhhh/work/myapp");
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

describe("listClaudeProjectsUnderRoot", () => {
	it("matches Claude project folders by encoding local paths so dashed names stay intact", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-claude-projects-"));
		const root = path.join(tmp, "Coding");
		const claudeHome = path.join(tmp, ".claude");
		const projectsDir = path.join(claudeHome, "projects");
		const dashed = path.join(root, "anby", "anby-platform");
		const nestedDashed = path.join(root, "aie-singapore", "sq-workshop-trananhhh");
		const missing = path.join(root, "does-not-exist");

		await fs.mkdir(dashed, { recursive: true });
		await fs.mkdir(nestedDashed, { recursive: true });
		await fs.mkdir(projectsDir, { recursive: true });
		await fs.mkdir(path.join(projectsDir, encodeClaudeProjectPath(dashed)));
		await fs.mkdir(path.join(projectsDir, encodeClaudeProjectPath(nestedDashed)));
		await fs.mkdir(path.join(projectsDir, encodeClaudeProjectPath(missing)));

		const detected = await listClaudeProjectsUnderRoot(root, { claudeHome });

		expect(detected.map((p) => p.projectPath).sort()).toEqual([dashed, nestedDashed].sort());
		expect(detected.every((p) => p.exists)).toBe(true);
	});
});
