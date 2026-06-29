import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(__dirname, "..", "src");

async function tsFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const out: string[] = [];
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...(await tsFiles(full)));
		else if (e.name.endsWith(".ts")) out.push(full);
	}
	return out;
}

// The published bundle is ESM (`"type":"module"`) with no createRequire shim, so
// a CommonJS require() throws at runtime. This once silently broke ALL Linux
// package-manager detection (every probe caught the ReferenceError and returned
// false -> "Unsupported package manager"). Vitest has require(), so unit tests
// never caught it; this guard scans the source instead.
describe("ESM purity", () => {
	it("no CommonJS require( in src", async () => {
		const files = await tsFiles(SRC);
		const offenders: string[] = [];
		for (const f of files) {
			const text = await readFile(f, "utf8");
			if (/\brequire\s*\(/.test(text)) offenders.push(path.relative(SRC, f));
		}
		expect(offenders).toEqual([]);
	});
});
