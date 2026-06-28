import * as http from "node:http";
import { removeActiveLock as defaultRemoveActiveLock } from "../cli/commands/claim.js";
import { readConfig as defaultReadConfig } from "../core/config-io.js";
import type { Config } from "../core/config-schema.js";
import { type ConflictAction, findConflicts, resolveConflict } from "../core/conflicts-scanner.js";
import { applyAndSave as defaultApplyAndSave } from "../core/mutate.js";
import { applyPause as defaultApplyPause } from "../core/sync-control.js";
import { SyncthingApi } from "../core/syncthing-api.js";
import { buildFolders } from "../core/syncthing-config.js";
import { waitUntilSynced } from "./handoff.js";
import { openSse } from "./sse.js";
import type { MonitorState } from "./sync-monitor.js";

export interface StateMonitor {
	subscribe(fn: (state: MonitorState) => void): () => void;
}

export interface ControlServerDeps {
	token: string;
	configPath: string;
	apiFor: (cfg: Config) => SyncthingApi;
	monitor?: StateMonitor;
	readConfig?: typeof defaultReadConfig;
	applyAndSave?: typeof defaultApplyAndSave;
	applyPause?: typeof defaultApplyPause;
	removeActiveLock?: typeof defaultRemoveActiveLock;
}

interface ToggleBody {
	target: string;
	on: boolean;
}
interface MeteredBody {
	on: boolean;
}
interface PauseBody {
	scope: "all";
	on: boolean;
}
interface ResolveBody {
	file: string;
	action: ConflictAction;
}
interface HandoffBody {
	timeoutMs?: number;
}

const RESOLVE_ACTIONS: readonly ConflictAction[] = ["keep-local", "keep-remote", "skip"];

/** Per-request handoff wait budget; the SPA re-polls until 100% in-sync. */
const HANDOFF_WINDOW_MS = 8000;
const HANDOFF_MIN_MS = 1000;
const HANDOFF_MAX_MS = 30_000;

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

function readJson<T>(req: http.IncomingMessage): Promise<T> {
	return new Promise((resolve, reject) => {
		let raw = "";
		req.on("data", (c) => {
			raw += c;
			if (raw.length > 1_000_000) reject(new Error("payload too large"));
		});
		req.on("end", () => {
			try {
				resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
			} catch (err) {
				reject(err);
			}
		});
		req.on("error", reject);
	});
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
	const json = JSON.stringify(body);
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(json);
}

export function createControlServer(deps: ControlServerDeps): http.Server {
	const read = deps.readConfig ?? defaultReadConfig;
	const applyAndSaveFn = deps.applyAndSave ?? defaultApplyAndSave;
	const applyPauseFn = deps.applyPause ?? defaultApplyPause;
	const removeLock = deps.removeActiveLock ?? defaultRemoveActiveLock;

	return http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const isWrite = req.method === "POST";
		if (isWrite && req.headers["x-ccsync-token"] !== deps.token) {
			return send(res, 401, { error: "unauthorized" });
		}

		// SSE realtime feed. EventSource can't send headers, so the token rides in
		// the query string; auth is checked here before the stream is opened.
		if (req.method === "GET" && url.pathname === "/api/events") {
			if (url.searchParams.get("token") !== deps.token) {
				return send(res, 401, { error: "unauthorized" });
			}
			if (!deps.monitor) {
				return send(res, 503, { error: "monitor unavailable" });
			}
			const conn = openSse(req, res);
			const unsubscribe = deps.monitor.subscribe((state) => conn.send("state", state));
			req.on("close", unsubscribe);
			return;
		}

		try {
			if (req.method === "GET" && url.pathname === "/api/state") {
				const cfg = await read(deps.configPath);
				return send(res, 200, {
					machineName: cfg.machineName,
					metered: cfg.metered,
					peers: cfg.peers.map((p) => ({ name: p.name, deviceId: p.deviceId })),
					buckets: Object.entries(cfg.buckets).map(([name, b]) => ({
						name,
						enabled: b.enabled,
						paths: b.paths,
					})),
				});
			}

			if (req.method === "GET" && url.pathname === "/api/conflicts") {
				const cfg = await read(deps.configPath);
				const conflicts = await findConflicts(cfg);
				return send(res, 200, {
					conflicts: conflicts.map((c) => ({
						file: c.path,
						original: c.original,
						bucket: c.bucket,
						isHistoryFile: c.isHistoryFile,
					})),
				});
			}

			if (req.method === "POST" && url.pathname === "/api/toggle") {
				const body = await readJson<ToggleBody>(req);
				const result = await applyAndSaveFn(deps.configPath, (c) => {
					if (!c.buckets[body.target]) throw new Error(`unknown bucket: ${body.target}`);
					c.buckets[body.target].enabled = body.on;
				});
				return send(res, 200, { ok: true, result });
			}

			if (req.method === "POST" && url.pathname === "/api/metered") {
				const body = await readJson<MeteredBody>(req);
				const cfg = await read(deps.configPath);
				const api = deps.apiFor(cfg);
				await applyPauseFn(api, body.on ? "pause-all" : "resume-all");
				// applyAndSave runs LAST so apply's derived pause state (paused = metered)
				// is the final PUT and cannot be undone by a later re-apply.
				await applyAndSaveFn(
					deps.configPath,
					(c) => {
						c.metered = body.on;
					},
					{ api },
				);
				return send(res, 200, { ok: true, metered: body.on });
			}

			if (req.method === "POST" && url.pathname === "/api/pause") {
				const body = await readJson<PauseBody>(req);
				const cfg = await read(deps.configPath);
				const api = deps.apiFor(cfg);
				await applyPauseFn(api, body.on ? "pause-all" : "resume-all");
				// Persist the flag so the pause survives the next apply (Phase 1:
				// pause-all and metered share the same durable flag).
				await applyAndSaveFn(
					deps.configPath,
					(c) => {
						c.metered = body.on;
					},
					{ api },
				);
				return send(res, 200, { ok: true, paused: body.on });
			}

			if (req.method === "POST" && url.pathname === "/api/conflicts/resolve") {
				const body = await readJson<ResolveBody>(req);
				if (!RESOLVE_ACTIONS.includes(body.action)) {
					return send(res, 400, { error: `invalid action: ${body.action}` });
				}
				const cfg = await read(deps.configPath);
				// Resolve only files the scanner currently reports — never act on an
				// arbitrary path from the request, which would be an unlink primitive.
				const match = (await findConflicts(cfg)).find((c) => c.path === body.file);
				if (!match) {
					return send(res, 404, { error: "conflict not found" });
				}
				await resolveConflict(match, body.action);
				return send(res, 200, { ok: true, file: body.file, action: body.action });
			}

			if (req.method === "POST" && url.pathname === "/api/handoff/release") {
				const body = await readJson<HandoffBody>(req);
				const cfg = await read(deps.configPath);
				if (!cfg.syncthing) {
					return send(res, 503, { error: "config.syncthing not initialised" });
				}
				const api = deps.apiFor(cfg);
				const sys = await api.systemStatus();
				const folders = buildFolders({
					machineName: cfg.machineName,
					myDeviceId: sys.myID,
					buckets: cfg.buckets,
					peers: cfg.peers,
					rootProfile: cfg.rootProfile,
				});

				// Bounded, abortable wait so the request never hangs for the full
				// handoff budget: each call waits a short window and the SPA re-polls.
				// Closing the tab aborts the loop instead of leaving it running.
				const controller = new AbortController();
				req.on("close", () => controller.abort());
				const result = await waitUntilSynced(
					{ api, folderIds: folders.map((f) => f.id) },
					{
						timeoutMs: clamp(body.timeoutMs ?? HANDOFF_WINDOW_MS, HANDOFF_MIN_MS, HANDOFF_MAX_MS),
						signal: controller.signal,
					},
				);
				if (res.writableEnded) return; // client disconnected mid-wait

				if (result === "synced") {
					await removeLock();
					return send(res, 200, { status: "synced" });
				}
				// Still pending (or the wait was aborted by a closed tab handled above).
				return send(res, 200, { status: "pending" });
			}

			return send(res, 404, { error: "not found" });
		} catch (err) {
			return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
		}
	});
}

export function apiFromConfig(cfg: Config): SyncthingApi {
	if (!cfg.syncthing) throw new Error("config.syncthing not initialised — run `ccsync setup`");
	return new SyncthingApi({ apiKey: cfg.syncthing.apiKey, guiAddress: cfg.syncthing.guiAddress });
}
