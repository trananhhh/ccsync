import { Check, Copy, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { getState, pairInvite } from "@/lib/api";

/**
 * Generate a one-time invite token and wait for the new machine to join. The
 * inviting machine's service auto-accepts the joiner in-process, so this dialog
 * just shows the token + a ready-to-paste command and polls for the new peer.
 */
export function AddMachineDialog({ trigger }: { trigger: React.ReactNode }) {
	const [open, setOpen] = useState(false);
	const [token, setToken] = useState<string | null>(null);
	const [command, setCommand] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [joined, setJoined] = useState(false);
	const baselinePeers = useRef<number>(0);

	useEffect(() => {
		if (!open) {
			setToken(null);
			setCommand(null);
			setError(null);
			setCopied(false);
			setJoined(false);
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const baseline = await getState();
				baselinePeers.current = baseline.peers.length;
				const inv = await pairInvite();
				if (cancelled) return;
				setToken(inv.token);
				setCommand(inv.command);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [open]);

	// Poll for the new peer while the dialog is open and waiting.
	useEffect(() => {
		if (!open || !token || joined) return;
		const timer = setInterval(async () => {
			const state = await getState().catch(() => null);
			if (state && state.peers.length > baselinePeers.current) {
				setJoined(true);
			}
		}, 3000);
		return () => clearInterval(timer);
	}, [open, token, joined]);

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error("Could not copy to clipboard");
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add a machine</DialogTitle>
					<DialogDescription>
						Run this on the other computer. It expires in 10 minutes. Keep this window open until it
						joins.
					</DialogDescription>
				</DialogHeader>

				{error ? (
					<p className="text-sm text-red-600">{error}</p>
				) : !command ? (
					<div className="flex items-center gap-2 py-6 text-sm text-slate-500">
						<Loader2 className="h-4 w-4 animate-spin" /> Generating invite…
					</div>
				) : (
					<div className="flex flex-col gap-4">
						<div className="flex items-stretch gap-2">
							<code className="flex-1 overflow-x-auto rounded-md bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100">
								{command}
							</code>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => copy(command)}
								aria-label="Copy command"
							>
								{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
							</Button>
						</div>

						<div className="flex items-center gap-2 text-sm">
							{joined ? (
								<span className="flex items-center gap-2 font-medium text-emerald-600">
									<Check className="h-4 w-4" /> Machine joined — syncing.
								</span>
							) : (
								<span className="flex items-center gap-2 text-slate-500">
									<Loader2 className="h-4 w-4 animate-spin" /> Waiting for the machine to join…
								</span>
							)}
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
