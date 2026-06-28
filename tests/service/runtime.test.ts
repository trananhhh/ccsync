import { describe, expect, it } from "vitest";
import { serviceUrlFile } from "../../src/service/runtime.js";

describe("serviceUrlFile", () => {
	it("lives under the ccsync home", () => {
		expect(serviceUrlFile("/tmp/cc")).toBe("/tmp/cc/service-url");
	});
});
