import { Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MeteredButtonProps {
	metered: boolean;
	onToggle: (on: boolean) => void;
	disabled?: boolean;
}

/**
 * One-click "Pause all [hotspot]" toggle. Fires the POST only; the metered flag
 * is reconciled from the next SSE push, never mutated locally.
 */
export function MeteredButton({ metered, onToggle, disabled }: MeteredButtonProps) {
	return (
		<Button
			variant={metered ? "default" : "outline"}
			onClick={() => onToggle(!metered)}
			disabled={disabled}
			aria-pressed={metered}
		>
			{metered ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
			{metered ? "Resume transfers" : "Pause all (hotspot)"}
		</Button>
	);
}
