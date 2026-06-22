export function isInteractive(): boolean {
	return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

function isExitPromptError(err: unknown): boolean {
	if (typeof err !== "object" || err === null) return false;
	const name = (err as { name?: unknown }).name;
	return name === "ExitPromptError";
}

export async function promptOr<T>(
	interactive: () => Promise<T>,
	fallback: () => T | Promise<T>,
): Promise<T> {
	if (!isInteractive()) {
		return await fallback();
	}
	return await interactive();
}

export async function tryPrompt<T>(
	interactive: () => Promise<T>,
	fallback: () => T | Promise<T>,
): Promise<T> {
	try {
		return await promptOr(interactive, fallback);
	} catch (err) {
		if (isExitPromptError(err)) {
			process.exit(0);
		}
		throw err;
	}
}
