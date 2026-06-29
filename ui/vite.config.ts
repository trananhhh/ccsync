import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const ccsyncHome = path.join(os.homedir(), ".ccsync");

function readCcsyncFile(name: string): string | undefined {
	try {
		const v = fs.readFileSync(path.join(ccsyncHome, name), "utf-8").trim();
		return v || undefined;
	} catch {
		return undefined;
	}
}

// Dev only: proxy /api to the running control service and expose the token so
// `vite dev` behaves like the production-served app. Start `ccsync ui` once to
// create ~/.ccsync/service-url and ~/.ccsync/service-token.
const serviceUrl = readCcsyncFile("service-url");
const serviceToken = readCcsyncFile("service-token");
if (!serviceUrl) {
	// eslint-disable-next-line no-console
	console.warn("[ccsync-ui] ~/.ccsync/service-url not found — run `ccsync ui` first for `vite dev`.");
}

export default defineConfig({
	base: "/",
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: { "@": path.resolve(__dirname, "src") },
	},
	define: {
		"import.meta.env.VITE_CCSYNC_TOKEN": JSON.stringify(serviceToken ?? ""),
	},
	server: {
		proxy: serviceUrl
			? {
					"/api": { target: serviceUrl, changeOrigin: true },
				}
			: undefined,
	},
	build: {
		outDir: "../dist/ui",
		emptyOutDir: true,
		sourcemap: false,
	},
});
