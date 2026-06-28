import { useState } from "react";
import { BucketList } from "@/components/BucketList";
import { ConflictsPanel } from "@/components/ConflictsPanel";
import { HandoffButton } from "@/components/HandoffButton";
import { MeteredButton } from "@/components/MeteredButton";
import { StatusBar } from "@/components/StatusBar";
import { toast } from "@/components/ui/sonner";
import { useEventSource } from "@/hooks/useEventSource";
import { type MonitorState, type State, eventsUrl, getState, setMetered, toggleBucket } from "@/lib/api";

const EMPTY_THROUGHPUT = { up: 0, down: 0 };

export function Dashboard({ initial }: { initial: State }) {
	// The SSE feed is the single source of truth for live state. Bucket on/off is
	// the one field it does not carry, so that is reconciled via getState().
	const { data: live, status } = useEventSource<MonitorState>(eventsUrl(), "state");
	const [cfg, setCfg] = useState<State>(initial);

	const folders = live?.folders ?? [];
	const devices = live?.devices ?? [];
	const metered = live?.metered ?? cfg.metered;
	const conflicts = live?.conflicts ?? 0;

	async function onToggleBucket(name: string, on: boolean) {
		try {
			await toggleBucket(name, on);
			setCfg(await getState());
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Toggle failed");
			setCfg(await getState().catch(() => cfg));
		}
	}

	async function onToggleMetered(on: boolean) {
		// Fire-and-reconcile: the metered flag comes back on the next SSE push.
		try {
			await setMetered(on);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to change metered mode");
		}
	}

	return (
		<main className="mx-auto max-w-2xl p-6 sm:p-8">
			<header className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold tracking-tight text-slate-900">ccsync</h1>
				<span className="text-sm text-slate-500">{cfg.machineName}</span>
			</header>

			<div className="mt-5">
				<StatusBar
					throughput={live?.throughput ?? EMPTY_THROUGHPUT}
					devices={devices}
					connection={status}
				/>
			</div>

			<div className="mt-6">
				<BucketList buckets={cfg.buckets} folders={folders} onToggle={onToggleBucket} />
			</div>

			<div className="mt-5 flex flex-wrap items-center gap-3">
				<MeteredButton metered={metered} onToggle={onToggleMetered} />
				<ConflictsPanel count={conflicts} />
				<HandoffButton folders={folders} />
			</div>
		</main>
	);
}
