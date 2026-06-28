import { EventEmitter } from "node:events";
import type * as http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openSse } from "../../src/service/sse.js";

function fakeReq(): http.IncomingMessage {
	return new EventEmitter() as unknown as http.IncomingMessage;
}

function fakeRes() {
	const writes: string[] = [];
	let head: { status: number; headers: Record<string, string> } | undefined;
	let ended = false;
	const res = {
		writeHead(status: number, headers: Record<string, string>) {
			head = { status, headers };
			return res;
		},
		write(chunk: string) {
			writes.push(chunk);
			return true;
		},
		end() {
			ended = true;
		},
	};
	return {
		res: res as unknown as http.ServerResponse,
		writes,
		getHead: () => head,
		isEnded: () => ended,
	};
}

describe("openSse", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("sets event-stream headers and writes the :ok preamble", () => {
		const req = fakeReq();
		const { res, writes, getHead } = fakeRes();
		openSse(req, res);
		const head = getHead();
		expect(head?.status).toBe(200);
		expect(head?.headers["Content-Type"]).toBe("text/event-stream");
		expect(head?.headers["Cache-Control"]).toBe("no-cache, no-transform");
		expect(head?.headers["X-Accel-Buffering"]).toBe("no");
		expect(writes[0]).toBe(":ok\n\n");
	});

	it("frames send() as event/data lines with a trailing blank line", () => {
		const req = fakeReq();
		const { res, writes } = fakeRes();
		const conn = openSse(req, res);
		conn.send("state", { a: 1 });
		expect(writes.at(-1)).toBe('event:state\ndata:{"a":1}\n\n');
	});

	it("emits :hb heartbeats on the configured interval", () => {
		vi.useFakeTimers();
		const req = fakeReq();
		const { res, writes } = fakeRes();
		openSse(req, res, { heartbeatMs: 1000 });
		vi.advanceTimersByTime(2500);
		expect(writes.filter((w) => w === ":hb\n\n")).toHaveLength(2);
	});

	it("clears the heartbeat and runs onClose exactly once on disconnect", () => {
		vi.useFakeTimers();
		const req = fakeReq();
		const { res, writes } = fakeRes();
		const onClose = vi.fn();
		openSse(req, res, { heartbeatMs: 1000, onClose });

		req.emit("close");
		req.emit("close");
		expect(onClose).toHaveBeenCalledTimes(1);

		const before = writes.length;
		vi.advanceTimersByTime(5000);
		expect(writes.length).toBe(before); // no heartbeats after cleanup
	});

	it("stops sending after close()", () => {
		const req = fakeReq();
		const { res, writes, isEnded } = fakeRes();
		const conn = openSse(req, res);
		conn.close();
		conn.send("state", { a: 1 });
		expect(isEnded()).toBe(true);
		expect(writes.some((w) => w.startsWith("event:state"))).toBe(false);
	});
});
