import type * as http from "node:http";

export interface SseConnection {
	/** Write a named SSE event with a JSON-serialised payload. */
	send(event: string, data: unknown): void;
	/** Stop the heartbeat, run cleanup, and end the response. */
	close(): void;
}

export interface SseOptions {
	/** Heartbeat comment interval in ms (default 15s). */
	heartbeatMs?: number;
	/** Extra cleanup run once when the client disconnects or close() is called. */
	onClose?: () => void;
}

/**
 * Upgrade an HTTP response to a Server-Sent Events stream. Sets the
 * buffering-hostile headers SSE needs behind any proxy, emits a `:ok` preamble,
 * keeps the connection warm with periodic `:hb` heartbeats, and tears the
 * heartbeat + caller cleanup down exactly once on client disconnect.
 */
export function openSse(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	opts: SseOptions = {},
): SseConnection {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
		"X-Accel-Buffering": "no",
	});
	res.write(":ok\n\n");

	const heartbeatMs = opts.heartbeatMs ?? 15_000;
	const heartbeat = setInterval(() => {
		res.write(":hb\n\n");
	}, heartbeatMs);
	if (typeof heartbeat.unref === "function") heartbeat.unref();

	let closed = false;
	const cleanup = (): void => {
		if (closed) return;
		closed = true;
		clearInterval(heartbeat);
		opts.onClose?.();
	};

	req.on("close", cleanup);

	return {
		send(event, data) {
			if (closed) return;
			res.write(`event:${event}\ndata:${JSON.stringify(data)}\n\n`);
		},
		close() {
			cleanup();
			res.end();
		},
	};
}
