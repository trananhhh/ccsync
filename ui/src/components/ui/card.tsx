import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn("rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm", className)}
			{...props}
		/>
	);
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("flex flex-col gap-1 px-5 pt-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
	return <h3 className={cn("font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("px-5 py-4", className)} {...props} />;
}
