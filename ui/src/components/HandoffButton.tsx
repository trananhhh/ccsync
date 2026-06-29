import { CheckCircle2, Loader2, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { type MonitorState, handoffRelease } from "@/lib/api";

interface HandoffButtonProps {
	folders: MonitorState["folders"];
}

/** Lowest folder completion across all folders, used as the overall progress. */
function overallCompletion(folders: MonitorState["folders"]): number {
	if (folders.length === 0) return 100;
	return Math.min(...folders.map((f) => f.completion));
}

/**
 * "Safe to switch machine" — polls the bounded handoff endpoint until every
 * folder is 100% in-sync, then toasts. Each POST returns quickly (the server
 * caps its wait), so this loop re-polls rather than holding one long request.
 */
export function HandoffButton({ folders }: HandoffButtonProps) {
	const [running, setRunning] = useState(false);
	const cancelled = useRef(false);

	useEffect(() => {
		return () => {
			cancelled.current = true;
		};
	}, []);

	async function start() {
		if (running) {
			cancelled.current = true;
			setRunning(false);
			return;
		}
		cancelled.current = false;
		setRunning(true);
		try {
			while (!cancelled.current) {
				const { status } = await handoffRelease();
				if (cancelled.current) break;
				if (status === "synced") {
					toast.success("All buckets in sync — safe to switch machine");
					break;
				}
			}
		} catch (e) {
			if (!cancelled.current) toast.error(e instanceof Error ? e.message : "Handoff failed");
		} finally {
			setRunning(false);
		}
	}

	return (
		<Button variant="outline" onClick={start} aria-busy={running}>
			{running ? (
				<>
					<Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
					Waiting… {overallCompletion(folders)}%
				</>
			) : (
				<>
					<LogOut className="h-4 w-4" />
					Safe to switch machine
				</>
			)}
			{!running && folders.length > 0 && overallCompletion(folders) === 100 && (
				<CheckCircle2 className="h-4 w-4 text-emerald-600" />
			)}
		</Button>
	);
}
