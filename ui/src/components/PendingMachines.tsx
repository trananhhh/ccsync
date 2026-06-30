import { UserPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { acceptPending, type Peer } from "@/lib/api";

interface PendingMachinesProps {
	pending: Peer[];
	/** Refresh the parent state after an accept so the row disappears. */
	onAccepted: () => void;
}

/**
 * Devices that asked to join without a fresh invite token. They are surfaced here
 * so the user can admit them in one click instead of dropping to the CLI.
 */
export function PendingMachines({ pending, onAccepted }: PendingMachinesProps) {
	const [busy, setBusy] = useState<string | null>(null);
	if (pending.length === 0) return null;

	async function accept(deviceId?: string, all?: boolean) {
		setBusy(all ? "all" : (deviceId ?? null));
		try {
			const result = await acceptPending(deviceId, all);
			toast.success(`Accepted ${result.accepted} machine${result.accepted === 1 ? "" : "s"}`);
			onAccepted();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to accept");
		} finally {
			setBusy(null);
		}
	}

	return (
		<Card className="border-amber-300 bg-amber-50">
			<CardContent className="p-4">
				<div className="flex items-center justify-between gap-3">
					<p className="flex items-center gap-2 font-medium text-slate-900 text-sm">
						<UserPlus className="h-4 w-4 text-amber-600" />
						{pending.length} machine{pending.length === 1 ? "" : "s"} want to join
					</p>
					{pending.length > 1 && (
						<Button size="sm" onClick={() => accept(undefined, true)} disabled={busy !== null}>
							Accept all
						</Button>
					)}
				</div>
				<ul className="mt-3 space-y-2">
					{pending.map((p) => (
						<li
							key={p.deviceId}
							className="flex items-center justify-between gap-3 rounded-md bg-white/70 px-3 py-2"
						>
							<div className="min-w-0">
								<p className="truncate font-medium text-slate-900 text-sm">{p.name}</p>
								<p className="truncate font-mono text-[11px] text-slate-400">
									{p.deviceId.slice(0, 14)}…
								</p>
							</div>
							<Button
								size="sm"
								variant="outline"
								onClick={() => accept(p.deviceId)}
								disabled={busy !== null}
							>
								Accept
							</Button>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
