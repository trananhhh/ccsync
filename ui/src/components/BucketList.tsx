import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { MonitorState } from "@/lib/api";
import { formatBytes } from "@/lib/format";

type Folder = MonitorState["folders"][number];

interface BucketRow {
	name: string;
	enabled: boolean;
}

interface BucketListProps {
	buckets: BucketRow[];
	folders: Folder[];
	onToggle: (name: string, on: boolean) => void;
}

/** Aggregate the live folders that belong to one bucket into a single summary. */
function summarise(folders: Folder[]): { completion: number; needBytes: number; syncing: boolean } {
	if (folders.length === 0) return { completion: 100, needBytes: 0, syncing: false };
	const completion = Math.min(...folders.map((f) => f.completion));
	const needBytes = folders.reduce((acc, f) => acc + f.needBytes, 0);
	const syncing = folders.some((f) => f.state === "syncing" || f.needBytes > 0);
	return { completion, needBytes, syncing };
}

function SyncStatus({ folders, enabled }: { folders: Folder[]; enabled: boolean }) {
	if (!enabled) return <span className="text-xs text-slate-400">Off</span>;
	const { completion, needBytes, syncing } = summarise(folders);
	if (syncing) {
		return (
			<span className="text-xs text-amber-600">
				Syncing {completion}% · {formatBytes(needBytes)} left
			</span>
		);
	}
	return <span className="text-xs text-emerald-600">In sync</span>;
}

export function BucketList({ buckets, folders, onToggle }: BucketListProps) {
	return (
		<Card>
			<CardContent className="p-0">
				<ul className="divide-y divide-slate-100">
					{buckets.map((b) => {
						const owned = folders.filter((f) => f.bucket === b.name);
						return (
							<li key={b.name} className="flex items-center justify-between gap-4 px-5 py-3">
								<div className="min-w-0">
									<p className="truncate font-medium text-slate-900">{b.name}</p>
									<SyncStatus folders={owned} enabled={b.enabled} />
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
	);
}
