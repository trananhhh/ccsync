import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Dashboard } from "@/pages/Dashboard";
import { type State, getState } from "@/lib/api";

export function App() {
	const [state, setState] = useState<State | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		getState()
			.then(setState)
			.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
	}, []);

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
			) : (
				<Dashboard initial={state} />
			)}
			<Toaster />
		</>
	);
}
