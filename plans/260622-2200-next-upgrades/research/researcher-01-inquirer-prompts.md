# `@inquirer/prompts` Adoption Research

**Project:** `ccsync` v0.5.9 — TypeScript ESM, Node ≥20.0.0 (per `package.json`).
**Method:** registry lookups via `npm view` (2026-06-22) + GitHub README cross-check.

> **Naming correction:** the package is **`@inquirer/prompts`** (plural). `@inquirer/promises` does not exist on npm as of 2026-06-22. Every import in this report uses the correct name.

## 1. Library landscape (verified today)

| Need | Package | Version | unpacked |
|---|---|---|---|
| Umbrella (re-exports the rest) | `@inquirer/prompts` | `8.5.2` | 23.4 kB |
| Checkbox multi-select | `@inquirer/checkbox` | `5.2.1` | 20.5 kB |
| Plain input | `@inquirer/input` | `5.1.2` | 12.3 kB |
| Single-select | `@inquirer/select` | `5.2.1` | 17.5 kB |
| Confirm Y/n | `@inquirer/confirm` | `6.1.1` | 6.9 kB |
| Single-keystroke list | `@inquirer/rawlist` | `5.3.1` | 13.3 kB |
| Shared core (transitive) | `@inquirer/core` | `11.2.1` | 58.9 kB |

**Recommendation:** ship **`@inquirer/prompts`** as a single dep — it re-exports every needed prompt and dedupes `@inquirer/core`. Per-package installs don't pay off under tsup bundling.

**Alternatives not recommended:**
- `inquirer@14` legacy-style callback API, 60 kB, worse DX.
- `prompts@2.4.2` (terkelg) — unmaintained, callback.
- `enquirer@2.4.1` — 188 kB, less ergonomic for toggle UX.

**Engine floor caveat:** `@inquirer/prompts@8` requires `node ^20.17.0 || ^22.13.0 || >=23.5.0`. ccsync currently declares `>=20.0.0`. Bump to `>=20.17.0` to install cleanly.

## 2. API sketch per ccsync use case

### a) Toggling multiple buckets with hints — `wizard.ts:pickBuckets()`

Match: **`checkbox`**. UX shift from "type-numbers" → "space-toggles". Pre-selected defaults map to `checked`:

```ts
const picked = await checkbox<string>({
  message: "What to sync? (space to toggle, enter to confirm)",
  pageSize: BUCKET_LABELS.length,
  choices: BUCKET_LABELS.map((b) => ({
    value: b.key,
    name: b.label,
    description: pc.dim(b.hint),
    checked: buckets[b.key].enabled,
  })),
});
```

⚠ **`a /path` add-custom-path flow** in `pickProjects`/`pickCodeFolders` has no native inquirer equivalent. Three options:
1. Drop the feature.
2. Two-step: yes/no → another `input` prompt.
3. Custom prompt against `@inquirer/core`. (scope decision flagged for user)

### b) Inline input with `[bracket]` default — `setup.ts:configureRootProfile`

Match: **`input`**. `default` pre-fills; not literal `[bracket]` but visually equivalent. Use `transformer` for exact parity.

```ts
const root = await input({ message: "Code root", default: suggestedRoot });
```

### c) `[Y/n]` confirm — `pickCodeFolders` follow-up, `manualAcceptPrompt`

Match: **`confirm`**. `default: true` renders `(Y/n)`, `default: false` renders `(y/N)` — exact spec match.

```ts
const ok = await confirm({ message: "Sync the entire root?", default: true });
```

### d) Single-keystroke shortcut — `interactive.ts:shortcutPrompt`

Match: **`rawlist`**. Single letter jumps straight to choice:

```ts
const ans = await rawlist({
  message: "Action",
  choices: [
    { name: "status detail",    value: "s", key: "s" },
    { name: "add a machine",    value: "n", key: "n" },
    { name: "conflicts",        value: "c", key: "c" },
    { name: "release & switch", value: "r", key: "r" },
    { name: "quit",             value: "q", key: "q" },
  ],
});
```

UX trade-off: current code lets blank Enter be a no-op early-quit; `rawlist` forces selection. Acceptable.

## 3. Spinner

| Lib | unpacked | API | Notes |
|---|---|---|---|
| **`nanospinner@1.2.2`** | 10.9 kB | `.start() / .success / .warn / .error` | tiny, 1 dep, color via picocolors |
| `cli-spinners@3.4.0` | 33.9 kB | JSON frames only | data-only |
| `ora@9.4.0` | 40.1 kB | full-featured | 8 deps including `chalk`, heavy |

**Pick `nanospinner`.** Replaces `log.step(...)` with an in-place `\r` rewrite:

```ts
const s = createSpinner("Bootstrapping Syncthing identity…").start();
await generateHome(stHome);
s.success({ text: pc.green("Syncthing identity ready") });
```

**TTY guard:** `process.stdout.isTTY === false` ⇒ don't start the spinner — plain log output. This is critical for non-interactive runs (`ccsync setup <token>`, CI, pipes).

## 4. Key risks

- **TTY-only:** inquirer hangs if `process.stdin.isTTY === false`. Wrap each picker:
  ```ts
  function promptOr<T>(interactive: () => Promise<T>, fallback: T): Promise<T> {
    return process.stdin.isTTY && process.stdout.isTTY ? interactive() : fallback();
  }
  ```
  Fallback policy: keep currently-saved defaults; never prompt-empty-and-fail.
- **Ctrl-C:** throws `ExitPromptError`. Catch it and `process.exit(0)` so user gets a clean exit, not a stack trace.
- **Commander interaction:** inquirer writes to `process.stdout` directly with ANSI escapes. Commander has no TUI loop — no interference unless prompts fire after `program.parse()` returns.

## 5. Bundle cost

- Logical install: `@inquirer/prompts` 23.4 kB + transitive `@inquirer/core` 58.9 + figures/ansi ≈ 110 kB
- Plus `nanospinner` 11 kB
- **Total: ~120 kB logical, ~140 kB on disk**
- vs current: `commander@14` already ~140 kB; roughly +140 kB. Acceptable for the UX upgrade.

ESM-only: inquirer is ESM, ccsync is `"type": "module"` — fine.

## 6. Sketch — `pickBuckets()` rewrite (~30 lines, faithful)

```ts
import { checkbox } from "@inquirer/prompts";
import pc from "picocolors";
import type { Bucket } from "../core/config-schema.js";

interface BucketChoice { key: string; label: string; hint: string }
const BUCKET_LABELS: BucketChoice[] = [/* existing 5 buckets */];

function fallbackEnabled(buckets: Record<string, Bucket>): string[] {
  return BUCKET_LABELS.filter((b) => buckets[b.key]?.enabled).map((b) => b.key);
}

export async function pickBuckets(buckets: Record<string, Bucket>) {
  const present = BUCKET_LABELS.filter((b) => buckets[b.key]);
  const pickedKeys = process.stdin.isTTY
    ? await checkbox<string>({
        message: "What to sync? (space to toggle, enter to confirm)",
        pageSize: present.length,
        choices: present.map((b) => ({
          value: b.key, name: b.label,
          description: pc.dim(b.hint),
          checked: buckets[b.key].enabled,
        })),
      })
    : fallbackEnabled(buckets);

  const next: Record<string, Bucket> = { ...buckets };
  for (const b of present) next[b.key] = { ...buckets[b.key], enabled: pickedKeys.includes(b.key) };
  return next;
}
```

**Faithfulness:** defaults preserved via `checked`. Hints preserved via `description`. Fallback on non-TTY keeps current `.enabled` state — no hangs in scripts.

---

## Unresolved questions

1. **Engine floor bump**: ccsync ships `>=20.0.0`; inquirer needs `>=20.17.0`. Confirm before merging.
2. **`a /path` add-custom feature**: inquirer has no native equivalent. Pick (1) drop (2) two-step (3) custom prompt.
3. **Smoke run**: API verified via GitHub READMEs + registry. No runtime smoke test performed.
