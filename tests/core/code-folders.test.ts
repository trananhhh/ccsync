import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { findCodeFolderCandidates } from "../../src/core/code-folders.js";

describe("findCodeFolderCandidates", () => {
	it("finds git folders, keeps dashed names, adds conversation-only paths, and skips heavy dirs", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-code-folders-"));
		const root = path.join(tmp, "Coding");

		await fs.mkdir(path.join(root, "anby", "anby-platform", ".git"), { recursive: true });
		await fs.mkdir(path.join(root, "aie-singapore", "sq-workshop-trananhhh", ".git"), {
			recursive: true,
		});
		await fs.mkdir(path.join(root, "app", "node_modules", "nested-lib", ".git"), {
			recursive: true,
		});

		const candidates = await findCodeFolderCandidates(root, ["conversation-only/project"]);

		expect(candidates).toEqual([
			{ relativePath: "aie-singapore/sq-workshop-trananhhh" },
			{ relativePath: "anby/anby-platform" },
			{ relativePath: "conversation-only/project" },
		]);
	});
});
