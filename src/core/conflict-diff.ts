import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createTwoFilesPatch } from "diff";

/** Files larger than this are not diffed inline — the patch would dwarf the UI. */
const MAX_DIFF_BYTES = 512 * 1024;

export type ConflictDiffStatus = "ok" | "binary" | "too-large" | "missing-original";

export interface ConflictDiff {
	status: ConflictDiffStatus;
	/** Unified diff of original (local) vs conflict copy (remote). Present when status is "ok". */
	patch?: string;
}

/**
 * Produce a unified diff between the surviving original (local) and the conflict
 * copy (remote). Guards against binary content and oversized files so the control
 * service never streams a megabyte of bytes into the browser.
 */
export async function conflictDiff(
	conflictPath: string,
	originalPath: string,
): Promise<ConflictDiff> {
	const [conflict, original] = await Promise.all([
		readMaybe(conflictPath),
		readMaybe(originalPath),
	]);
	if (!conflict) return { status: "missing-original" }; // conflict copy itself is gone
	if (!original) return { status: "missing-original" };
	if (conflict.tooLarge || original.tooLarge) return { status: "too-large" };
	if (conflict.binary || original.binary) return { status: "binary" };

	const name = path.basename(originalPath);
	const patch = createTwoFilesPatch(
		`${name} (local)`,
		`${name} (remote)`,
		original.text ?? "",
		conflict.text ?? "",
	);
	return { status: "ok", patch };
}

interface ReadResult {
	text?: string;
	binary: boolean;
	tooLarge: boolean;
}

async function readMaybe(p: string): Promise<ReadResult | null> {
	let buf: Buffer;
	try {
		buf = await fs.readFile(p);
	} catch {
		return null;
	}
	if (buf.byteLength > MAX_DIFF_BYTES) return { binary: false, tooLarge: true };
	if (buf.includes(0)) return { binary: true, tooLarge: false }; // NUL byte ⇒ treat as binary
	return { text: buf.toString("utf-8"), binary: false, tooLarge: false };
}
