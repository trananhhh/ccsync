import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
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
import {
	type Conflict,
	type ConflictAction,
	type ConflictDiff,
	getConflictDiff,
	getConflicts,
	resolveConflictsBulk,
} from "@/lib/api";
import { formatBytes, formatDateTime, formatRelativeTime } from "@/lib/format";

interface ConflictsPanelProps {
	/** Live count from the SSE feed; the row list is fetched on open. */
	count: number;
}

type Side = "local" | "remote" | "deleted";

/**
 * Which side "wins" by recency. A missing original is NOT "remote is newer" —
 * it means the other machine deleted the file (delete-vs-edit), so we surface it
 * as its own state and never silently resurrect it.
 */
function newerSide(c: Conflict): Side {
	if (c.originalMtime == null) return "deleted";
	if (c.conflictMtime == null) return "local";
	return c.conflictMtime > c.originalMtime ? "remote" : "local";
}

/**
 * Action chosen by "Keep newer". For a delete-vs-edit conflict the most recent
 * intent is the deletion, so we HONOUR it (drop the orphan copy) rather than
 * resurrecting the file. To restore instead, the user selects the row and picks
 * "Keep remote" explicitly.
 */
function actionForNewer(c: Conflict): ConflictAction {
	const side = newerSide(c);
	if (side === "deleted") return "keep-local"; // discard orphan copy, honour the delete
	return side === "remote" ? "keep-remote" : "keep-local";
}

interface PendingBulk {
	label: string;
	items: Array<{ file: string; action: ConflictAction }>;
}

export function ConflictsPanel({ count }: ConflictsPanelProps) {
	const [open, setOpen] = useState(false);
	const [conflicts, setConflicts] = useState<Conflict[]>([]);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [expanded, setExpanded] = useState<string | null>(null);
	const [diffs, setDiffs] = useState<Record<string, ConflictDiff | "loading">>({});
	const [pendingBulk, setPendingBulk] = useState<PendingBulk | null>(null);

	const allSelected = conflicts.length > 0 && selected.size === conflicts.length;

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
		setPendingBulk(null);
		setSelected(new Set());
		setExpanded(null);
		setDiffs({});
		if (next) void load();
	}

	function toggleSelect(file: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(file)) next.delete(file);
			else next.add(file);
			return next;
		});
	}

	function toggleSelectAll() {
		setSelected(allSelected ? new Set() : new Set(conflicts.map((c) => c.file)));
	}

	async function toggleDiff(file: string) {
		if (expanded === file) {
			setExpanded(null);
			return;
		}
		setExpanded(file);
		if (!diffs[file]) {
			setDiffs((d) => ({ ...d, [file]: "loading" }));
			try {
				const result = await getConflictDiff(file);
				setDiffs((d) => ({ ...d, [file]: result }));
			} catch (e) {
				toast.error(e instanceof Error ? e.message : "Failed to load diff");
				setDiffs((d) => {
					const next = { ...d };
					delete next[file];
					return next;
				});
			}
		}
	}

	/** Build the affected set: selection when non-empty, otherwise every conflict. */
	function scope(): Conflict[] {
		if (selected.size === 0) return conflicts;
		return conflicts.filter((c) => selected.has(c.file));
	}

	function requestBulk(action: ConflictAction | "newer") {
		const target = scope();
		if (target.length === 0) return;
		const items = target.map((c) => ({
			file: c.file,
			action: action === "newer" ? actionForNewer(c) : action,
		}));
		const noun = selected.size === 0 ? "all" : `${selected.size} selected`;
		const verb =
			action === "newer"
				? "Keep newer"
				: action === "keep-local"
					? "Keep local"
					: action === "keep-remote"
						? "Keep remote"
						: "Skip";
		setPendingBulk({ label: `${verb} (${noun})`, items });
	}

	async function confirmBulk() {
		if (!pendingBulk) return;
		setBusy(true);
		try {
			const result = await resolveConflictsBulk(pendingBulk.items);
			const done = new Set(
				pendingBulk.items
					.filter((it) => it.action !== "skip")
					.map((it) => it.file)
					// errors keep their rows; drop only the ones that actually resolved
					.filter((f) => !result.errors.some((e) => e.file === f)),
			);
			setConflicts((cs) => cs.filter((c) => !done.has(c.file)));
			setSelected(new Set());
			const backupNote = result.resolved > 0 ? ` · backup: ${result.backupDir}` : "";
			if (result.errors.length > 0) {
				toast.error(`${result.resolved} resolved, ${result.errors.length} failed${backupNote}`);
			} else {
				toast.success(`${pendingBulk.label}: ${result.resolved} resolved${backupNote}`);
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Bulk resolve failed");
		} finally {
			setBusy(false);
			setPendingBulk(null);
		}
	}

	const scopeNoun = useMemo(
		() => (selected.size === 0 ? "all" : `${selected.size} selected`),
		[selected.size],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button variant={count > 0 ? "destructive" : "outline"} disabled={count === 0}>
					<AlertTriangle className="h-4 w-4" />
					{count > 0 ? `Resolve ${count} conflict${count === 1 ? "" : "s"}` : "No conflicts"}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Sync conflicts</DialogTitle>
					<DialogDescription>
						Two machines edited the same file. Keeping local or remote rewrites files on disk and
						cannot be undone.
					</DialogDescription>
				</DialogHeader>

				{loading ? (
					<p className="text-sm text-slate-500">Loading…</p>
				) : conflicts.length === 0 ? (
					<p className="text-sm text-slate-500">No conflicts remaining.</p>
				) : pendingBulk ? (
					<div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
						<p className="text-sm font-medium text-slate-900">
							Apply <span className="font-semibold">{pendingBulk.label}</span> to{" "}
							{pendingBulk.items.length} file{pendingBulk.items.length === 1 ? "" : "s"}?
						</p>
						<p className="mt-1 text-xs text-slate-500">This rewrites files on disk and cannot be undone.</p>
						<div className="mt-3 flex gap-2">
							<Button size="sm" onClick={confirmBulk} disabled={busy}>
								Confirm
							</Button>
							<Button size="sm" variant="ghost" onClick={() => setPendingBulk(null)} disabled={busy}>
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<>
						<div className="flex flex-wrap items-center gap-2 border-slate-100 border-b pb-3">
							<label className="flex items-center gap-2 text-xs text-slate-600">
								<input
									type="checkbox"
									checked={allSelected}
									onChange={toggleSelectAll}
									className="h-4 w-4 rounded border-slate-300"
								/>
								{selected.size > 0 ? `${selected.size} selected` : "Select all"}
							</label>
							<div className="ml-auto flex flex-wrap gap-2">
								<Button size="sm" onClick={() => requestBulk("newer")}>
									Keep newer ({scopeNoun})
								</Button>
								<Button size="sm" variant="outline" onClick={() => requestBulk("keep-local")}>
									Keep local
								</Button>
								<Button size="sm" variant="outline" onClick={() => requestBulk("keep-remote")}>
									Keep remote
								</Button>
							</div>
						</div>

						<ul className="max-h-[26rem] space-y-2 overflow-y-auto">
							{conflicts.map((c) => {
								const newer = newerSide(c);
								const isOpen = expanded === c.file;
								const diff = diffs[c.file];
								return (
									<li key={c.file} className="rounded-lg border border-slate-200 p-3">
										<div className="flex items-start gap-3">
											<input
												type="checkbox"
												checked={selected.has(c.file)}
												onChange={() => toggleSelect(c.file)}
												className="mt-1 h-4 w-4 rounded border-slate-300"
												aria-label={`Select ${c.original}`}
											/>
											<div className="min-w-0 flex-1">
												<div className="flex items-center justify-between gap-2">
													<p
														className="truncate text-sm font-medium text-slate-900"
														title={c.original}
													>
														{c.original.split("/").pop()}
													</p>
													<Badge variant="secondary">{c.bucket}</Badge>
												</div>
												<div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-500">
													<MetaSide
														label="Local"
														size={c.originalSize}
														mtime={c.originalMtime}
														winner={newer === "local"}
													/>
													<MetaSide
														label={c.sourceName ?? c.sourceDevice ?? "Remote"}
														size={c.conflictSize}
														mtime={c.conflictMtime}
														winner={newer === "remote"}
													/>
												</div>
												{newer === "deleted" && (
													<p className="mt-1 text-amber-600 text-xs">
														Deleted on the other machine. “Keep newer” discards this orphan copy
														— select it and choose “Keep remote” to restore instead.
													</p>
												)}
												<div className="mt-2 flex flex-wrap items-center gap-2">
													<button
														type="button"
														onClick={() => toggleDiff(c.file)}
														className="flex items-center gap-0.5 text-slate-500 text-xs hover:text-slate-900"
													>
														{isOpen ? (
															<ChevronDown className="h-3.5 w-3.5" />
														) : (
															<ChevronRight className="h-3.5 w-3.5" />
														)}
														View diff
													</button>
												</div>
												{isOpen && <DiffView diff={diff} />}
											</div>
										</div>
									</li>
								);
							})}
						</ul>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

function MetaSide({
	label,
	size,
	mtime,
	winner,
}: {
	label: string;
	size: number | null;
	mtime: number | null;
	winner: boolean;
}) {
	return (
		<span className="flex items-center gap-1 truncate" title={formatDateTime(mtime)}>
			<span className="font-medium text-slate-600">{label}:</span>
			{size == null ? "missing" : formatBytes(size)} · {formatRelativeTime(mtime)}
			{winner && <span className="font-medium text-emerald-600">newer</span>}
		</span>
	);
}

function DiffView({ diff }: { diff: ConflictDiff | "loading" | undefined }) {
	if (diff === "loading" || diff === undefined) {
		return <p className="mt-2 text-slate-400 text-xs">Loading diff…</p>;
	}
	if (diff.status === "binary") {
		return <p className="mt-2 text-slate-400 text-xs">Binary file — no text diff.</p>;
	}
	if (diff.status === "too-large") {
		return <p className="mt-2 text-slate-400 text-xs">File too large to diff inline.</p>;
	}
	if (diff.status === "missing-original" || !diff.patch) {
		return <p className="mt-2 text-slate-400 text-xs">No diff available.</p>;
	}
	const lines = diff.patch.split("\n").slice(4); // drop the patch file headers
	return (
		<pre className="mt-2 max-h-60 overflow-auto rounded-md bg-slate-50 p-2 font-mono text-[11px] leading-relaxed">
			{lines.map((line, i) => {
				const color = line.startsWith("+")
					? "text-emerald-700"
					: line.startsWith("-")
						? "text-red-700"
						: line.startsWith("@@")
							? "text-sky-600"
							: "text-slate-500";
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: patch lines are a stable positional list
					<div key={i} className={color}>
						{line || " "}
					</div>
				);
			})}
		</pre>
	);
}
