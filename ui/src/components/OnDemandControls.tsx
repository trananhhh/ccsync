import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { setSyncMode, type SyncMode, syncNow } from "@/lib/api";

interface OnDemandControlsProps {
	syncMode: SyncMode;
	/** Re-fetch state after a mode change so the toggle reflects the server. */
	onChanged: () => void;
}

/**
 * Toggle between realtime sync and on-demand ("manual") sync. In manual mode
 * transfers stay paused until the user clicks "Sync now" (resume → wait → pause).
 */
export function OnDemandControls({ syncMode, onChanged }: OnDemandControlsProps) {
	const [busy, setBusy] = useState(false);
	const manual = syncMode === "manual";

	async function toggle(next: boolean) {
		setBusy(true);
		try {
			await setSyncMode(next ? "manual" : "realtime");
			toast.success(next ? "On-demand mode — transfers paused" : "Realtime mode — transfers resumed");
			onChanged();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to change mode");
		} finally {
			setBusy(false);
		}
	}

	async function doSyncNow() {
		setBusy(true);
		const id = toast.loading("Syncing…");
		try {
			const { result } = await syncNow();
			toast.dismiss(id);
			if (result === "synced" || result === "rescanned") toast.success("Synced");
			else toast.error(`Sync ${result} — try again`);
			onChanged();
		} catch (e) {
			toast.dismiss(id);
			toast.error(e instanceof Error ? e.message : "Sync failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex items-center gap-3">
			<label className="flex items-center gap-2 text-sm text-slate-700">
				<Switch checked={manual} onCheckedChange={toggle} disabled={busy} />
				On-demand sync
			</label>
			{manual && (
				<Button size="sm" variant="outline" onClick={doSyncNow} disabled={busy}>
					<RefreshCw className="h-4 w-4" /> Sync now
				</Button>
			)}
		</div>
	);
}
