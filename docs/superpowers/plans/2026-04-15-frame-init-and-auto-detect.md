# `frame init` Command and Project-Root Auto-Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `frame init` (scaffolds `.frame/.gitignore` and copies bundled Claude Code skills into a target project) and auto-detect the project root by walking up from `cwd` looking for `.git` or `.frame/`.

**Architecture:** Two coupled changes. (1) A pure helper `findProjectRoot(start)` walks ancestors looking for `.git` or `.frame` markers; `resolveGlobal` in `src/cli.ts` calls it whenever the user did not explicitly pass `--root`. (2) A new `init(root)` function creates `.frame/.gitignore` (containing `*\n`) and copies two embedded skill markdowns into `<root>/.claude/skills/`. Skills are embedded into the compiled binary via Bun's existing `with { type: "file" }` pattern, with `.claude/skills/frame-context.md` and `.claude/skills/frame-populate.md` as the canonical source. `init` is idempotent: each file is exists-checked before write and reported as `created` or `skipped`.

**Tech Stack:** TypeScript on Bun. `commander` for CLI parsing. `bun:test` for tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-15-frame-init-and-auto-detect-design.md`

---

## File Structure

| Path | Purpose | Action |
|---|---|---|
| `src/core/root.ts` | New. Exports `findProjectRoot(start)`. Pure, sync, no I/O beyond `existsSync`. | Create |
| `src/core/init.ts` | New. Exports `init(root)` and the `InitResult`/`InitOutcome` types. Embeds skill markdown via Bun file imports. | Create |
| `src/core/formatter.ts` | Modify. Add `formatInitResult`. Update `COMMANDS` table, `TOP_LEVEL_HELP`, `AGENT_HELP` to include `init` and the new `--root` default text. | Modify |
| `src/cli.ts` | Modify. (1) `addSharedOpts` removes the `process.cwd()` default for `--root`. (2) `resolveGlobal` calls `findProjectRoot` when `opts.root` is undefined. (3) Register the `init` command. | Modify |
| `tests/core/root.test.ts` | New. Unit tests for `findProjectRoot`. | Create |
| `tests/core/init.test.ts` | New. Unit tests for `init` and `formatInitResult`. | Create |
| `tests/integration/cli.test.ts` | Modify. Add integration tests for `frame init` and auto-detection from a subdirectory. | Modify |
| `README.md` | Modify. Add `frame init` to install/quick-start/commands sections; update `--root` description in Global options table. | Modify |

---

## Task 1: `findProjectRoot` helper

**Files:**
- Create: `src/core/root.ts`
- Test: `tests/core/root.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/root.test.ts` with the following content:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectRoot } from "../../src/core/root.ts";

let tempDir: string;

beforeEach(async () => {
  // realpath resolves macOS /var → /private/var so path comparisons match.
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "root-test-")));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("findProjectRoot", () => {
  test("returns ancestor with .git directory", async () => {
    await mkdir(join(tempDir, ".git"), { recursive: true });
    await mkdir(join(tempDir, "src", "utils"), { recursive: true });

    const result = findProjectRoot(join(tempDir, "src", "utils"));

    expect(result).toBe(tempDir);
  });

  test("returns ancestor with .git file (worktree case)", async () => {
    await writeFile(join(tempDir, ".git"), "gitdir: /elsewhere\n");
    await mkdir(join(tempDir, "src"), { recursive: true });

    const result = findProjectRoot(join(tempDir, "src"));

    expect(result).toBe(tempDir);
  });

  test("returns ancestor with .frame directory", async () => {
    await mkdir(join(tempDir, ".frame"), { recursive: true });
    await mkdir(join(tempDir, "deep", "nested"), { recursive: true });

    const result = findProjectRoot(join(tempDir, "deep", "nested"));

    expect(result).toBe(tempDir);
  });

  test("returns start when no marker found anywhere on path", async () => {
    await mkdir(join(tempDir, "isolated"), { recursive: true });

    const result = findProjectRoot(join(tempDir, "isolated"));

    expect(result).toBe(join(tempDir, "isolated"));
  });

  test("closest marker wins when both .git and .frame exist on path", async () => {
    // Outer .git, inner .frame. cwd is below both. Closest (.frame) wins.
    await mkdir(join(tempDir, ".git"), { recursive: true });
    await mkdir(join(tempDir, "sub", ".frame"), { recursive: true });
    await mkdir(join(tempDir, "sub", "deep"), { recursive: true });

    const result = findProjectRoot(join(tempDir, "sub", "deep"));

    expect(result).toBe(join(tempDir, "sub"));
  });

  test("returns start itself if marker is in start directory", async () => {
    await mkdir(join(tempDir, ".git"), { recursive: true });

    const result = findProjectRoot(tempDir);

    expect(result).toBe(tempDir);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/root.test.ts`
Expected: FAIL with module-not-found error for `../../src/core/root.ts`.

- [ ] **Step 3: Implement `findProjectRoot`**

Create `src/core/root.ts` with the following content:

```ts
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Walk up from `start` looking for a `.git` or `.frame` entry (file or directory).
 * Returns the first ancestor (including `start` itself) that contains either marker,
 * or `start` if no marker is found anywhere up the chain.
 *
 * Both markers are treated as equally valid; whichever is closer to `start` wins.
 */
export function findProjectRoot(start: string): string {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, ".git")) || existsSync(join(dir, ".frame"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // Reached filesystem root with no marker found.
      return start;
    }
    dir = parent;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/root.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Run lint**

Run: `bun run lint`
Expected: no errors in the new files.

- [ ] **Step 6: Commit**

```bash
git add src/core/root.ts tests/core/root.test.ts
git commit -m "feat: add findProjectRoot helper for project-root auto-detection"
```

---

## Task 2: Wire auto-detection into `resolveGlobal`

**Files:**
- Modify: `src/cli.ts:38-50` (`addSharedOpts` — remove `--root` default)
- Modify: `src/cli.ts:52-62` (`resolveGlobal` — call `findProjectRoot`)
- Modify: `tests/integration/cli.test.ts` (add subdirectory auto-detection test)

- [ ] **Step 1: Add the failing integration test for auto-detection from a subdirectory**

Open `tests/integration/cli.test.ts`. Add this test inside the `describe("CLI integration", ...)` block (place it after the existing `frame generate` test):

```ts
it("auto-detects project root when run from a subdirectory of a fixture with .frame", async () => {
  // Pre-condition: the previous "frame generate" test created FRAME_DIR.
  // From a nested cwd with no --root, frame should walk up and find FIXTURE.
  const subdir = join(FIXTURE, "src");
  const { stdout, exitCode } = await run(["read"], { cwd: subdir });
  expect(exitCode).toBe(0);
  expect(stdout).toContain("src/index.ts");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/integration/cli.test.ts`
Expected: the new test FAILS with a "frame not found" or similar error (current code uses `cwd` = `subdir`, which has no `.frame/`).

- [ ] **Step 3: Update `addSharedOpts` to remove the `--root` default**

In `src/cli.ts`, find the `addSharedOpts` function (currently lines 38-50). Change the `--root` line:

Replace:

```ts
    .option("--root <path>", "project root", process.cwd())
```

With:

```ts
    .option("--root <path>", "project root (default: nearest ancestor with .git or .frame, else cwd)")
```

- [ ] **Step 4: Update `resolveGlobal` to call `findProjectRoot` when `--root` is undefined**

In `src/cli.ts`, add the import at the top alongside the other core imports:

```ts
import { findProjectRoot } from "./core/root.ts";
```

Then, in `resolveGlobal` (currently lines 52-62), change the `root` line.

Replace:

```ts
  const root = resolve(opts.root ?? process.cwd());
```

With:

```ts
  const root = opts.root
    ? resolve(opts.root)
    : findProjectRoot(process.cwd());
```

- [ ] **Step 5: Run all tests to verify the new test passes and nothing else broke**

Run: `bun test`
Expected: PASS — including the new auto-detection test and all previously-passing tests.

- [ ] **Step 6: Run lint**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts tests/integration/cli.test.ts
git commit -m "feat: auto-detect project root from .git or .frame markers"
```

---

## Task 3: `init` core function

**Files:**
- Create: `src/core/init.ts`
- Test: `tests/core/init.test.ts`

This task embeds the two skill markdown files into the binary using Bun's `with { type: "file" }` pattern (the same pattern used in `src/core/wasm-loader.ts:4-12`). The imports resolve to file paths at runtime that `Bun.file().text()` can read.

- [ ] **Step 1: Write the failing tests**

Create `tests/core/init.test.ts` with the following content:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { init } from "../../src/core/init.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const FRAME_CONTEXT_SOURCE = join(
  REPO_ROOT,
  ".claude/skills/frame-context.md",
);
const FRAME_POPULATE_SOURCE = join(
  REPO_ROOT,
  ".claude/skills/frame-populate.md",
);

let tempDir: string;

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "init-test-")));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("init", () => {
  test("clean run creates .frame/.gitignore and both skill files", async () => {
    const result = await init(tempDir);

    expect(result.root).toBe(tempDir);
    expect(result.outcomes).toEqual([
      { path: ".frame/.gitignore", status: "created" },
      { path: ".claude/skills/frame-context.md", status: "created" },
      { path: ".claude/skills/frame-populate.md", status: "created" },
    ]);

    expect(existsSync(join(tempDir, ".frame"))).toBe(true);
    expect(existsSync(join(tempDir, ".frame/.gitignore"))).toBe(true);
    expect(existsSync(join(tempDir, ".claude/skills"))).toBe(true);
    expect(existsSync(join(tempDir, ".claude/skills/frame-context.md"))).toBe(
      true,
    );
    expect(existsSync(join(tempDir, ".claude/skills/frame-populate.md"))).toBe(
      true,
    );
  });

  test(".frame/.gitignore content is exactly '*\\n'", async () => {
    await init(tempDir);
    const content = await readFile(
      join(tempDir, ".frame/.gitignore"),
      "utf8",
    );
    expect(content).toBe("*\n");
  });

  test("embedded skill content matches canonical source files", async () => {
    await init(tempDir);

    const installedContext = await readFile(
      join(tempDir, ".claude/skills/frame-context.md"),
      "utf8",
    );
    const installedPopulate = await readFile(
      join(tempDir, ".claude/skills/frame-populate.md"),
      "utf8",
    );
    const sourceContext = await readFile(FRAME_CONTEXT_SOURCE, "utf8");
    const sourcePopulate = await readFile(FRAME_POPULATE_SOURCE, "utf8");

    expect(installedContext).toBe(sourceContext);
    expect(installedPopulate).toBe(sourcePopulate);
  });

  test("re-run on already-initialized directory skips all files", async () => {
    await init(tempDir);
    const result = await init(tempDir);

    expect(result.outcomes).toEqual([
      { path: ".frame/.gitignore", status: "skipped" },
      { path: ".claude/skills/frame-context.md", status: "skipped" },
      { path: ".claude/skills/frame-populate.md", status: "skipped" },
    ]);
  });

  test("partial state creates only missing files", async () => {
    // Pre-create .frame/.gitignore but leave skills missing.
    await mkdir(join(tempDir, ".frame"), { recursive: true });
    await writeFile(join(tempDir, ".frame/.gitignore"), "preexisting\n");

    const result = await init(tempDir);

    expect(result.outcomes).toEqual([
      { path: ".frame/.gitignore", status: "skipped" },
      { path: ".claude/skills/frame-context.md", status: "created" },
      { path: ".claude/skills/frame-populate.md", status: "created" },
    ]);

    // Pre-existing .gitignore content must NOT be overwritten.
    const gi = await readFile(join(tempDir, ".frame/.gitignore"), "utf8");
    expect(gi).toBe("preexisting\n");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/init.test.ts`
Expected: FAIL with module-not-found error for `../../src/core/init.ts`.

- [ ] **Step 3: Implement `init`**

Create `src/core/init.ts` with the following content:

```ts
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Embed canonical skill files into the compiled binary. Same pattern as
// src/core/wasm-loader.ts — these resolve to file paths at runtime.
import frameContextSkill from "../../.claude/skills/frame-context.md" with {
  type: "file",
};
import framePopulateSkill from "../../.claude/skills/frame-populate.md" with {
  type: "file",
};

export interface InitOutcome {
  /** Path relative to project root. */
  path: string;
  status: "created" | "skipped";
}

export interface InitResult {
  /** Absolute path to the project root that was initialized. */
  root: string;
  /** Per-file outcomes in stable order. */
  outcomes: InitOutcome[];
}

/**
 * Scaffold .frame/ and install Claude Code skills in `root`.
 *
 * Idempotent — each file is exists-checked and reported as `created` or
 * `skipped`. Directory creates use `recursive: true` and don't appear in
 * the outcomes list; only tracked files (the .gitignore and two skills) do.
 */
export async function init(root: string): Promise<InitResult> {
  const outcomes: InitOutcome[] = [];

  // 1. .frame/.gitignore
  await mkdir(join(root, ".frame"), { recursive: true });
  outcomes.push(
    await writeIfMissing(root, ".frame/.gitignore", "*\n"),
  );

  // 2. Skill files
  await mkdir(join(root, ".claude", "skills"), { recursive: true });
  const contextContent = await Bun.file(frameContextSkill).text();
  const populateContent = await Bun.file(framePopulateSkill).text();
  outcomes.push(
    await writeIfMissing(
      root,
      ".claude/skills/frame-context.md",
      contextContent,
    ),
  );
  outcomes.push(
    await writeIfMissing(
      root,
      ".claude/skills/frame-populate.md",
      populateContent,
    ),
  );

  return { root, outcomes };
}

async function writeIfMissing(
  root: string,
  relPath: string,
  content: string,
): Promise<InitOutcome> {
  const fullPath = join(root, relPath);
  if (existsSync(fullPath)) {
    return { path: relPath, status: "skipped" };
  }
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
  return { path: relPath, status: "created" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/init.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Run lint**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/init.ts tests/core/init.test.ts
git commit -m "feat: add init() to scaffold .frame/ and install Claude skills"
```

---

## Task 4: `formatInitResult` formatter

**Files:**
- Modify: `src/core/formatter.ts` (add `formatInitResult` export)
- Modify: `tests/core/formatter.test.ts` (add tests for `formatInitResult`)

- [ ] **Step 1: Write the failing tests**

Open `tests/core/formatter.test.ts`. Add an import for `formatInitResult` at the top alongside the existing formatter imports:

```ts
import { formatInitResult } from "../../src/core/formatter.ts";
```

Then add a new `describe` block at the bottom of the file:

```ts
describe("formatInitResult", () => {
  test("clean run shows all created with Next hint", () => {
    const out = formatInitResult({
      root: "/Users/me/myproject",
      outcomes: [
        { path: ".frame/.gitignore", status: "created" },
        { path: ".claude/skills/frame-context.md", status: "created" },
        { path: ".claude/skills/frame-populate.md", status: "created" },
      ],
    });

    expect(out).toBe(
      [
        "Initialized frame at /Users/me/myproject",
        "  created  .frame/.gitignore",
        "  created  .claude/skills/frame-context.md",
        "  created  .claude/skills/frame-populate.md",
        "",
        "Next: run `frame generate`",
      ].join("\n"),
    );
  });

  test("re-run shows all skipped with `(exists)` suffix and Next hint", () => {
    const out = formatInitResult({
      root: "/tmp/p",
      outcomes: [
        { path: ".frame/.gitignore", status: "skipped" },
        { path: ".claude/skills/frame-context.md", status: "skipped" },
        { path: ".claude/skills/frame-populate.md", status: "skipped" },
      ],
    });

    expect(out).toBe(
      [
        "Initialized frame at /tmp/p",
        "  skipped  .frame/.gitignore (exists)",
        "  skipped  .claude/skills/frame-context.md (exists)",
        "  skipped  .claude/skills/frame-populate.md (exists)",
        "",
        "Next: run `frame generate`",
      ].join("\n"),
    );
  });

  test("mixed run interleaves created and skipped lines", () => {
    const out = formatInitResult({
      root: "/x",
      outcomes: [
        { path: ".frame/.gitignore", status: "skipped" },
        { path: ".claude/skills/frame-context.md", status: "created" },
        { path: ".claude/skills/frame-populate.md", status: "created" },
      ],
    });

    expect(out).toBe(
      [
        "Initialized frame at /x",
        "  skipped  .frame/.gitignore (exists)",
        "  created  .claude/skills/frame-context.md",
        "  created  .claude/skills/frame-populate.md",
        "",
        "Next: run `frame generate`",
      ].join("\n"),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/formatter.test.ts`
Expected: FAIL — `formatInitResult` is not exported from `src/core/formatter.ts`.

- [ ] **Step 3: Add the import in `src/core/formatter.ts`**

At the top of `src/core/formatter.ts`, the existing import line is:

```ts
import type { FileEntry, FrameRoot, SearchResult } from "./schema.js";
```

Add a second import for the init types:

```ts
import type { InitResult } from "./init.ts";
```

- [ ] **Step 4: Implement `formatInitResult`**

In `src/core/formatter.ts`, add the following exported function. Place it just before `// --- formatHelp ---` (currently around line 166):

```ts
// --- formatInitResult ---

export function formatInitResult(result: InitResult): string {
  const lines: string[] = [`Initialized frame at ${result.root}`];
  for (const outcome of result.outcomes) {
    if (outcome.status === "created") {
      lines.push(`  created  ${outcome.path}`);
    } else {
      lines.push(`  skipped  ${outcome.path} (exists)`);
    }
  }
  lines.push("");
  lines.push("Next: run `frame generate`");
  return lines.join("\n");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/core/formatter.test.ts`
Expected: PASS — all 3 new tests plus all previously-passing formatter tests.

- [ ] **Step 6: Run lint**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/formatter.ts tests/core/formatter.test.ts
git commit -m "feat: add formatInitResult formatter for frame init output"
```

---

## Task 5: `frame init` CLI command

**Files:**
- Modify: `src/cli.ts` (register the `init` command)
- Modify: `tests/integration/cli.test.ts` (add `frame init` integration test)

- [ ] **Step 1: Write the failing integration test**

Open `tests/integration/cli.test.ts`. Add a new `describe` block at the bottom of the file (after the existing `describe("CLI integration", ...)` block):

```ts
describe("CLI integration: frame init", () => {
  let initDir: string;

  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { realpath } = await import("node:fs/promises");
    initDir = await realpath(
      await mkdtemp(join(tmpdir(), "frame-init-itest-")),
    );
  });

  afterEach(async () => {
    await rm(initDir, { recursive: true, force: true });
  });

  it("frame init scaffolds .frame/.gitignore and skill files", async () => {
    const { stdout, exitCode } = await run(["init"], { cwd: initDir });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Initialized frame at ${initDir}`);
    expect(stdout).toContain("created  .frame/.gitignore");
    expect(stdout).toContain("created  .claude/skills/frame-context.md");
    expect(stdout).toContain("created  .claude/skills/frame-populate.md");
    expect(stdout).toContain("Next: run `frame generate`");

    expect(existsSync(join(initDir, ".frame/.gitignore"))).toBe(true);
    expect(
      existsSync(join(initDir, ".claude/skills/frame-context.md")),
    ).toBe(true);
    expect(
      existsSync(join(initDir, ".claude/skills/frame-populate.md")),
    ).toBe(true);
  });

  it("frame init is idempotent — second run skips all files", async () => {
    await run(["init"], { cwd: initDir });
    const { stdout, exitCode } = await run(["init"], { cwd: initDir });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("skipped  .frame/.gitignore (exists)");
    expect(stdout).toContain(
      "skipped  .claude/skills/frame-context.md (exists)",
    );
    expect(stdout).toContain(
      "skipped  .claude/skills/frame-populate.md (exists)",
    );
  });
});
```

Add the missing imports at the top of the file alongside the existing ones:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
```

(Add `afterEach` and `beforeEach` to the existing import line.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/integration/cli.test.ts`
Expected: the two new `frame init` tests FAIL — exit code is non-zero (no `init` command registered yet).

- [ ] **Step 3: Register the `init` command in `src/cli.ts`**

In `src/cli.ts`, add imports at the top alongside the other core imports:

```ts
import { init } from "./core/init.ts";
```

And update the formatter import to include `formatInitResult`:

```ts
import {
  formatApiSurface,
  formatDeps,
  formatFileDetail,
  formatHelp,
  formatInitResult,
  formatSearchResults,
  formatSkeleton,
} from "./core/formatter.ts";
```

Then add the new command block. Place it after the existing `// --- generate ---` block (around line 116) but before `// --- update ---`:

```ts
// --- init ---
const initCmd = program
  .command("init")
  .description("Scaffold .frame/ and install Claude Code skills");
addSharedOpts(initCmd);
initCmd.action(async function (this: Command) {
  try {
    const g = resolveGlobal(this);
    const result = await init(g.root);
    process.stdout.write(`${formatInitResult(result)}\n`);
  } catch (err) {
    handleError(err);
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test`
Expected: PASS — all tests including the two new `frame init` integration tests.

- [ ] **Step 5: Manually verify the command from the project root**

Run:

```bash
bun run src/cli.ts init --root /tmp/frame-smoketest
```

(Pre-create `/tmp/frame-smoketest` first if needed.)

Expected output:

```
Initialized frame at /tmp/frame-smoketest
  created  .frame/.gitignore
  created  .claude/skills/frame-context.md
  created  .claude/skills/frame-populate.md

Next: run `frame generate`
```

Verify the files exist:

```bash
ls /tmp/frame-smoketest/.frame /tmp/frame-smoketest/.claude/skills
cat /tmp/frame-smoketest/.frame/.gitignore  # should print "*"
```

Then clean up:

```bash
rm -rf /tmp/frame-smoketest
```

- [ ] **Step 6: Run lint**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts tests/integration/cli.test.ts
git commit -m "feat: add frame init CLI command"
```

---

## Task 6: Update help text to document `init` and the new `--root` default

**Files:**
- Modify: `src/core/formatter.ts` (`COMMANDS` table, `TOP_LEVEL_HELP`, `AGENT_HELP`)

The existing help text in `src/core/formatter.ts` mentions `--root <path> project root (default: cwd)` and lists every command — both need updates.

- [ ] **Step 1: Add an `init` entry to the `COMMANDS` table**

In `src/core/formatter.ts`, find the `COMMANDS` constant (currently starts around line 168). Add a new entry between the `generate` entry and the `update` entry:

```ts
  init: {
    usage: "frame init",
    output:
      "creates .frame/.gitignore (ignores all .frame contents)\n    and installs frame-context and frame-populate skills into .claude/skills/.\n    idempotent — already-present files are skipped.",
    hint: "run once per project to bootstrap. then run `frame generate`.",
  },
```

- [ ] **Step 2: Add `init` to `TOP_LEVEL_HELP` and update the `--root` default text**

In `src/core/formatter.ts`, find the `TOP_LEVEL_HELP` constant (currently starts around line 245). Update it as follows.

Replace this line:

```
  generate          build frame from scratch
```

With these two lines:

```
  init              scaffold .frame/ and install Claude Code skills
  generate          build frame from scratch
```

Replace this line:

```
  --root <path>     project root (default: cwd)
```

With this line:

```
  --root <path>     project root (default: nearest .git or .frame ancestor, else cwd)
```

- [ ] **Step 3: Add `init` to `AGENT_HELP` and update flag docs**

In `src/core/formatter.ts`, find the `AGENT_HELP` constant (currently starts around line 267). Update it as follows.

Replace this block:

```
WRITE WORKFLOW (maintainers only):
  frame generate               → build frame from scratch
  frame update                 → sync frame to current code
```

With this block:

```
WRITE WORKFLOW (maintainers only):
  frame init                   → scaffold .frame/ and install Claude skills
  frame generate               → build frame from scratch
  frame update                 → sync frame to current code
```

Replace this line:

```
  --root <path>                → project root override
```

With this line:

```
  --root <path>                → project root override (default: nearest .git or .frame ancestor)
```

- [ ] **Step 4: Add formatter tests for the help text changes**

Open `tests/core/formatter.test.ts`. Inside the existing `describe("formatHelp", ...)` block (currently around line 322), add these three new tests:

```ts
test("top-level help lists init command", () => {
  const out = formatHelp();
  expect(out).toContain("init");
  expect(out).toContain("scaffold .frame/");
});

test("top-level help shows updated --root default", () => {
  const out = formatHelp();
  expect(out).toContain("nearest .git or .frame ancestor");
});

test("init command help describes scaffold behavior", () => {
  const out = formatHelp("init");
  expect(out).toContain("frame init");
  expect(out).toContain(".frame/.gitignore");
  expect(out).toContain(".claude/skills");
});

test("agent help lists frame init in WRITE WORKFLOW", () => {
  const out = formatHelp(undefined, true);
  expect(out).toContain("frame init");
});
```

- [ ] **Step 5: Run all tests**

Run: `bun test`
Expected: PASS — all tests including the new help-text assertions.

- [ ] **Step 6: Run lint**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/formatter.ts tests/core/formatter.test.ts
git commit -m "docs: document frame init in CLI help text"
```

---

## Task 7: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the install/quick-start flow to start with `frame init`**

In `README.md`, find the `## Quick start` section (currently around line 44). Replace its existing first command block:

```sh
# Generate a frame for the current project
frame generate
```

With:

```sh
# Initialize frame in a project (creates .frame/, installs Claude skills)
frame init

# Generate a frame for the current project
frame generate
```

- [ ] **Step 2: Add a `### frame init` subsection in Commands**

In `README.md`, find the Commands section. Add this new subsection just before `### frame generate` (currently around line 68):

```markdown
### `frame init`

Scaffold `.frame/` (with a `.gitignore` that ignores all of its contents) and install the bundled Claude Code skills (`frame-context`, `frame-populate`) into `<root>/.claude/skills/`. Idempotent — files that already exist are skipped.

```sh
frame init
```

Run once per project. Then run `frame generate`.
```

- [ ] **Step 3: Update the `--root` row of the Global options table**

In `README.md`, find the Global options table (currently around line 142). Replace this row:

```
| `--root <path>` | Project root (default: cwd) |
```

With this row:

```
| `--root <path>` | Project root (default: nearest ancestor with `.git` or `.frame/`, else cwd) |
```

- [ ] **Step 4: Verify the README renders correctly**

Read the modified `README.md` end-to-end. Check that:
- The `frame init` block in Quick start sits above `frame generate`.
- The `### frame init` subsection lives in the Commands section, before `### frame generate`.
- The `--root` row in the Global options table reflects the new default.
- No other content was accidentally modified.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document frame init and project-root auto-detection in README"
```

---

## Final Verification

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: PASS — all tests green.

- [ ] **Step 2: Run lint and format checks**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 3: Build the binary to confirm embedded imports compile**

Run: `bun run build`
Expected: build succeeds; `bin/frame` is produced.

- [ ] **Step 4: Smoke-test the compiled binary**

Run:

```bash
mkdir -p /tmp/frame-build-smoketest
./bin/frame init --root /tmp/frame-build-smoketest
cat /tmp/frame-build-smoketest/.frame/.gitignore
diff /tmp/frame-build-smoketest/.claude/skills/frame-context.md .claude/skills/frame-context.md
diff /tmp/frame-build-smoketest/.claude/skills/frame-populate.md .claude/skills/frame-populate.md
rm -rf /tmp/frame-build-smoketest
```

Expected: `.gitignore` contains `*`, both `diff`s show no differences (embedded skill content matches the canonical source).
