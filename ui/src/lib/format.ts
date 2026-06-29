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
