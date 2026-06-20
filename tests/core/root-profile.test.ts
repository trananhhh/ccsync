import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	claudeConversationPath,
	conversationFolderId,
	createRootProfile,
	isPathInsideRoot,
	localProjectPath,
	rootFolderId,
	suggestRootFromProjects,
} from "../../src/core/root-profile.js";

describe("root-profile", () => {
	it("maps one logical project to each machine's local root", () => {
		const host = createRootProfile({
			id: "profile-a",
			canonicalRoot: "/Users/alice/work",
			localRoot: "/Users/alice/work",
			projects: [{ relativePath: "ccsync" }],
		});
		const joined = createRootProfile({
			id: host.id,
			canonicalRoot: host.canonicalRoot,
			localRoot: "/Users/bob/Coding",
			projects: host.projects,
		});

		expect(localProjectPath(host, "ccsync")).toBe(path.normalize("/Users/alice/work/ccsync"));
		expect(localProjectPath(joined, "ccsync")).toBe(path.normalize("/Users/bob/Coding/ccsync"));
		expect(rootFolderId(host)).toBe(rootFolderId(joined));
		expect(conversationFolderId(host, "ccsync")).toBe(conversationFolderId(joined, "ccsync"));
	});

	it("computes Claude conversation paths from each machine's local project path", () => {
		const host = createRootProfile({
			id: "profile-a",
			canonicalRoot: "/Users/alice/work",
			localRoot: "/Users/alice/work",
			projects: [{ relativePath: "ccsync" }],
		});
		const joined = createRootProfile({
			id: host.id,
			canonicalRoot: host.canonicalRoot,
			localRoot: "/Users/bob/Coding",
			projects: host.projects,
		});

		expect(claudeConversationPath(host, "ccsync", "/tmp/claude")).toBe(
			path.normalize("/tmp/claude/projects/-Users-alice-work-ccsync"),
		);
		expect(claudeConversationPath(joined, "ccsync", "/tmp/claude")).toBe(
			path.normalize("/tmp/claude/projects/-Users-bob-Coding-ccsync"),
		);
	});

	it("supports the selected root itself as a Claude project", () => {
		const profile = createRootProfile({
			id: "profile-a",
			canonicalRoot: "/Users/alice/work/ccsync",
			localRoot: "/Users/alice/work/ccsync",
			projects: [{ relativePath: "." }],
		});

		expect(localProjectPath(profile, ".")).toBe(path.normalize("/Users/alice/work/ccsync"));
		expect(claudeConversationPath(profile, ".", "/tmp/claude")).toBe(
			path.normalize("/tmp/claude/projects/-Users-alice-work-ccsync"),
		);
	});

	it("uses a fallback instead of suggesting broad roots for scattered projects", () => {
		expect(
			suggestRootFromProjects(
				["/Users/alice/work/app", "/Users/alice/experiments/tool"],
				"/Users/alice/work",
				"/Users/alice",
			),
		).toBe(path.normalize("/Users/alice/work"));
	});

	it("does not suggest a broad fallback root", () => {
		expect(
			suggestRootFromProjects(
				["/Users/alice/work/app", "/Users/alice/experiments/tool"],
				"/Users/alice",
				"/Users/alice",
			),
		).toBe(path.normalize("/Users/alice/ccsync-root"));
	});

	it("checks whether a project belongs to the selected root", () => {
		expect(isPathInsideRoot("/Users/alice/work", "/Users/alice/work/ccsync")).toBe(true);
		expect(isPathInsideRoot("/Users/alice/work", "/Users/alice/other/ccsync")).toBe(false);
	});
});
