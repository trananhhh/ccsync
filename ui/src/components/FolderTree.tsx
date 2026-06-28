import { ChevronRight, Folder, FolderOpen, Home, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { type BrowseResult, browseFolders } from "@/lib/api";
import { cn } from "@/lib/utils";

interface FolderTreeProps {
	/** Currently chosen directory (the code root), or undefined for none yet. */
	value?: string;
	onSelect: (path: string) => void;
	/** Optional multi-select of subdirectories beneath `value`. */
	ticked?: Set<string>;
	onToggleTick?: (relativePath: string) => void;
}

/**
 * A read-only directory browser backed by `/api/folders/browse`. The server
 * confines every listing to the user's home, so the tree can never escape it.
 * Clicking a folder both navigates into it and selects it as the current dir.
 */
export function FolderTree({ value, onSelect, ticked, onToggleTick }: FolderTreeProps) {
	const [listing, setListing] = useState<BrowseResult | null>(null);
	const [cwd, setCwd] = useState<string | undefined>(value);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		browseFolders(cwd)
			.then((res) => {
				if (cancelled) return;
				setListing(res);
			})
			.catch((e: unknown) => {
				if (cancelled) return;
				setError(e instanceof Error ? e.message : String(e));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [cwd]);

	function open(path: string) {
		setCwd(path);
		onSelect(path);
	}

	return (
		<div className="rounded-md border border-slate-200">
			<div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 gap-1 px-2"
					onClick={() => setCwd(undefined)}
				>
					<Home className="h-3.5 w-3.5" /> Home
				</Button>
				{listing?.parent ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 px-2"
						onClick={() => open(listing.parent as string)}
					>
						Up
					</Button>
				) : null}
				<span className="truncate font-mono">{listing?.path ?? "…"}</span>
			</div>

			<div className="max-h-64 overflow-y-auto p-1">
				{loading ? (
					<div className="flex items-center gap-2 px-3 py-6 text-sm text-slate-500">
						<Loader2 className="h-4 w-4 animate-spin" /> Loading…
					</div>
				) : error ? (
					<p className="px-3 py-6 text-sm text-red-600">{error}</p>
				) : listing && listing.entries.length === 0 ? (
					<p className="px-3 py-6 text-sm text-slate-400">No subfolders here.</p>
				) : (
					listing?.entries.map((entry) => {
						const isCurrent = entry.path === value;
						const relative = value ? relPath(value, entry.path) : undefined;
						const isTicked = relative !== undefined && ticked?.has(relative);
						return (
							<div
								key={entry.path}
								className={cn(
									"flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50",
									isCurrent && "bg-slate-100",
								)}
							>
								{onToggleTick && relative !== undefined ? (
									<input
										type="checkbox"
										className="h-4 w-4 accent-slate-900"
										checked={Boolean(isTicked)}
										onChange={() => onToggleTick(relative)}
										aria-label={`Sync ${entry.name}`}
									/>
								) : null}
								<button
									type="button"
									className="flex flex-1 items-center gap-2 text-left"
									onClick={() => open(entry.path)}
								>
									{isCurrent ? (
										<FolderOpen className="h-4 w-4 text-slate-500" />
									) : (
										<Folder className="h-4 w-4 text-slate-400" />
									)}
									<span className="truncate">{entry.name}</span>
									<ChevronRight className="ml-auto h-4 w-4 text-slate-300" />
								</button>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}

/** Relative path of `child` under `base`, used as the codeFolder key. */
function relPath(base: string, child: string): string {
	const prefix = base.endsWith("/") ? base : `${base}/`;
	return child.startsWith(prefix) ? child.slice(prefix.length) : child;
}
