import { describe, expect, it } from "vitest";
import { ensureDaemonRunning } from "../../src/core/syncthing-bootstrap.js";

describe("ensureDaemonRunning", () => {
	it("does not start Syncthing when the GUI API is already reachable", async () => {
		let starts = 0;

		const result = await ensureDaemonRunning("/tmp/syncthing", "127.0.0.1:8384", {
			check: async () => true,
			start: async () => {
				starts++;
			},
		});

		expect(result).toBe("already-running");
		expect(starts).toBe(0);
	});

	it("starts Syncthing and waits until the GUI API is reachable", async () => {
		let checks = 0;
		let starts = 0;

		const result = await ensureDaemonRunning("/tmp/syncthing", "127.0.0.1:8384", {
			pollMs: 0,
			check: async () => {
				checks++;
				return checks > 2;
			},
			start: async () => {
				starts++;
			},
		});

		expect(result).toBe("started");
		expect(starts).toBe(1);
	});

	it("throws a clear error when Syncthing never becomes reachable", async () => {
		await expect(
			ensureDaemonRunning("/tmp/syncthing", "127.0.0.1:8384", {
				timeoutMs: 1,
				pollMs: 0,
				check: async () => false,
				start: async () => {},
			}),
		).rejects.toThrow(/did not become reachable/);
	});
});
