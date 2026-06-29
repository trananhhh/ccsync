import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { MonitorState } from "@/lib/api";
import type { EventSourceStatus } from "@/hooks/useEventSource";
import { formatRate } from "@/lib/format";

interface StatusBarProps {
	throughput: MonitorState["throughput"];
	devices: MonitorState["devices"];
	connection: EventSourceStatus;
}

/**
 * Live transfer rates plus connected peers. There is no cross-machine "active
 * machine" data source — `active.lock` is local and unsynced — so this shows the
 * connected peers from `devices[].connected` instead.
 */
export function StatusBar({ throughput, devices, connection }: StatusBarProps) {
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
			<span className="inline-flex items-center gap-1" title="Upload">
				<ArrowUp className="h-4 w-4 text-slate-400" aria-hidden />
				{formatRate(throughput.up)}
			</span>
			<span className="inline-flex items-center gap-1" title="Download">
				<ArrowDown className="h-4 w-4 text-slate-400" aria-hidden />
				{formatRate(throughput.down)}
			</span>
			<span className="h-4 w-px bg-slate-200" aria-hidden />
			<span className="flex flex-wrap items-center gap-1.5">
				{devices.length === 0 ? (
					<span className="text-xs text-slate-400">No peers</span>
				) : (
					devices.map((d) => (
						<Badge key={d.id} variant={d.connected ? "success" : "muted"}>
							{d.name}
						</Badge>
					))
				)}
			</span>
			{connection !== "open" && (
				<span className="text-xs text-slate-400" role="status">
					{connection === "connecting" ? "Connecting…" : "Reconnecting…"}
				</span>
			)}
		</div>
	);
}
