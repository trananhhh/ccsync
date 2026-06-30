import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MonitorState } from "@/lib/api";
import { bucketDescription } from "@/lib/bucket-meta";
import { formatBytes } from "@/lib/format";

type Folder = MonitorState["folders"][number];

interface BucketRow {
	name: string;
	enabled: boolean;
	paths: string[];
}

interface BucketListProps {
	buckets: BucketRow[];
	folders: Folder[];
	/** Connected peer count, so a stalled bucket can say *why* nothing moves. */
	peersOnline: number;
	onToggle: (name: string, on: boolean) => void;
}

type Tone = "ok" | "sync" | "warn";

/** Collapse a bucket's live folders into one status line that explains stalls. */
function summarise(
	folders: Folder[],
	peersOnline: number,
): { text: string; tone: Tone } {
	if (folders.length === 0) return { text: "In sync", tone: "ok" };
	const completion = Math.min(...folders.map((f) => f.completion));
	const needBytes = folders.reduce((acc, f) => acc + f.needBytes, 0);

	if (folders.some((f) => f.state === "syncing")) {
		return { text: `Syncing ${completion}% · ${formatBytes(needBytes)} left`, tone: "sync" };
	}
	if (needBytes > 0) {
		// Bytes outstanding but nothing transferring: explain why instead of a
		// misleading "Syncing" that looks frozen.
		if (peersOnline === 0) {
			return {
				text: `Waiting · peer offline · ${formatBytes(needBytes)} left`,
				tone: "warn",
			};
		}
		const preparing = folders.some(
			(f) => f.state === "scan-waiting" || f.state === "sync-preparing" || f.state === "scanning",
		);
		return {
			text: `${preparing ? "Preparing" : "Queued"} ${completion}% · ${formatBytes(needBytes)} left`,
			tone: "sync",
		};
	}
	return { text: "In sync", tone: "ok" };
}

const TONE_CLASS: Record<Tone, string> = {
	ok: "text-emerald-600",
	sync: "text-amber-600",
	warn: "text-red-600",
};

function SyncStatus({
	folders,
	enabled,
	peersOnline,
}: {
	folders: Folder[];
	enabled: boolean;
	peersOnline: number;
}) {
	if (!enabled) return <span className="text-slate-400 text-xs">Off</span>;
	const { text, tone } = summarise(folders, peersOnline);
	return <span className={`text-xs ${TONE_CLASS[tone]}`}>{text}</span>;
}

function BucketTooltip({ name, paths }: { name: string; paths: string[] }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button type="button" aria-label={`About ${name}`} className="text-slate-300 hover:text-slate-500">
					<Info className="h-3.5 w-3.5" />
				</button>
			</TooltipTrigger>
			<TooltipContent>
				<p>{bucketDescription(name)}</p>
				<p className="mt-1 text-slate-300">
					{paths.length > 0 ? "Paths on this machine:" : "Not configured on this machine."}
				</p>
				{paths.map((p) => (
					<p key={p} className="font-mono text-[11px] text-slate-200">
						{p}
					</p>
				))}
			</TooltipContent>
		</Tooltip>
	);
}

export function BucketList({ buckets, folders, peersOnline, onToggle }: BucketListProps) {
	return (
		<TooltipProvider delayDuration={150}>
			<Card>
				<CardContent className="p-0">
					<ul className="divide-y divide-slate-100">
						{buckets.map((b) => {
							const owned = folders.filter((f) => f.bucket === b.name);
							return (
								<li key={b.name} className="flex items-center justify-between gap-4 px-5 py-3">
									<div className="min-w-0">
										<div className="flex items-center gap-1.5">
											<p className="truncate font-medium text-slate-900">{b.name}</p>
											<BucketTooltip name={b.name} paths={b.paths} />
										</div>
										<SyncStatus folders={owned} enabled={b.enabled} peersOnline={peersOnline} />
									</div>
									<Switch
										checked={b.enabled}
										onCheckedChange={(on) => onToggle(b.name, on)}
										aria-label={`Toggle ${b.name}`}
									/>
								</li>
							);
						})}
					</ul>
				</CardContent>
			</Card>
		</TooltipProvider>
	);
}
