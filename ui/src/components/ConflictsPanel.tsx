import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { type Conflict, type ConflictAction, getConflicts, resolveConflict } from "@/lib/api";

interface ConflictsPanelProps {
	/** Live count from the SSE feed; the row list is fetched on open. */
	count: number;
}

const ACTION_LABEL: Record<ConflictAction, string> = {
	"keep-local": "Keep local",
	"keep-remote": "Keep remote",
	skip: "Skip",
};

interface Pending {
	file: string;
	action: ConflictAction;
}

export function ConflictsPanel({ count }: ConflictsPanelProps) {
	const [open, setOpen] = useState(false);
	const [conflicts, setConflicts] = useState<Conflict[]>([]);
	const [loading, setLoading] = useState(false);
	const [pending, setPending] = useState<Pending | null>(null);
	const [busy, setBusy] = useState(false);

	async function load() {
		setLoading(true);
		try {
			setConflicts(await getConflicts());
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to load conflicts");
		} finally {
			setLoading(false);
		}
	}

	function onOpenChange(next: boolean) {
		setOpen(next);
		setPending(null);
		if (next) void load();
	}

	async function confirm() {
		if (!pending) return;
		setBusy(true);
		try {
			// "skip" is non-destructive; keep-local/keep-remote mutate files on disk —
			// they only run after this explicit confirm step.
			await resolveConflict(pending.file, pending.action);
			setConflicts((cs) => cs.filter((c) => c.file !== pending.file));
			toast.success(`${ACTION_LABEL[pending.action]} applied`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to resolve");
		} finally {
			setBusy(false);
			setPending(null);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button variant={count > 0 ? "destructive" : "outline"} disabled={count === 0}>
					<AlertTriangle className="h-4 w-4" />
					{count > 0 ? `Resolve ${count} conflict${count === 1 ? "" : "s"}` : "No conflicts"}
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Sync conflicts</DialogTitle>
					<DialogDescription>
						Choose a resolution per file. Keeping local or remote rewrites files on disk and cannot
						be undone.
					</DialogDescription>
				</DialogHeader>

				{loading ? (
					<p className="text-sm text-slate-500">Loading…</p>
				) : conflicts.length === 0 ? (
					<p className="text-sm text-slate-500">No conflicts remaining.</p>
				) : (
					<ul className="max-h-80 space-y-3 overflow-y-auto">
						{conflicts.map((c) => {
							const isPending = pending?.file === c.file;
							return (
								<li key={c.file} className="rounded-lg border border-slate-200 p-3">
									<div className="flex items-center justify-between gap-2">
										<p className="truncate text-sm font-medium text-slate-900" title={c.original}>
											{c.original.split("/").pop()}
										</p>
										<Badge variant="secondary">{c.bucket}</Badge>
									</div>
									<p className="mt-0.5 truncate text-xs text-slate-400" title={c.file}>
										{c.file}
									</p>

									{isPending ? (
										<div className="mt-3 flex items-center gap-2">
											<span className="text-xs text-slate-600">
												{ACTION_LABEL[pending.action]} — confirm?
											</span>
											<Button size="sm" onClick={confirm} disabled={busy}>
												Confirm
											</Button>
											<Button
												size="sm"
												variant="ghost"
												onClick={() => setPending(null)}
												disabled={busy}
											>
												Cancel
											</Button>
										</div>
									) : (
										<div className="mt-3 flex flex-wrap gap-2">
											{(Object.keys(ACTION_LABEL) as ConflictAction[]).map((action) => (
												<Button
													key={action}
													size="sm"
													variant="outline"
													onClick={() => setPending({ file: c.file, action })}
												>
													{ACTION_LABEL[action]}
												</Button>
											))}
										</div>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}
