import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	bootstrapFreshHome,
	type DaemonHandle,
	ensureDaemonRunning,
	readIdentity,
	setGuiAddress,
	stopDaemon,
} from "../../src/core/syncthing-bootstrap.js";

const SAMPLE_CONFIG_XML = `<configuration version="52">
    <device id="AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG-HHHHHHH" name="host">
        <address>dynamic</address>
    </device>
    <gui enabled="true" tls="false">
        <address>127.0.0.1:8384</address>
        <apikey>SECRETKEY123</apikey>
    </gui>
</configuration>`;

function makeHandle(overrides: Partial<DaemonHandle> = {}): DaemonHandle {
	return {
		pid: 1234,
		exited: new Promise<void>(() => {}),
		release: () => {},
		kill: () => {},
		...overrides,
	};
}

describe("setGuiAddress", () => {
	it("rewrites the gui address without touching device addresses", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-gui-"));
		const cfgPath = path.join(dir, "config.xml");
		await fs.writeFile(cfgPath, SAMPLE_CONFIG_XML);

		await setGuiAddress(dir, "127.0.0.1:54321");

		const xml = await fs.readFile(cfgPath, "utf-8");
		expect(xml).toContain("<address>127.0.0.1:54321</address>");
		expect(xml).not.toContain("127.0.0.1:8384");
		// device's dynamic address is untouched
		expect(xml).toContain("<address>dynamic</address>");

		const identity = await readIdentity(dir);
		expect(identity.apiKey).toBe("SECRETKEY123");
		expect(identity.guiAddress).toBe("127.0.0.1:54321");
	});

	it("throws when no gui address block is present", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccsync-gui-"));
		await fs.writeFile(path.join(dir, "config.xml"), "<configuration></configuration>");
		await expect(setGuiAddress(dir, "127.0.0.1:1")).rejects.toThrow(/<gui><address>/);
	});
});

describe("bootstrapFreshHome", () => {
	it("probes a port, writes the gui address, starts, and reads deviceId via REST", async () => {
		const writes: Array<{ homeDir: string; guiAddress: string }> = [];
		let released = false;
		const result = await bootstrapFreshHome("/tmp/home", {
			pollMs: 0,
			generate: async () => {},
			readApiKey: async () => "KEY",
			probePort: async () => 41000,
			writeGuiAddress: async (homeDir, guiAddress) => {
				writes.push({ homeDir, guiAddress });
			},
			start: async () => makeHandle({ release: () => (released = true) }),
			check: async () => true,
			fetchDeviceId: async (guiAddress, apiKey) => {
				expect(guiAddress).toBe("127.0.0.1:41000");
				expect(apiKey).toBe("KEY");
				return "DEVICE-ID-FROM-REST";
			},
		});

		expect(result).toEqual({
			apiKey: "KEY",
			guiAddress: "127.0.0.1:41000",
			deviceId: "DEVICE-ID-FROM-REST",
			pid: 1234,
		});
		expect(writes).toEqual([{ homeDir: "/tmp/home", guiAddress: "127.0.0.1:41000" }]);
		expect(released).toBe(true);
	});

	it("re-probes a new port and rewrites config when serve fails to bind", async () => {
		const ports = [41000, 41001];
		const probed: number[] = [];
		const writes: string[] = [];
		let attempt = 0;

		const result = await bootstrapFreshHome("/tmp/home", {
			pollMs: 0,
			timeoutMs: 50,
			generate: async () => {},
			readApiKey: async () => "KEY",
			probePort: async () => {
				const p = ports.shift() ?? 41999;
				probed.push(p);
				return p;
			},
			writeGuiAddress: async (_homeDir, guiAddress) => {
				writes.push(guiAddress);
			},
			start: async () => {
				attempt += 1;
				// First attempt's serve exits early (bind failure); second stays up.
				if (attempt === 1) return makeHandle({ exited: Promise.resolve() });
				return makeHandle();
			},
			check: async (guiAddress) => guiAddress === "127.0.0.1:41001",
			fetchDeviceId: async () => "DEVICE",
		});

		expect(probed).toEqual([41000, 41001]);
		expect(writes).toEqual(["127.0.0.1:41000", "127.0.0.1:41001"]);
		expect(result.guiAddress).toBe("127.0.0.1:41001");
	});

	it("throws after exhausting the retry cap", async () => {
		await expect(
			bootstrapFreshHome("/tmp/home", {
				pollMs: 0,
				timeoutMs: 5,
				maxRetries: 2,
				generate: async () => {},
				readApiKey: async () => "KEY",
				probePort: async () => 41000,
				writeGuiAddress: async () => {},
				start: async () => makeHandle({ exited: Promise.resolve() }),
				check: async () => false,
				fetchDeviceId: async () => "DEVICE",
			}),
		).rejects.toThrow(/failed to bind/);
	});
});

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

describe("stopDaemon", () => {
	it("returns not-running when the daemon is already down", async () => {
		const res = await stopDaemon("127.0.0.1:8384", "key", {
			check: async () => false,
		});
		expect(res).toBe("not-running");
	});

	it("posts shutdown and waits until unreachable", async () => {
		let posted = false;
		let calls = 0;
		const res = await stopDaemon("127.0.0.1:8384", "key", {
			post: async () => {
				posted = true;
				return true;
			},
			check: async () => {
				calls += 1;
				return calls === 1; // running once, then down
			},
			pollMs: 1,
			timeoutMs: 1000,
		});
		expect(posted).toBe(true);
		expect(res).toBe("stopped");
	});

	it("returns timeout when the daemon stays reachable after shutdown", async () => {
		const res = await stopDaemon("127.0.0.1:8384", "key", {
			post: async () => true,
			check: async () => true, // never goes down
			pollMs: 1,
			timeoutMs: 5,
		});
		expect(res).toBe("timeout");
	});
});
