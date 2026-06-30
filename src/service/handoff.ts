import type { SyncthingApi } from "../core/syncthing-api.js";

export type WaitResult = "synced" | "timeout" | "aborted";

export interface WaitDeps {
	/** Only the status read is needed; keeps the function easy to mock. */
	api: Pick<SyncthingApi, "folderStatus">;
	/** Syncthing folder ids to watch until each reports nothing pending. */
	folderIds: string[];
}

export interface WaitOptions {
	/** Hard cap on the wait; returns "timeout" once exceeded. */
	timeoutMs: number;
	/** Abort the loop early (e.g. the CLI is interrupted or the tab closes). */
	signal?: AbortSignal;
	/** Delay between status sweeps (default 3000ms). */
	pollMs?: number;
	/** Called after each sweep with how many folders are still pending. */
	onProgress?: (pending: number, total: number) => void;
}

/** Resolve after `ms`, or immediately when `signal` aborts. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timer);
			resolve();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * A folder is still pending until it has nothing left to pull, nothing left to
 * delete, and no outstanding pull errors. needDeletes and pullErrors matter for a
 * safe handoff: a pending deletion or a stuck pull means the peer has not
 * converged, so "safe to switch" would be a lie if we only checked bytes/files.
 */
async function countPending(deps: WaitDeps): Promise<number> {
	let pending = 0;
	for (const id of deps.folderIds) {
		try {
			const s = await deps.api.folderStatus(id);
			if (s.needFiles > 0 || s.needBytes > 0 || s.needDeletes > 0 || s.pullErrors > 0) {
				pending++;
			}
		} catch {
			pending++;
		}
	}
	return pending;
}

/**
 * Wait until every watched folder reports 100% in-sync. Pure: it performs no
 * lock side-effects and never touches `process.exitCode` — the caller maps the
 * returned result to its own behaviour. Bounded by `timeoutMs` and cancellable
 * via `signal` so a closed tab or interrupted CLI leaves no running loop.
 */
export async function waitUntilSynced(deps: WaitDeps, opts: WaitOptions): Promise<WaitResult> {
	const pollMs = opts.pollMs ?? 3000;
	const deadline = Date.now() + opts.timeoutMs;
	while (Date.now() < deadline) {
		if (opts.signal?.aborted) return "aborted";
		const pending = await countPending(deps);
		opts.onProgress?.(pending, deps.folderIds.length);
		if (pending === 0) return "synced";
		if (opts.signal?.aborted) return "aborted";
		// Never sleep past the deadline, so the wait stays bounded by timeoutMs
		// even when pollMs is larger than the remaining budget.
		const remaining = deadline - Date.now();
		if (remaining <= 0) break;
		await abortableDelay(Math.min(pollMs, remaining), opts.signal);
	}
	return opts.signal?.aborted ? "aborted" : "timeout";
}
