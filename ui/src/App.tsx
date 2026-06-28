import { useCallback, useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { type State, getState } from "@/lib/api";
import { Dashboard } from "@/pages/Dashboard";
import { Wizard } from "@/pages/Wizard";

export function App() {
	const [state, setState] = useState<State | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(() => {
		getState()
			.then(setState)
			.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
	}, []);

	useEffect(load, [load]);

	// A single top-level switch between the two views — Wizard until the machine
	// is configured, then the Dashboard. Two views don't justify a router dep.
	return (
		<>
			{error ? (
				<main className="mx-auto max-w-2xl p-8">
					<h1 className="text-2xl font-semibold tracking-tight">ccsync</h1>
					<p className="mt-2 text-sm text-red-600">{error}</p>
				</main>
			) : !state ? (
				<main className="mx-auto max-w-2xl p-8">
					<p className="text-slate-500">Loading…</p>
				</main>
			) : state.configured ? (
				<Dashboard initial={state} />
			) : (
				<Wizard initial={state} onDone={load} />
			)}
			<Toaster />
		</>
	);
}
