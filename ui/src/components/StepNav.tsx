import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** A compact step indicator for the onboarding wizard. */
export function StepNav({ steps, current }: { steps: string[]; current: number }) {
	return (
		<ol className="flex items-center gap-2">
			{steps.map((label, i) => {
				const done = i < current;
				const active = i === current;
				return (
					<li key={label} className="flex items-center gap-2">
						<span
							className={cn(
								"flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
								done && "bg-slate-900 text-white",
								active && "border-2 border-slate-900 text-slate-900",
								!done && !active && "border border-slate-200 text-slate-400",
							)}
						>
							{done ? <Check className="h-3.5 w-3.5" /> : i + 1}
						</span>
						<span
							className={cn(
								"hidden text-xs sm:inline",
								active ? "font-medium text-slate-900" : "text-slate-400",
							)}
						>
							{label}
						</span>
						{i < steps.length - 1 ? <span className="h-px w-4 bg-slate-200" /> : null}
					</li>
				);
			})}
		</ol>
	);
}
