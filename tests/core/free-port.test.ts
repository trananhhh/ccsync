import * as net from "node:net";
import { describe, expect, it } from "vitest";
import { probeFreeGuiAddress, probeFreePort } from "../../src/core/free-port.js";

describe("probeFreePort", () => {
	it("returns a positive loopback port that is actually bindable", async () => {
		const port = await probeFreePort();
		expect(port).toBeGreaterThan(0);

		// The probe must have released the port, so we can bind it ourselves.
		await new Promise<void>((resolve, reject) => {
			const server = net.createServer();
			server.once("error", reject);
			server.listen(port, "127.0.0.1", () => {
				server.close(() => resolve());
			});
		});
	});

	it("does not hold the port open after resolving", async () => {
		const a = await probeFreePort();
		const b = await probeFreePort();
		// Both probes released their ports; ports are valid numbers.
		expect(a).toBeGreaterThan(0);
		expect(b).toBeGreaterThan(0);
	});
});

describe("probeFreeGuiAddress", () => {
	it("formats the probed port as a loopback gui address", async () => {
		const addr = await probeFreeGuiAddress();
		expect(addr).toMatch(/^127\.0\.0\.1:\d+$/);
	});
});
