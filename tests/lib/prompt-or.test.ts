import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isInteractive, promptOr, tryPrompt } from "../../src/lib/prompt-or.js";

class FakeExitPromptError extends Error {
	override name = "ExitPromptError" as const;
}

describe("prompt-or", () => {
	const originalInIsTTY = process.stdin.isTTY;
	const originalOutIsTTY = process.stdout.isTTY;
	const originalExit = process.exit;

	beforeEach(() => {
		// Mock process.exit by replacing the property with vi.fn()-backed function.
		// Cast through unknown so we don't fight lib.dom / @types/node interplay.
		Object.defineProperty(process, "exit", {
			value: vi.fn((code?: unknown) => {
				throw new Error(`process.exit called with ${String(code)}`);
			}),
			configurable: true,
			writable: true,
		});
	});

	afterEach(() => {
		Object.defineProperty(process.stdin, "isTTY", { value: originalInIsTTY, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: originalOutIsTTY, configurable: true });
		process.exit = originalExit;
	});

	function exitMock(): ReturnType<typeof vi.fn> {
		return process.exit as unknown as ReturnType<typeof vi.fn>;
	}

	function setTty(value: boolean | undefined): void {
		Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
	}

	describe("isInteractive", () => {
		it("returns true when both stdin and stdout are TTY", () => {
			setTty(true);
			expect(isInteractive()).toBe(true);
		});

		it("returns false when stdin is not TTY", () => {
			setTty(undefined);
			expect(isInteractive()).toBe(false);
		});

		it("returns false when stdout is not TTY", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
			Object.defineProperty(process.stdout, "isTTY", { value: undefined, configurable: true });
			expect(isInteractive()).toBe(false);
		});
	});

	describe("promptOr", () => {
		it("runs the fallback synchronously when not interactive", async () => {
			setTty(undefined);
			const interactive = vi.fn(async () => "interactive");
			const fallback = vi.fn(() => "fallback");
			const result = await promptOr(interactive, fallback);
			expect(result).toBe("fallback");
			expect(interactive).not.toHaveBeenCalled();
			expect(fallback).toHaveBeenCalledOnce();
		});

		it("runs the interactive branch in a TTY (mocked)", async () => {
			setTty(true);
			const interactive = vi.fn(async () => "interactive");
			const fallback = vi.fn(() => "fallback");
			const result = await promptOr(interactive, fallback);
			expect(result).toBe("interactive");
			expect(interactive).toHaveBeenCalledOnce();
			expect(fallback).not.toHaveBeenCalled();
		});

		it("supports async fallbacks", async () => {
			setTty(undefined);
			const interactive = vi.fn(async () => "interactive");
			const fallback = vi.fn(async () => "async-fallback");
			const result = await promptOr(interactive, fallback);
			expect(result).toBe("async-fallback");
		});
	});

	describe("tryPrompt", () => {
		it("catches ExitPromptError and calls process.exit(0)", async () => {
			setTty(true);
			const interactive = vi.fn(async () => {
				throw new FakeExitPromptError("ctrl-c");
			});
			const fallback = vi.fn(() => "fallback");
			await expect(tryPrompt(interactive, fallback)).rejects.toThrow("process.exit called with 0");
			expect(exitMock()).toHaveBeenCalledWith(0);
		});

		it("rethrows non-ExitPromptError errors", async () => {
			setTty(true);
			const interactive = vi.fn(async () => {
				throw new Error("boom");
			});
			const fallback = vi.fn(() => "fallback");
			await expect(tryPrompt(interactive, fallback)).rejects.toThrow("boom");
			expect(exitMock()).not.toHaveBeenCalled();
		});

		it("falls back gracefully in non-TTY mode without invoking process.exit", async () => {
			setTty(undefined);
			const interactive = vi.fn(async () => "interactive");
			const fallback = vi.fn(() => "fallback");
			const result = await tryPrompt(interactive, fallback);
			expect(result).toBe("fallback");
			expect(exitMock()).not.toHaveBeenCalled();
		});
	});
});
