import { type VariantProps, cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
	{
		variants: {
			variant: {
				default: "border-transparent bg-slate-900 text-white",
				secondary: "border-transparent bg-slate-100 text-slate-700",
				outline: "border-slate-200 text-slate-600",
				success: "border-transparent bg-emerald-100 text-emerald-700",
				muted: "border-transparent bg-slate-100 text-slate-400",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
	return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
