import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { removeActiveLock as defaultRemoveActiveLock } from "../cli/commands/claim.js";
import { apply as defaultApply } from "../core/applier.js";
import { watchAndAutoAccept } from "../core/auto-accept.js";
import { bootstrapFirstMachine } from "../core/bootstrap-machine.js";
import { withCodeRootBucket } from "../core/buckets-default.js";
import { detectClaudeConversationsForRoot } from "../core/claude-projects.js";
import {
	readConfig as defaultReadConfig,
	writeConfig as defaultWriteConfig,
} from "../core/config-io.js";
import type { Config } from "../core/config-schema.js";
import { type ConflictAction, findConflicts, resolveConflict } from "../core/conflicts-scanner.js";
import { createInvite as defaultCreateInvite } from "../core/invite-store.js";
import { encodeInvite } from "../core/invite-token.js";
import { joinWithToken as defaultJoinWithToken } from "../core/join.js";
import { applyAndSave as defaultApplyAndSave } from "../core/mutate.js";
import { createRootProfile, inviteRootProfile } from "../core/root-profile.js";
import { applyPause as defaultApplyPause } from "../core/sync-control.js";
import { SyncthingApi } from "../core/syncthing-api.js";
import {
	bootstrapFreshHome as defaultBootstrapFreshHome,
	ensureDaemonRunning as defaultEnsureDaemonRunning,
} from "../core/syncthing-bootstrap.js";
import { buildFolders } from "../core/syncthing-config.js";
import { which } from "../lib/exec.js";
import { ensureSyncthing as defaultEnsureSyncthing } from "../platform/installer.js";
import { browseDirectory } from "./folders.js";
import { waitUntilSynced } from "./handoff.js";
import { openSse } from "./sse.js";
import type { MonitorState } from "./sync-monitor.js";

export interface StateMonitor {
	subscribe(fn: (state: MonitorState) => void): () => void;
}

/** Auto-accept watcher seam so `POST /api/pair/invite` can be tested in isolation. */
export type WatchAutoAccept = (opts: { api: SyncthingApi; deadline?: number }) => Promise<number>;

export interface ControlServerDeps {
	token: string;
	configPath: string;
	apiFor: (cfg: Config) => SyncthingApi;
	monitor?: StateMonitor;
	readConfig?: typeof defaultReadConfig;
	writeConfig?: typeof defaultWriteConfig;
	applyAndSave?: typeof defaultApplyAndSave;
	applyPause?: typeof defaultApplyPause;
	removeActiveLock?: typeof defaultRemoveActiveLock;
	apply?: typeof defaultApply;
	createInvite?: typeof defaultCreateInvite;
	watchAutoAccept?: WatchAutoAccept;
	joinWithToken?: typeof defaultJoinWithToken;
	ensureSyncthing?: typeof defaultEnsureSyncthing;
	ensureDaemonRunning?: typeof defaultEnsureDaemonRunning;
	bootstrapFreshHome?: typeof defaultBootstrapFreshHome;
	/** Detects whether the Syncthing binary is on PATH (wizard step 1 gating). */
	detectSyncthing?: () => Promise<boolean>;
	/** Confinement root for the folder browser; defaults to the user's home. */
	homeRoot?: string;
	/**
	 * Lazily constructs and starts the SSE monitor once a config exists. Called
	 * after a runtime config-create (setup/init or a fresh-machine join) so
	 * `/api/events` stops returning 503 without a service restart. Idempotent —
	 * returns the already-running monitor on repeat calls.
	 */
	ensureMonitor?: () => Promise<StateMonitor | undefined>;
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
interface PairJoinBody {
	token: string;
	localRoot?: string;
}
interface SetupInitBody {
	machineName?: string;
	codeRoot?: string;
	codeFolders?: string[];
	buckets?: Record<string, boolean>;
}

const RESOLVE_ACTIONS: readonly ConflictAction[] = ["keep-local", "keep-remote", "skip"];

/** Per-request handoff wait budget; the SPA re-polls until 100% in-sync. */
const HANDOFF_WINDOW_MS = 8000;
const HANDOFF_MIN_MS = 1000;
const HANDOFF_MAX_MS = 30_000;

/** How long the in-process auto-accept watcher runs after an invite is issued. */
const PAIR_WATCH_MS = 10 * 60 * 1000;

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

const MAX_BODY_BYTES = 1_000_000;

/** Body exceeded {@link MAX_BODY_BYTES} → respond 413 and tear down the socket. */
class PayloadTooLargeError extends Error {
	constructor() {
		super("payload too large");
		this.name = "PayloadTooLargeError";
	}
}

/** Body was not valid JSON → respond 400 instead of the catch-all 500. */
class BadJsonError extends Error {
	constructor() {
		super("invalid JSON body");
		this.name = "BadJsonError";
	}
}

function readJson<T>(req: http.IncomingMessage): Promise<T> {
	return new Promise((resolve, reject) => {
		let raw = "";
		let aborted = false;
		req.on("data", (c) => {
			if (aborted) return;
			raw += c;
			if (raw.length > MAX_BODY_BYTES) {
				aborted = true;
				// Stop reading and drop the connection so a hostile client can't keep
				// streaming past the cap; the handler maps this to a 413.
				req.destroy();
				reject(new PayloadTooLargeError());
			}
		});
		req.on("end", () => {
			if (aborted) return;
			try {
				resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
			} catch {
				reject(new BadJsonError());
			}
		});
		req.on("error", (err) => {
			if (!aborted) reject(err);
		});
	});
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
	const json = JSON.stringify(body);
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(json);
}

/**
 * Setup is "complete enough" to show the dashboard once Syncthing is bootstrapped
 * AND we either paired with a machine or mapped a code root. A bare bootstrapped
 * config (identity only) keeps the wizard up, so an interrupted run resumes.
 */
function isConfigured(cfg?: Config): boolean {
	return Boolean(cfg?.syncthing && (cfg.peers.length > 0 || cfg.rootProfile));
}

export function createControlServer(deps: ControlServerDeps): http.Server {
	const read = deps.readConfig ?? defaultReadConfig;
	const writeConfigFn = deps.writeConfig ?? defaultWriteConfig;
	const applyAndSaveFn = deps.applyAndSave ?? defaultApplyAndSave;
	const applyPauseFn = deps.applyPause ?? defaultApplyPause;
	const removeLock = deps.removeActiveLock ?? defaultRemoveActiveLock;
	const applyFn = deps.apply ?? defaultApply;
	const createInviteFn = deps.createInvite ?? defaultCreateInvite;
	const watchAutoAcceptFn = deps.watchAutoAccept ?? ((opts) => watchAndAutoAccept(opts));
	const joinWithTokenFn = deps.joinWithToken ?? defaultJoinWithToken;
	const ensureSyncthingFn = deps.ensureSyncthing ?? defaultEnsureSyncthing;
	const ensureDaemonRunningFn = deps.ensureDaemonRunning ?? defaultEnsureDaemonRunning;
	const bootstrapFreshHomeFn = deps.bootstrapFreshHome ?? defaultBootstrapFreshHome;
	const detectSyncthingFn = deps.detectSyncthing ?? (async () => Boolean(await which("syncthing")));

	// The SSE monitor is mutable: a fresh machine boots without one (no config),
	// and a runtime config-create lazily starts it via `deps.ensureMonitor` so
	// `/api/events` stops 503ing without a service restart. `ensureMonitorOnce`
	// dedupes concurrent callers so we never start two monitors.
	let monitor = deps.monitor;
	let ensureMonitorInFlight: Promise<void> | undefined;
	function ensureMonitorOnce(): Promise<void> {
		if (monitor || !deps.ensureMonitor) return Promise.resolve();
		if (!ensureMonitorInFlight) {
			ensureMonitorInFlight = (async () => {
				monitor = (await deps.ensureMonitor?.()) ?? monitor;
			})().finally(() => {
				ensureMonitorInFlight = undefined;
			});
		}
		return ensureMonitorInFlight;
	}

	// Tracks the in-process auto-accept watcher started by `POST /api/pair/invite`.
	// `pairingUntil` drives the dashboard's "waiting for a machine to join…" badge
	// and expires by time; `watcherRunning` dedupes the loop so a second invite in
	// the same window reuses the still-polling watcher (it picks up the new slot)
	// rather than spawning an overlapping one.
	let pairingUntil = 0;
	let watcherRunning = false;
	const isPairingActive = () => Date.now() < pairingUntil;

	function startPairingWatcher(api: SyncthingApi): void {
		pairingUntil = Date.now() + PAIR_WATCH_MS;
		if (watcherRunning) return;
		watcherRunning = true;
		watchAutoAcceptFn({ api, deadline: pairingUntil })
			.catch(() => {})
			.finally(() => {
				watcherRunning = false;
			});
	}

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
			if (!monitor) {
				return send(res, 503, { error: "monitor unavailable" });
			}
			const conn = openSse(req, res);
			const unsubscribe = monitor.subscribe((state) => conn.send("state", state));
			req.on("close", unsubscribe);
			return;
		}

		try {
			if (req.method === "GET" && url.pathname === "/api/state") {
				// Tolerate a missing/unreadable config: a fresh machine has none yet,
				// and the wizard needs `configured:false` rather than a 500.
				const cfg = await read(deps.configPath).catch(() => undefined);
				const syncthingInstalled = await detectSyncthingFn();
				if (!cfg) {
					return send(res, 200, {
						machineName: os.hostname(),
						metered: false,
						peers: [],
						buckets: [],
						configured: false,
						syncthingInstalled,
						pairing: isPairingActive(),
					});
				}
				return send(res, 200, {
					machineName: cfg.machineName,
					metered: cfg.metered,
					peers: cfg.peers.map((p) => ({ name: p.name, deviceId: p.deviceId })),
					buckets: Object.entries(cfg.buckets).map(([name, b]) => ({
						name,
						enabled: b.enabled,
						paths: b.paths,
					})),
					configured: isConfigured(cfg),
					syncthingInstalled,
					pairing: isPairingActive(),
				});
			}

			if (req.method === "GET" && url.pathname === "/api/folders/browse") {
				try {
					const result = await browseDirectory(
						url.searchParams.get("path") ?? undefined,
						deps.homeRoot,
					);
					return send(res, 200, result);
				} catch (err) {
					return send(res, 400, { error: err instanceof Error ? err.message : String(err) });
				}
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

			if (req.method === "POST" && url.pathname === "/api/setup/init") {
				const body = await readJson<SetupInitBody>(req);
				const result = await runSetupInit(body);
				// Config now exists — start the live feed so the dashboard the wizard
				// lands on shows throughput immediately, not after a restart.
				await ensureMonitorOnce();
				return send(res, 200, result);
			}

			if (req.method === "POST" && url.pathname === "/api/pair/invite") {
				const cfg = await read(deps.configPath).catch(() => undefined);
				if (!cfg?.syncthing) {
					return send(res, 503, { error: "config.syncthing not initialised — finish setup first" });
				}
				const api = deps.apiFor(cfg);
				const sys = await api.systemStatus();
				// Consume-on-join slot the watcher draws from, then issue the token.
				await createInviteFn();
				const token = encodeInvite({
					deviceId: sys.myID,
					name: cfg.machineName,
					introducer: true,
					rootProfile: cfg.rootProfile ? inviteRootProfile(cfg.rootProfile) : undefined,
				});
				// C3: the join only completes if THIS machine admits the joiner's pending
				// device. Run the auto-accept watcher in-process for the invite window.
				startPairingWatcher(api);
				return send(res, 200, {
					token,
					command: `npx @trananhhh/ccsync setup ${token}`,
				});
			}

			if (req.method === "POST" && url.pathname === "/api/pair/join") {
				const body = await readJson<PairJoinBody>(req);
				if (!body.token) {
					return send(res, 400, { error: "token is required" });
				}
				// A fresh machine pasting a token in the wizard has NO config yet, so
				// joinWithToken's readConfig would ENOENT. Bootstrap a dedicated
				// Syncthing identity first (same core as create-first), persist it, then
				// join — the join now reads the just-written config and applies.
				const existing = await read(deps.configPath).catch(() => undefined);
				if (!existing?.syncthing) {
					const base = await bootstrapFirstMachine({
						ensureSyncthing: ensureSyncthingFn,
						bootstrapFreshHome: bootstrapFreshHomeFn,
					});
					await writeConfigFn(deps.configPath, base);
				}
				// `localRoot` comes from wizard step 4 — joinWithToken NEVER prompts.
				const result = await joinWithTokenFn(body.token, {
					localRoot: body.localRoot,
					configPath: deps.configPath,
					readConfig: read,
					writeConfig: writeConfigFn,
					apply: applyFn,
					ensureSyncthing: ensureSyncthingFn,
					ensureDaemonRunning: ensureDaemonRunningFn,
				});
				// Config now exists (and has a peer) — start the live feed.
				await ensureMonitorOnce();
				return send(res, 200, { ok: true, result });
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
			if (err instanceof PayloadTooLargeError) {
				// The socket was already torn down in readJson; this 413 is best-effort
				// (a mid-upload client typically sees the reset instead) and must not
				// throw on the dead socket.
				if (!res.headersSent && res.writable) {
					try {
						return send(res, 413, { error: err.message });
					} catch {
						return;
					}
				}
				return;
			}
			if (err instanceof BadJsonError) {
				return send(res, 400, { error: err.message });
			}
			return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
		}
	});

	/**
	 * Bootstrap the first machine from the browser wizard: ensure Syncthing,
	 * create a fresh dedicated identity if needed, enable the chosen buckets, map
	 * the picked code root, then persist and apply. Reuses the same core the CLI
	 * `ccsync setup` drives, so the two paths converge on one config shape.
	 */
	async function runSetupInit(
		body: SetupInitBody,
	): Promise<{ ok: true; configured: boolean; machineName: string }> {
		const existing = await read(deps.configPath).catch(() => undefined);
		let cfg: Config;
		if (existing?.syncthing) {
			cfg = existing;
			if (body.machineName) cfg.machineName = body.machineName;
		} else {
			cfg = await bootstrapFirstMachine({
				machineName: body.machineName,
				ensureSyncthing: ensureSyncthingFn,
				bootstrapFreshHome: bootstrapFreshHomeFn,
			});
		}

		if (body.buckets) {
			for (const [name, on] of Object.entries(body.buckets)) {
				if (cfg.buckets[name]) cfg.buckets[name].enabled = on;
			}
		}

		if (body.codeRoot && !cfg.rootProfile) {
			const root = path.resolve(body.codeRoot);
			await fs.mkdir(root, { recursive: true });
			const detected = await detectClaudeConversationsForRoot(root);
			const codeFolders = (body.codeFolders ?? []).map((relativePath) => ({ relativePath }));
			cfg.rootProfile = createRootProfile({
				canonicalRoot: root,
				localRoot: root,
				codeFolders,
				projects: detected.projects,
				conversations: detected.conversations,
			});
			cfg.buckets = withCodeRootBucket(
				cfg.buckets,
				root,
				codeFolders.map((folder) => folder.relativePath),
			);
		}

		await writeConfigFn(deps.configPath, cfg);
		if (cfg.syncthing) {
			await ensureDaemonRunningFn(cfg.syncthing.homeDir, cfg.syncthing.guiAddress);
		}
		await applyFn(cfg);
		return { ok: true, configured: isConfigured(cfg), machineName: cfg.machineName };
	}
}

export function apiFromConfig(cfg: Config): SyncthingApi {
	if (!cfg.syncthing) throw new Error("config.syncthing not initialised — run `ccsync setup`");
	return new SyncthingApi({ apiKey: cfg.syncthing.apiKey, guiAddress: cfg.syncthing.guiAddress });
}
