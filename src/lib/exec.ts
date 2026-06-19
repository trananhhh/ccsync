import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function run(
	cmd: string,
	args: string[],
	opts: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
	const { stdout, stderr } = await execFileAsync(cmd, args, {
		cwd: opts.cwd,
		maxBuffer: 16 * 1024 * 1024,
	});
	return { stdout: stdout.toString(), stderr: stderr.toString() };
}

export async function which(cmd: string): Promise<string | null> {
	try {
		const finder = process.platform === "win32" ? "where" : "which";
		const { stdout } = await run(finder, [cmd]);
		const first = stdout.split(/\r?\n/).find(Boolean);
		return first ?? null;
	} catch {
		return null;
	}
}

export function spawnDetached(cmd: string, args: string[], opts: { cwd?: string } = {}): number {
	const child = spawn(cmd, args, {
		cwd: opts.cwd,
		detached: true,
		stdio: "ignore",
	});
	child.unref();
	return child.pid ?? -1;
}
