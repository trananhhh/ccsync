import * as http from "node:http";
import { readConfig as defaultReadConfig } from "../core/config-io.js";
import type { Config } from "../core/config-schema.js";
import { applyAndSave as defaultApplyAndSave } from "../core/mutate.js";
import { applyPause as defaultApplyPause } from "../core/sync-control.js";
import { SyncthingApi } from "../core/syncthing-api.js";

export interface ControlServerDeps {
	token: string;
	configPath: string;
	apiFor: (cfg: Config) => SyncthingApi;
	readConfig?: typeof defaultReadConfig;
	applyAndSave?: typeof defaultApplyAndSave;
	applyPause?: typeof defaultApplyPause;
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

	return http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const isWrite = req.method === "POST";
		if (isWrite && req.headers["x-ccsync-token"] !== deps.token) {
			return send(res, 401, { error: "unauthorized" });
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
				await applyAndSaveFn(deps.configPath, (c) => {
					c.metered = body.on;
				});
				return send(res, 200, { ok: true, metered: body.on });
			}

			if (req.method === "POST" && url.pathname === "/api/pause") {
				const body = await readJson<PauseBody>(req);
				const cfg = await read(deps.configPath);
				const api = deps.apiFor(cfg);
				await applyPauseFn(api, body.on ? "pause-all" : "resume-all");
				return send(res, 200, { ok: true, paused: body.on });
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
