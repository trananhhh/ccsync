import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		cli: "src/cli/index.ts",
	},
	format: ["esm"],
	target: "node20",
	clean: true,
	// No source maps: the published tarball is dist/cli.js + dist/ui/** only.
	sourcemap: false,
	minify: false,
	banner: {
		js: "#!/usr/bin/env node",
	},
});
