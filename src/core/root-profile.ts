import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { claudeHome } from "../platform/paths.js";
import type {
	RootCodeFolder,
	RootConversation,
	RootProfile,
	RootProject,
} from "./config-schema.js";

export interface CreateRootProfileInput {
	id?: string;
	canonicalRoot: string;
	localRoot: string;
	conversationMode?: RootProfile["conversationMode"];
	codeFolders?: RootCodeFolder[];
	projects?: RootProject[];
	conversations?: RootConversation[];
}

export function createRootProfile(input: CreateRootProfileInput): RootProfile {
	const canonicalRoot = normalizeRoot(input.canonicalRoot);
	const localRoot = normalizeRoot(input.localRoot);
	const codeFolders =
		input.codeFolders === undefined
			? [{ relativePath: "." }]
			: input.codeFolders.map((folder) => ({
					relativePath: normalizeRelativePath(folder.relativePath),
				}));
	const projects = (input.projects ?? []).map((project) => ({
		relativePath: normalizeRelativePath(project.relativePath),
	}));
	const conversations = normalizeConversations(input.conversations, projects, localRoot);

	return {
		id: input.id ?? `profile-${hashSegment(canonicalRoot)}`,
		canonicalRoot,
		localRoot,
		conversationMode: input.conversationMode ?? "direct",
		codeFolders,
		projects,
		conversations,
	};
}

export function localProjectPath(profile: RootProfile, relativePath: string): string {
	return path.join(profile.localRoot, normalizeRelativePath(relativePath));
}

export function claudeConversationPath(
	profile: RootProfile,
	relativePath: string,
	claudeRoot: string = claudeHome(),
): string {
	return path.join(
		claudeRoot,
		"projects",
		encodeClaudeProjectPath(localProjectPath(profile, relativePath)),
	);
}

export function rawClaudeConversationPath(
	encodedName: string,
	claudeRoot: string = claudeHome(),
): string {
	return path.join(claudeRoot, "projects", normalizeEncodedConversationName(encodedName));
}

export function rootConversations(profile: RootProfile): RootConversation[] {
	if (profile.conversations.length > 0) return profile.conversations;
	return profile.projects.map((project) => ({
		relativePath: project.relativePath,
		encodedName: encodeClaudeProjectPath(localProjectPath(profile, project.relativePath)),
	}));
}

export function rootConversationPath(profile: RootProfile, conversation: RootConversation): string {
	if (conversation.relativePath) return claudeConversationPath(profile, conversation.relativePath);
	return rawClaudeConversationPath(conversation.encodedName);
}

export function encodeClaudeProjectPath(projectPath: string): string {
	return path.normalize(projectPath).replace(/[\\/]+/g, "-");
}

export function rootFolderId(profile: RootProfile): string {
	return `ccsync-root-${safeSegment(profile.id)}`;
}

export function rootCodeFolders(profile: RootProfile): RootCodeFolder[] {
	if (profile.codeFolders.length > 0) return profile.codeFolders;
	return [{ relativePath: "." }];
}

export function rootCodeFolderId(profile: RootProfile, relativePath: string): string {
	const normalized = normalizeRelativePath(relativePath);
	if (normalized === ".") return rootFolderId(profile);
	return `ccsync-code-${safeSegment(profile.id)}-${hashSegment(normalized)}`;
}

export function conversationFolderId(profile: RootProfile, relativePath: string): string {
	return `ccsync-conv-${safeSegment(profile.id)}-${hashSegment(normalizeRelativePath(relativePath))}`;
}

export function rootConversationFolderId(
	profile: RootProfile,
	conversation: RootConversation,
): string {
	if (conversation.relativePath) return conversationFolderId(profile, conversation.relativePath);
	return `ccsync-conv-raw-${safeSegment(profile.id)}-${hashSegment(conversation.encodedName)}`;
}

export function inviteRootProfile(
	profile: RootProfile,
): Pick<RootProfile, "id" | "canonicalRoot" | "codeFolders" | "projects" | "conversations"> {
	return {
		id: profile.id,
		canonicalRoot: profile.canonicalRoot,
		codeFolders: rootCodeFolders(profile),
		projects: profile.projects,
		conversations: rootConversations(profile),
	};
}

export function suggestRootFromProjects(
	projectPaths: string[],
	fallbackRoot: string,
	homeRoot: string = os.homedir(),
): string {
	const common = commonParent(projectPaths);
	if (!common || isBroadRoot(common, homeRoot)) return safeFallbackRoot(fallbackRoot, homeRoot);
	return common;
}

export function isPathInsideRoot(root: string, target: string): boolean {
	const relative = path.relative(normalizeRoot(root), normalizeRoot(target));
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRoot(root: string): string {
	return path.resolve(root);
}

function commonParent(paths: string[]): string | null {
	if (paths.length === 0) return null;
	const parts = paths.map((p) => normalizeRoot(p).split(path.sep).filter(Boolean));
	const first = parts[0];
	let end = first.length;
	for (const current of parts.slice(1)) {
		let i = 0;
		while (i < end && i < current.length && current[i] === first[i]) i++;
		end = i;
	}
	if (end === 0) return path.parse(paths[0]).root;
	return `${path.sep}${first.slice(0, end).join(path.sep)}`;
}

function isBroadRoot(root: string, homeRoot: string): boolean {
	const normalized = normalizeRoot(root);
	return normalized === path.parse(normalized).root || normalized === normalizeRoot(homeRoot);
}

function safeFallbackRoot(fallbackRoot: string, homeRoot: string): string {
	const normalized = normalizeRoot(fallbackRoot);
	if (!isBroadRoot(normalized, homeRoot)) return normalized;
	return path.join(normalizeRoot(homeRoot), "ccsync-root");
}

function normalizeRelativePath(relativePath: string): string {
	const normalized = path.normalize(relativePath).replace(/\\/g, "/");
	if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
		throw new Error(`Project path must be relative to the sync root: ${relativePath}`);
	}
	return normalized === "" ? "." : normalized;
}

function normalizeConversations(
	conversations: RootConversation[] | undefined,
	projects: RootProject[],
	localRoot: string,
): RootConversation[] {
	const source =
		conversations && conversations.length > 0
			? conversations
			: projects.map((project) => ({
					relativePath: project.relativePath,
					encodedName: encodeClaudeProjectPath(path.join(localRoot, project.relativePath)),
				}));
	return source.map((conversation) => ({
		encodedName: normalizeEncodedConversationName(conversation.encodedName),
		relativePath: conversation.relativePath
			? normalizeRelativePath(conversation.relativePath)
			: undefined,
	}));
}

function normalizeEncodedConversationName(encodedName: string): string {
	if (encodedName.includes("/") || encodedName.includes("\\")) {
		throw new Error(
			`Claude conversation folder name must not contain path separators: ${encodedName}`,
		);
	}
	return encodedName;
}

function hashSegment(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function safeSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40);
}
