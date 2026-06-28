import { useEffect, useState } from "react";

export type EventSourceStatus = "connecting" | "open" | "error";

export interface EventSourceResult<T> {
	data: T | null;
	status: EventSourceStatus;
}

/**
 * Subscribe to a named Server-Sent Event and keep the latest parsed payload.
 * The browser's EventSource auto-reconnects on transient errors, so an "error"
 * status is transient, not terminal. The stream is the single source of truth —
 * callers render from `data` and never mutate it locally.
 */
export function useEventSource<T>(url: string, eventName: string): EventSourceResult<T> {
	const [data, setData] = useState<T | null>(null);
	const [status, setStatus] = useState<EventSourceStatus>("connecting");

	useEffect(() => {
		const es = new EventSource(url);
		es.onopen = () => setStatus("open");
		es.onerror = () => setStatus("error");
		const handler = (ev: MessageEvent): void => {
			try {
				setData(JSON.parse(ev.data) as T);
				setStatus("open");
			} catch {
				// ignore malformed frames; the next push reconciles
			}
		};
		es.addEventListener(eventName, handler);
		return () => {
			es.removeEventListener(eventName, handler);
			es.close();
		};
	}, [url, eventName]);

	return { data, status };
}
