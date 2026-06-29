import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { FolderTree } from "@/components/FolderTree";
import { StepNav } from "@/components/StepNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { type State, getState, pairJoin, setupInit } from "@/lib/api";

type Mode = "create" | "join";

/** Friendly labels for the Claude buckets the wizard lets the user pick. */
const CLAUDE_PARTS: Array<{ key: string; label: string; hint: string; default: boolean }> = [
	{ key: "claude-config", label: "Settings & customisation", hint: "agents, commands, hooks, rules, skills", default: true },
	{ key: "claude-conversations", label: "Conversations", hint: "your Claude project history", default: true },
	{ key: "claude-agent-state", label: "Agent state", hint: "tasks, jobs, session env, file history", default: true },
	{ key: "claude-worktrees", label: "Worktrees", hint: "in-progress agent worktrees", default: true },
	{ key: "claude-plugins", label: "Plugins", hint: "installed plugins (larger, optional)", default: false },
];

const STORAGE_KEY = "ccsync-wizard";

interface Persisted {
	step: number;
	machineName: string;
	mode: Mode | null;
}

function loadPersisted(): Persisted | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as Persisted) : null;
	} catch {
		return null;
	}
}

export function Wizard({ initial, onDone }: { initial: State; onDone: () => void }) {
	const saved = loadPersisted();
	const [step, setStep] = useState<number>(saved?.step ?? 0);
	const [machineName, setMachineName] = useState(saved?.machineName ?? initial.machineName);
	const [mode, setMode] = useState<Mode | null>(saved?.mode ?? null);
	const [syncthingInstalled, setSyncthingInstalled] = useState(initial.syncthingInstalled);
	const [rechecking, setRechecking] = useState(false);

	const [token, setToken] = useState("");
	const [codeRoot, setCodeRoot] = useState<string | undefined>(undefined);
	const [ticked, setTicked] = useState<Set<string>>(new Set());
	const [buckets, setBuckets] = useState<Record<string, boolean>>(
		Object.fromEntries(CLAUDE_PARTS.map((p) => [p.key, p.default])),
	);

	const [submitting, setSubmitting] = useState(false);

	const steps =
		mode === "join"
			? ["Syncthing", "Name", "Connect", "Location"]
			: ["Syncthing", "Name", "Connect", "Folders", "Claude"];

	function persist(next: Partial<Persisted>) {
		const value: Persisted = { step, machineName, mode, ...next };
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
		} catch {
			// localStorage unavailable — resume is best-effort.
		}
	}

	function go(next: number) {
		setStep(next);
		persist({ step: next });
	}

	async function recheckSyncthing() {
		setRechecking(true);
		try {
			const s = await getState();
			setSyncthingInstalled(s.syncthingInstalled);
			if (!s.syncthingInstalled) toast.error("Still not finding Syncthing on PATH.");
		} finally {
			setRechecking(false);
		}
	}

	function toggleTick(relativePath: string) {
		setTicked((prev) => {
			const next = new Set(prev);
			if (next.has(relativePath)) next.delete(relativePath);
			else next.add(relativePath);
			return next;
		});
	}

	async function finish() {
		setSubmitting(true);
		try {
			if (mode === "join") {
				await pairJoin(token.trim(), codeRoot);
			} else {
				await setupInit({
					machineName: machineName.trim() || initial.machineName,
					codeRoot,
					// "." syncs the whole root when nothing more specific is ticked.
					codeFolders: codeRoot ? (ticked.size > 0 ? [...ticked] : ["."]) : undefined,
					buckets,
				});
			}
			try {
				localStorage.removeItem(STORAGE_KEY);
			} catch {
				// ignore
			}
			onDone();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Setup failed");
		} finally {
			setSubmitting(false);
		}
	}

	const lastStep = steps.length - 1;
	const canNext =
		step === 0
			? true
			: step === 1
				? machineName.trim().length > 0
				: step === 2
					? mode !== null && (mode === "create" || token.trim().length > 0)
					: true;

	return (
		<main className="mx-auto max-w-2xl p-6 sm:p-8">
			<header className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome to ccsync</h1>
			</header>
			<p className="mt-1 text-sm text-slate-500">
				Let's get your Claude setup syncing across machines.
			</p>

			<div className="mt-6">
				<StepNav steps={steps} current={Math.min(step, lastStep)} />
			</div>

			<Card className="mt-5">
				<CardContent>
					{step === 0 ? (
						<StepSyncthing
							installed={syncthingInstalled}
							rechecking={rechecking}
							onRecheck={recheckSyncthing}
						/>
					) : step === 1 ? (
						<StepName value={machineName} onChange={setMachineName} />
					) : step === 2 ? (
						<StepConnect mode={mode} onMode={(m) => { setMode(m); persist({ mode: m }); }} token={token} onToken={setToken} />
					) : mode === "join" ? (
						<StepLocation
							title="Where should the synced code root live on this machine?"
							hint="Pick a folder. We'll map the host's code root here."
							codeRoot={codeRoot}
							onSelect={setCodeRoot}
						/>
					) : step === 3 ? (
						<StepFolders
							codeRoot={codeRoot}
							onSelect={(p) => {
								setCodeRoot(p);
								setTicked(new Set());
							}}
							ticked={ticked}
							onToggleTick={toggleTick}
						/>
					) : (
						<StepClaude buckets={buckets} onToggle={(k, v) => setBuckets((b) => ({ ...b, [k]: v }))} />
					)}
				</CardContent>
			</Card>

			<div className="mt-5 flex items-center justify-between">
				<Button
					type="button"
					variant="ghost"
					disabled={step === 0 || submitting}
					onClick={() => go(step - 1)}
				>
					<ArrowLeft className="h-4 w-4" /> Back
				</Button>

				{step < lastStep ? (
					<Button type="button" disabled={!canNext} onClick={() => go(step + 1)}>
						Next <ArrowRight className="h-4 w-4" />
					</Button>
				) : (
					<Button type="button" disabled={submitting || !canNext} onClick={finish}>
						{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
						{mode === "join" ? "Join" : "Finish"}
					</Button>
				)}
			</div>
		</main>
	);
}

function StepSyncthing({
	installed,
	rechecking,
	onRecheck,
}: {
	installed: boolean;
	rechecking: boolean;
	onRecheck: () => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			<h2 className="text-lg font-medium text-slate-900">1. Syncthing engine</h2>
			{installed ? (
				<p className="flex items-center gap-2 text-sm text-emerald-600">
					<CheckCircle2 className="h-4 w-4" /> Syncthing is installed and ready.
				</p>
			) : (
				<div className="flex flex-col gap-3">
					<p className="flex items-center gap-2 text-sm text-amber-600">
						<XCircle className="h-4 w-4" /> Syncthing isn't on your PATH yet.
					</p>
					<p className="text-sm text-slate-500">
						Install it, then re-check. On macOS:
					</p>
					<code className="rounded-md bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100">
						brew install syncthing
					</code>
					<p className="text-xs text-slate-400">
						Other systems: see https://syncthing.net/downloads/. ccsync will also try to install it
						automatically when you finish.
					</p>
					<div>
						<Button type="button" variant="outline" size="sm" onClick={onRecheck} disabled={rechecking}>
							{rechecking ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Re-check
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function StepName({ value, onChange }: { value: string; onChange: (v: string) => void }) {
	return (
		<div className="flex flex-col gap-3">
			<h2 className="text-lg font-medium text-slate-900">2. Name this machine</h2>
			<p className="text-sm text-slate-500">A friendly name so you can tell your machines apart.</p>
			<Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. macbook-pro" />
		</div>
	);
}

function StepConnect({
	mode,
	onMode,
	token,
	onToken,
}: {
	mode: Mode | null;
	onMode: (m: Mode) => void;
	token: string;
	onToken: (v: string) => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			<h2 className="text-lg font-medium text-slate-900">3. Connect</h2>
			<div className="grid gap-3 sm:grid-cols-2">
				<button
					type="button"
					onClick={() => onMode("create")}
					className={`rounded-lg border p-4 text-left transition-colors ${
						mode === "create" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50"
					}`}
				>
					<p className="font-medium text-slate-900">Create my first machine</p>
					<p className="mt-1 text-xs text-slate-500">This is the first computer I'm setting up.</p>
				</button>
				<button
					type="button"
					onClick={() => onMode("join")}
					className={`rounded-lg border p-4 text-left transition-colors ${
						mode === "join" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50"
					}`}
				>
					<p className="font-medium text-slate-900">Join an existing machine</p>
					<p className="mt-1 text-xs text-slate-500">Paste an invite token from another computer.</p>
				</button>
			</div>

			{mode === "join" ? (
				<div className="flex flex-col gap-2">
					<label htmlFor="invite-token" className="text-sm text-slate-600">
						Invite token
					</label>
					<Input
						id="invite-token"
						value={token}
						onChange={(e) => onToken(e.target.value)}
						placeholder="ccs2_…"
						className="font-mono"
					/>
				</div>
			) : null}
		</div>
	);
}

function StepFolders({
	codeRoot,
	onSelect,
	ticked,
	onToggleTick,
}: {
	codeRoot?: string;
	onSelect: (p: string) => void;
	ticked: Set<string>;
	onToggleTick: (rel: string) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			<h2 className="text-lg font-medium text-slate-900">4. Pick your code root</h2>
			<p className="text-sm text-slate-500">
				Choose the folder that holds your projects, then tick the subfolders to sync (or leave all
				unticked to sync the whole root).
			</p>
			<FolderTree value={codeRoot} onSelect={onSelect} ticked={ticked} onToggleTick={onToggleTick} />
			{codeRoot ? (
				<p className="text-xs text-slate-500">
					Root: <span className="font-mono">{codeRoot}</span>
					{ticked.size > 0 ? ` · ${ticked.size} folder(s) selected` : " · whole root"}
				</p>
			) : (
				<p className="text-xs text-amber-600">Pick a folder to use as your code root.</p>
			)}
		</div>
	);
}

function StepLocation({
	title,
	hint,
	codeRoot,
	onSelect,
}: {
	title: string;
	hint: string;
	codeRoot?: string;
	onSelect: (p: string) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			<h2 className="text-lg font-medium text-slate-900">4. Choose a location</h2>
			<p className="text-sm text-slate-500">{title}</p>
			<p className="text-xs text-slate-400">{hint}</p>
			<FolderTree value={codeRoot} onSelect={onSelect} />
			{codeRoot ? (
				<p className="text-xs text-slate-500">
					Local root: <span className="font-mono">{codeRoot}</span>
				</p>
			) : (
				<p className="text-xs text-slate-400">
					Optional — only needed if the invite carries a code root.
				</p>
			)}
		</div>
	);
}

function StepClaude({
	buckets,
	onToggle,
}: {
	buckets: Record<string, boolean>;
	onToggle: (key: string, value: boolean) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			<h2 className="text-lg font-medium text-slate-900">5. What to sync</h2>
			<p className="text-sm text-slate-500">Pick which parts of your Claude setup to keep in sync.</p>
			<ul className="flex flex-col divide-y divide-slate-100">
				{CLAUDE_PARTS.map((part) => (
					<li key={part.key} className="flex items-center justify-between py-3">
						<div>
							<p className="text-sm font-medium text-slate-900">{part.label}</p>
							<p className="text-xs text-slate-400">{part.hint}</p>
						</div>
						<Switch
							checked={Boolean(buckets[part.key])}
							onCheckedChange={(v) => onToggle(part.key, v)}
						/>
					</li>
				))}
			</ul>
		</div>
	);
}
