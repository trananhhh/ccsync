import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../../src/core/config-schema.js";
import { migrateToDedicatedHome, needsMigration } from "../../src/core/syncthing-migrate.js";

function legacyConfig() {
	return ConfigSchema.parse({
		machineName: "laptop",
		syncthing: {
			apiKey: "OLDKEY",
			guiAddress: "127.0.0.1:8384",
			homeDir: "/Users/me/Library/Application Support/Syncthing",
		},
		peers: [],
		buckets: {},
	});
}

describe("needsMigration", () => {
	it("is true when the configured home differs from the dedicated home", () => {
		expect(needsMigration(legacyConfig(), "/Users/me/.ccsync/syncthing")).toBe(true);
	});

	it("is false when already on the dedicated home", () => {
		const cfg = legacyConfig();
		cfg.syncthing!.homeDir = "/Users/me/.ccsync/syncthing";
		expect(needsMigration(cfg, "/Users/me/.ccsync/syncthing")).toBe(false);
	});

	it("normalizes paths before comparing", () => {
		const cfg = legacyConfig();
		cfg.syncthing!.homeDir = "/Users/me/.ccsync/syncthing/";
		expect(needsMigration(cfg, "/Users/me/.ccsync/syncthing")).toBe(false);
	});

	it("is false when there is no syncthing section", () => {
		const cfg = legacyConfig();
		cfg.syncthing = undefined;
		expect(needsMigration(cfg, "/Users/me/.ccsync/syncthing")).toBe(false);
	});
});

describe("migrateToDedicatedHome", () => {
	it("stops the old daemon, generates a fresh identity, and rewrites config.yaml", async () => {
		const cfg = legacyConfig();
		const stops: Array<[string, string]> = [];
		let written: typeof cfg | undefined;

		const result = await migrateToDedicatedHome(cfg, "/Users/me/.ccsync/syncthing", {
			stopOldDaemon: async (guiAddress, apiKey) => {
				stops.push([guiAddress, apiKey]);
			},
			bootstrapFresh: async (homeDir) => {
				expect(homeDir).toBe("/Users/me/.ccsync/syncthing");
				return { apiKey: "NEWKEY", guiAddress: "127.0.0.1:49999", deviceId: "NEW-DEVICE" };
			},
			writeConfig: async (next) => {
				written = next;
			},
		});

		// Old daemon stopped using the OLD credentials.
		expect(stops).toEqual([["127.0.0.1:8384", "OLDKEY"]]);

		// config.yaml rewritten onto the dedicated home with the NEW identity.
		expect(written?.syncthing).toEqual({
			apiKey: "NEWKEY",
			guiAddress: "127.0.0.1:49999",
			homeDir: "/Users/me/.ccsync/syncthing",
		});

		expect(result).toEqual({
			deviceId: "NEW-DEVICE",
			guiAddress: "127.0.0.1:49999",
			homeDir: "/Users/me/.ccsync/syncthing",
			previousHomeDir: "/Users/me/Library/Application Support/Syncthing",
		});
		// old keys are NOT copied
		expect(written?.syncthing?.apiKey).not.toBe("OLDKEY");
	});

	it("throws when the config has no syncthing section", async () => {
		const cfg = legacyConfig();
		cfg.syncthing = undefined;
		await expect(
			migrateToDedicatedHome(cfg, "/Users/me/.ccsync/syncthing", {
				stopOldDaemon: async () => {},
				bootstrapFresh: async () => ({ apiKey: "x", guiAddress: "y", deviceId: "z" }),
				writeConfig: async () => {},
			}),
		).rejects.toThrow(/no syncthing section/);
	});
});
