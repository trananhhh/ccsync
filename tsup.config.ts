import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		cli: "src/cli/index.ts",
	},
	format: ["esm"],
	target: "node20",
	clean: true,
	sourcemap: true,
	minify: false,
	banner: {
		js: "#!/usr/bin/env node",
	},
});
