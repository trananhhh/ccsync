import { Toaster as Sonner, type ToasterProps } from "sonner";

/** App-wide toast host. Rendered once near the root. */
export function Toaster(props: ToasterProps) {
	return <Sonner position="bottom-right" richColors closeButton {...props} />;
}

export { toast } from "sonner";
