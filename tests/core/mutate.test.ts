import { describe, expect, it } from "vitest";
import type { Config } from "../../src/core/config-schema.js";
import { applyAndSave } from "../../src/core/mutate.js";

function cfg(): Config {
	return {
		machineName: "m",
		peers: [],
		buckets: {
			"claude-config": {
				enabled: true,
				paths: [],
				ignore: [],
				versioning: { type: "simple", keep: 10 },
			},
		},
		globalIgnore: [],
		metered: false,
	} as Config;
}

describe("applyAndSave", () => {
	it("mutates, writes, then applies — in that order", async () => {
		const order: string[] = [];
		let saved: Config | undefined;
		const res = await applyAndSave(
			"/tmp/x.yaml",
			(c) => {
				c.buckets["claude-config"].enabled = false;
			},
			{
				read: async () => cfg(),
				write: async (_p, c) => {
					order.push("write");
					saved = c;
				},
				applyFn: async () => {
					order.push("apply");
					return {
						foldersConfigured: 0,
						devicesConfigured: 1,
						stignoresWritten: 0,
						myDeviceId: "test-device",
					};
				},
			},
		);
		expect(saved?.buckets["claude-config"].enabled).toBe(false);
		expect(order).toEqual(["write", "apply"]);
		expect(res.devicesConfigured).toBe(1);
	});
});
