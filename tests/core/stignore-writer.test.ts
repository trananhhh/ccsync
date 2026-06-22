import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Bucket } from "../../src/core/config-schema.js";
import { writeStignore } from "../../src/core/stignore-writer.js";

const BUCKET: Bucket = {
	enabled: true,
	paths: [],
	ignore: [],
	versioning: { type: "simple", keep: 5 },
};

describe("writeStignore", () => {
	let tmpRoot: string;

	beforeEach(async () => {
		tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stignore-writer-"));
	});

	afterEach(async () => {
		await fs.rm(tmpRoot, { recursive: true, force: true });
	});

	it("writes a merged .stignore when codeFolderRoot has a .ccsyncignore", async () => {
		const codeRoot = path.join(tmpRoot, "code");
		await fs.mkdir(codeRoot, { recursive: true });
		await fs.writeFile(
			path.join(codeRoot, ".ccsyncignore"),
			"// project\npnpm-lock.yaml\n!/coverage/x\n",
			"utf-8",
		);
		const folderPath = path.join(codeRoot, "deeper");
		await fs.mkdir(folderPath, { recursive: true });

		const result = await writeStignore({
			folderPath,
			bucket: { ...BUCKET, ignore: ["bucket-only"] },
			globalIgnore: [],
			codeFolderRoot: codeRoot,
		});

		expect(result.written).toBe(true);
		expect(result.projectIgnore).toEqual(["pnpm-lock.yaml", "!/coverage/x"]);
		const written = await fs.readFile(path.join(folderPath, ".stignore"), "utf-8");
		expect(written).toContain("// Project (.ccsyncignore)");
		expect(written).toContain("pnpm-lock.yaml");
		expect(written).toContain("!/coverage/x");
		expect(written).toContain("bucket-only");
	});

	it("writes without a project section when codeFolderRoot has no .ccsyncignore", async () => {
		const codeRoot = path.join(tmpRoot, "code");
		await fs.mkdir(codeRoot, { recursive: true });

		const result = await writeStignore({
			folderPath: codeRoot,
			bucket: BUCKET,
			globalIgnore: [],
			codeFolderRoot: codeRoot,
		});

		expect(result.written).toBe(true);
		expect(result.projectIgnore).toEqual([]);
		const written = await fs.readFile(path.join(codeRoot, ".stignore"), "utf-8");
		expect(written).not.toContain("// Project (.ccsyncignore)");
	});

	it("returns written: false when the folderPath does not exist", async () => {
		const result = await writeStignore({
			folderPath: path.join(tmpRoot, "missing"),
			bucket: BUCKET,
			globalIgnore: [],
		});
		expect(result.written).toBe(false);
		expect(result.projectIgnore).toEqual([]);
	});

	it("falls back silently when codeFolderRoot is undefined", async () => {
		const folderPath = path.join(tmpRoot, "code");
		await fs.mkdir(folderPath, { recursive: true });
		const result = await writeStignore({
			folderPath,
			bucket: BUCKET,
			globalIgnore: [],
		});
		expect(result.written).toBe(true);
		expect(result.projectIgnore).toEqual([]);
	});
});
