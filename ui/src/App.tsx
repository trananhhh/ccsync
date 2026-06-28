import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { type State, getState, toggleBucket } from "@/lib/api";

export function App() {
	const [state, setState] = useState<State | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		getState()
			.then(setState)
			.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
	}, []);

	async function onToggle(name: string, on: boolean) {
		// optimistic update, reconcile from the server response
		setState((s) =>
			s ? { ...s, buckets: s.buckets.map((b) => (b.name === name ? { ...b, enabled: on } : b)) } : s,
		);
		try {
			await toggleBucket(name, on);
			setState(await getState());
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	return (
		<main className="mx-auto max-w-2xl p-8">
			<h1 className="text-2xl font-semibold tracking-tight">ccsync</h1>
			{error && <p className="mt-2 text-sm text-red-600">{error}</p>}
			{!state ? (
				<p className="mt-4 text-slate-500">Loading…</p>
			) : (
				<div className="mt-6 space-y-6">
					<p className="text-sm text-slate-500">
						Machine <span className="font-medium text-slate-900">{state.machineName}</span>
						{state.metered && " · metered"}
					</p>
					<ul className="divide-y rounded-lg border">
						{state.buckets.map((b) => (
							<li key={b.name} className="flex items-center justify-between px-4 py-3">
								<span className="font-medium">{b.name}</span>
								<Switch
									checked={b.enabled}
									onCheckedChange={(on) => onToggle(b.name, on)}
									aria-label={`Toggle ${b.name}`}
								/>
							</li>
						))}
					</ul>
				</div>
			)}
		</main>
	);
}
