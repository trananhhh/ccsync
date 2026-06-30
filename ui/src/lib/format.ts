const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Human-readable byte count, e.g. 1536 → "1.5 KB". */
export function formatBytes(bytes: number): string {
	if (bytes <= 0) return "0 B";
	const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	const value = bytes / 1024 ** i;
	return `${i === 0 ? value : value.toFixed(1)} ${UNITS[i]}`;
}

/** Transfer rate, e.g. 2048 → "2.0 KB/s". */
export function formatRate(bytesPerSec: number): string {
	return `${formatBytes(bytesPerSec)}/s`;
}

/** Compact relative time from an epoch-ms timestamp, e.g. "3m ago", "2d ago". */
export function formatRelativeTime(ms: number | null): string {
	if (!ms) return "—";
	const diff = Date.now() - ms;
	if (diff < 0) return "just now";
	const secs = Math.floor(diff / 1000);
	if (secs < 60) return "just now";
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(months / 12)}y ago`;
}

/** Absolute local datetime for tooltips, e.g. "2026-06-30 14:07". */
export function formatDateTime(ms: number | null): string {
	if (!ms) return "—";
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
