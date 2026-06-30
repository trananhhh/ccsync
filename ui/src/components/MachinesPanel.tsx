import { FolderGit2, Laptop } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { getMachines, type Machine } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

/**
 * Cross-machine view: every machine in the mesh publishes its code-root path(s)
 * into a synced registry, so this panel shows "this machine syncs X, the other
 * machine syncs Y" — readable even while the peer is offline (last-synced
 * snapshot). Read-only; configuring a peer from here is intentionally not exposed.
 */
export function MachinesPanel() {
	const [machines, setMachines] = useState<Machine[] | null>(null);

	useEffect(() => {
		let alive = true;
		const load = () =>
			getMachines()
				.then((m) => alive && setMachines(m))
				.catch(() => alive && setMachines([]));
		load();
		const id = setInterval(load, 10000);
		return () => {
			alive = false;
			clearInterval(id);
		};
	}, []);

	if (!machines || machines.length === 0) return null;

	const parseIso = (iso: string): number | null => {
		const t = Date.parse(iso);
		return Number.isNaN(t) ? null : t;
	};
	const sorted = [...machines].sort((a, b) => Number(b.self) - Number(a.self));

	return (
		<Card>
			<CardContent className="p-4">
				<p className="flex items-center gap-2 font-medium text-slate-900 text-sm">
					<Laptop className="h-4 w-4 text-slate-500" />
					Machines
				</p>
				<ul className="mt-3 space-y-2">
					{sorted.map((m) => (
						<li key={m.deviceId} className="rounded-md border border-slate-200 px-3 py-2">
							<div className="flex items-center justify-between gap-3">
								<p className="flex items-center gap-2 truncate font-medium text-slate-900 text-sm">
									{m.machineName}
									{m.self && (
										<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
											this machine
										</span>
									)}
								</p>
								<span
									className={`flex items-center gap-1.5 text-[11px] ${
										m.online ? "text-emerald-600" : "text-slate-400"
									}`}
								>
									<span
										className={`h-1.5 w-1.5 rounded-full ${
											m.online ? "bg-emerald-500" : "bg-slate-300"
										}`}
									/>
									{m.online ? "online" : "offline"}
								</span>
							</div>
							<div className="mt-1.5 space-y-1">
								{m.codeRoots.length > 0 ? (
									m.codeRoots.map((p) => (
										<p
											key={p}
											className="flex items-center gap-1.5 truncate font-mono text-[11px] text-slate-500"
										>
											<FolderGit2 className="h-3 w-3 shrink-0 text-slate-400" />
											{p}
										</p>
									))
								) : (
									<p className="text-[11px] text-slate-400">no code root configured</p>
								)}
							</div>
							<p className="mt-1 text-[10px] text-slate-400">
								v{m.version} · updated {formatRelativeTime(parseIso(m.updatedAt))}
							</p>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
