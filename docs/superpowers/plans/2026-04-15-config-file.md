# `.frame/config.json` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-developer `.frame/config.json` file that persists ignore glob patterns across `frame` invocations, merging additively with the `--ignore` CLI flag.

**Architecture:** New `src/core/config.ts` module owns the schema, defaults, and file reading. `src/cli.ts:resolveGlobal` becomes async and merges the config's `ignore` array with any `--ignore` flag values. `src/core/init.ts` writes the default config on `frame init` via the existing idempotent `writeIfMissing` helper.

**Tech Stack:** Bun runtime · TypeScript · Node `fs/promises` / `Bun.file` for IO · `bun:test` for tests.

**Spec:** `docs/superpowers/specs/2026-04-15-config-file-design.md`

---

## File Structure

**Files to create:**
- `src/core/config.ts` — `FrameConfig` interface, `defaultConfig()`, `loadConfig(root)`
- `tests/core/config.test.ts` — unit tests for `defaultConfig` and `loadConfig`

**Files to modify:**
- `src/cli.ts` — make `resolveGlobal` async, merge `config.ignore` with flag ignores
- `src/core/init.ts` — write default `.frame/config.json` on init
- `tests/core/init.test.ts` — expect new `config.json` outcome in init results
- `tests/integration/cli.test.ts` — confirm config is honored during generate
- `README.md` — document the config file under `frame init` and global options; add `config.ts` to the architecture tree

---

### Task 1: `defaultConfig()` returns the prepopulated ignore list

**Files:**
- Create: `src/core/config.ts`
- Create: `tests/core/config.test.ts`

- [ ] **Step 1: Write failing test for `defaultConfig()`**

Create `tests/core/config.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../../src/core/config.ts";

describe("defaultConfig", () => {
  test("returns the prepopulated ignore list", () => {
    const config = defaultConfig();
    expect(config.ignore).toEqual([
      "vendor/**",
      "node_modules/**",
      "dist/**",
      "build/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "**/*.generated.*",
      "**/*.gen.*",
      "**/*.pb.go",
      "**/*.min.js",
    ]);
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

```
bun test tests/core/config.test.ts
```

Expected: fail with "Cannot find module '../../src/core/config.ts'".

- [ ] **Step 3: Implement `defaultConfig()`**

Create `src/core/config.ts`:

```ts
export interface FrameConfig {
  ignore: string[];
}

const DEFAULT_IGNORE: readonly string[] = [
  "vendor/**",
  "node_modules/**",
  "dist/**",
  "build/**",
  ".next/**",
  "out/**",
  "coverage/**",
  "**/*.generated.*",
  "**/*.gen.*",
  "**/*.pb.go",
  "**/*.min.js",
];

export function defaultConfig(): FrameConfig {
  return { ignore: [...DEFAULT_IGNORE] };
}
```

- [ ] **Step 4: Run test and verify it passes**

```
bun test tests/core/config.test.ts
```

Expected: `1 pass`.

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/core/config.test.ts
git commit -m "feat: add defaultConfig() with prepopulated ignore list"
```

---

### Task 2: `loadConfig()` — missing file and valid shapes

**Files:**
- Modify: `src/core/config.ts`
- Modify: `tests/core/config.test.ts`

- [ ] **Step 1: Write failing tests for `loadConfig` happy paths**

Append to `tests/core/config.test.ts`:

```ts
import { beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/core/config.ts";

let tempDir: string;

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "config-test-")));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeConfigFile(content: string): Promise<void> {
  await mkdir(join(tempDir, ".frame"), { recursive: true });
  await writeFile(join(tempDir, ".frame/config.json"), content);
}

describe("loadConfig", () => {
  test("missing .frame/config.json returns empty ignore list", async () => {
    const config = await loadConfig(tempDir);
    expect(config.ignore).toEqual([]);
  });

  test("valid config with ignore array is returned verbatim", async () => {
    await writeConfigFile('{"ignore": ["foo/**", "bar.ts"]}');
    const config = await loadConfig(tempDir);
    expect(config.ignore).toEqual(["foo/**", "bar.ts"]);
  });

  test("valid JSON with no ignore field returns empty ignore list", async () => {
    await writeConfigFile("{}");
    const config = await loadConfig(tempDir);
    expect(config.ignore).toEqual([]);
  });

  test("unknown top-level fields are ignored silently", async () => {
    await writeConfigFile(
      '{"ignore": ["x/**"], "futureField": "whatever", "nested": {"a": 1}}',
    );
    const config = await loadConfig(tempDir);
    expect(config.ignore).toEqual(["x/**"]);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

```
bun test tests/core/config.test.ts
```

Expected: `defaultConfig` test still passes; four new `loadConfig` tests fail with "loadConfig is not a function" or import error.

- [ ] **Step 3: Implement `loadConfig` for happy paths**

Append to `src/core/config.ts`:

```ts
import { join } from "node:path";

export async function loadConfig(root: string): Promise<FrameConfig> {
  const path = join(root, ".frame", "config.json");
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { ignore: [] };
  }
  const raw = await file.text();
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    return { ignore: [] };
  }
  const obj = parsed as Record<string, unknown>;
  const ignore = obj.ignore === undefined ? [] : (obj.ignore as string[]);
  return { ignore };
}
```

- [ ] **Step 4: Run tests and verify they pass**

```
bun test tests/core/config.test.ts
```

Expected: `5 pass`.

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/core/config.test.ts
git commit -m "feat: add loadConfig() with happy-path handling"
```

---

### Task 3: `loadConfig()` — error cases (strict validation)

**Files:**
- Modify: `src/core/config.ts`
- Modify: `tests/core/config.test.ts`

- [ ] **Step 1: Write failing tests for error cases**

Append to `tests/core/config.test.ts`:

```ts
describe("loadConfig error cases", () => {
  test("malformed JSON throws with a message naming the file", async () => {
    await writeConfigFile("{not json");
    await expect(loadConfig(tempDir)).rejects.toThrow(
      /\.frame\/config\.json/,
    );
  });

  test("ignore field that is not an array throws", async () => {
    await writeConfigFile('{"ignore": "foo/**"}');
    await expect(loadConfig(tempDir)).rejects.toThrow(/ignore.*array/);
  });

  test("ignore array containing a non-string element throws", async () => {
    await writeConfigFile('{"ignore": ["valid/**", 42]}');
    await expect(loadConfig(tempDir)).rejects.toThrow(/ignore.*string/);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

```
bun test tests/core/config.test.ts
```

Expected: three new tests fail — the malformed JSON one throws a raw SyntaxError (message won't match), and the validation tests fail because current code blindly casts.

- [ ] **Step 3: Update `loadConfig` with validation**

Replace the body of `loadConfig` in `src/core/config.ts` with:

```ts
export async function loadConfig(root: string): Promise<FrameConfig> {
  const path = join(root, ".frame", "config.json");
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { ignore: [] };
  }
  const raw = await file.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in .frame/config.json: ${msg}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ignore: [] };
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.ignore === undefined) {
    return { ignore: [] };
  }
  if (!Array.isArray(obj.ignore)) {
    throw new Error(
      "Invalid .frame/config.json: `ignore` must be an array of glob strings",
    );
  }
  for (const entry of obj.ignore) {
    if (typeof entry !== "string") {
      throw new Error(
        "Invalid .frame/config.json: every `ignore` entry must be a string glob",
      );
    }
  }
  return { ignore: obj.ignore as string[] };
}
```

- [ ] **Step 4: Run tests and verify they pass**

```
bun test tests/core/config.test.ts
```

Expected: `8 pass`.

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/core/config.test.ts
git commit -m "feat: validate .frame/config.json shape with clear errors"
```

---

### Task 4: `init` writes `.frame/config.json` with the default list

**Files:**
- Modify: `src/core/init.ts`
- Modify: `tests/core/init.test.ts`

- [ ] **Step 1: Update the existing "clean run" test to expect `config.json`**

In `tests/core/init.test.ts`, change the `test("clean run creates .frame/.gitignore and both skill files", ...)` block to:

```ts
  test("clean run creates .frame/.gitignore, config.json, and both skill files", async () => {
    const result = await init(tempDir);

    expect(result.root).toBe(tempDir);
    expect(result.outcomes).toEqual([
      { path: ".frame/.gitignore", status: "created" },
      { path: ".frame/config.json", status: "created" },
      { path: ".claude/skills/frame-context.md", status: "created" },
      { path: ".claude/skills/frame-populate.md", status: "created" },
    ]);

    expect(existsSync(join(tempDir, ".frame"))).toBe(true);
    expect(existsSync(join(tempDir, ".frame/.gitignore"))).toBe(true);
    expect(existsSync(join(tempDir, ".frame/config.json"))).toBe(true);
    expect(existsSync(join(tempDir, ".claude/skills"))).toBe(true);
    expect(existsSync(join(tempDir, ".claude/skills/frame-context.md"))).toBe(
      true,
    );
    expect(existsSync(join(tempDir, ".claude/skills/frame-populate.md"))).toBe(
      true,
    );
  });
```

Also update the `test("re-run on already-initialized directory skips all files", ...)` block to:

```ts
  test("re-run on already-initialized directory skips all files", async () => {
    await init(tempDir);
    const result = await init(tempDir);

    expect(result.outcomes).toEqual([
      { path: ".frame/.gitignore", status: "skipped" },
      { path: ".frame/config.json", status: "skipped" },
      { path: ".claude/skills/frame-context.md", status: "skipped" },
      { path: ".claude/skills/frame-populate.md", status: "skipped" },
    ]);
  });
```

And the `test("partial state creates only missing files", ...)` block to:

```ts
  test("partial state creates only missing files", async () => {
    // Pre-create .frame/.gitignore but leave skills missing.
    await mkdir(join(tempDir, ".frame"), { recursive: true });
    await writeFile(join(tempDir, ".frame/.gitignore"), "preexisting\n");

    const result = await init(tempDir);

    expect(result.outcomes).toEqual([
      { path: ".frame/.gitignore", status: "skipped" },
      { path: ".frame/config.json", status: "created" },
      { path: ".claude/skills/frame-context.md", status: "created" },
      { path: ".claude/skills/frame-populate.md", status: "created" },
    ]);

    // Pre-existing .gitignore content must NOT be overwritten.
    const gi = await readFile(join(tempDir, ".frame/.gitignore"), "utf8");
    expect(gi).toBe("preexisting\n");
  });
```

Add a new test after the existing `test(".frame/.gitignore content is exactly '*\\n'", ...)`:

```ts
  test(".frame/config.json content is the default config as pretty-printed JSON", async () => {
    await init(tempDir);
    const content = await readFile(
      join(tempDir, ".frame/config.json"),
      "utf8",
    );
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({
      ignore: [
        "vendor/**",
        "node_modules/**",
        "dist/**",
        "build/**",
        ".next/**",
        "out/**",
        "coverage/**",
        "**/*.generated.*",
        "**/*.gen.*",
        "**/*.pb.go",
        "**/*.min.js",
      ],
    });
    // Pretty-printed with a trailing newline.
    expect(content.endsWith("\n")).toBe(true);
    expect(content).toContain("\n  \"ignore\": [");
  });
```

- [ ] **Step 2: Run tests and verify they fail**

```
bun test tests/core/init.test.ts
```

Expected: the four updated/new tests fail (config.json not created yet or present in outcomes).

- [ ] **Step 3: Update `src/core/init.ts` to write the default config**

In `src/core/init.ts`, add the import near the existing ones:

```ts
import { defaultConfig } from "./config.ts";
```

In the `init` function, insert a new `writeIfMissing` call right after the `.frame/.gitignore` write (after line 39 in the current file):

```ts
  outcomes.push(
    await writeIfMissing(
      root,
      ".frame/config.json",
      `${JSON.stringify(defaultConfig(), null, 2)}\n`,
    ),
  );
```

The resulting ordering of pushes inside `init`:
1. `.frame/.gitignore`
2. `.frame/config.json` ← new
3. `.claude/skills/frame-context.md`
4. `.claude/skills/frame-populate.md`

- [ ] **Step 4: Run tests and verify they pass**

```
bun test tests/core/init.test.ts tests/core/config.test.ts
```

Expected: `init` suite — `5 pass` (4 updated + 1 new); `config` suite — `8 pass`.

- [ ] **Step 5: Commit**

```bash
git add src/core/init.ts tests/core/init.test.ts
git commit -m "feat: frame init now writes default .frame/config.json"
```

---

### Task 5: CLI merges config ignores with the `--ignore` flag

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Make `resolveGlobal` async and load the config**

In `src/cli.ts`, add an import near the other core imports:

```ts
import { loadConfig } from "./core/config.ts";
```

Change the `resolveGlobal` function signature and body from:

```ts
function resolveGlobal(cmd: Command): GlobalOpts {
  const opts = cmd.optsWithGlobals();
  const root = opts.root ? resolve(opts.root) : findProjectRoot(process.cwd());
  const dataPath = opts.data ?? join(root, ".frame", "frame.json");
  const json = opts.json ?? false;
  const concurrency = opts.concurrency
    ? Number(opts.concurrency)
    : navigator.hardwareConcurrency;
  const extraIgnores = opts.ignore ?? [];
  return { root, dataPath, json, concurrency, extraIgnores };
}
```

to:

```ts
async function resolveGlobal(cmd: Command): Promise<GlobalOpts> {
  const opts = cmd.optsWithGlobals();
  const root = opts.root ? resolve(opts.root) : findProjectRoot(process.cwd());
  const dataPath = opts.data ?? join(root, ".frame", "frame.json");
  const json = opts.json ?? false;
  const concurrency = opts.concurrency
    ? Number(opts.concurrency)
    : navigator.hardwareConcurrency;
  const flagIgnores: string[] = opts.ignore ?? [];
  const config = await loadConfig(root);
  const extraIgnores = [...config.ignore, ...flagIgnores];
  return { root, dataPath, json, concurrency, extraIgnores };
}
```

- [ ] **Step 2: Update every call site to `await`**

Every `resolveGlobal(this)` call inside an action is already in an `async` handler. Replace each occurrence of `const g = resolveGlobal(this);` with `const g = await resolveGlobal(this);`.

There are 9 call sites, all of the form `const g = resolveGlobal(this);`. Search-and-replace across `src/cli.ts`:

- `generate` action
- `init` action
- `update` action
- `read` action
- `read-file` action
- `search` action
- `api-surface` action
- `deps` action
- `write-purposes` action

- [ ] **Step 3: Run the full test suite**

```
bun test
```

Expected: all existing tests still pass. Running total at this point: 173 existing + 8 config unit + 1 new init test = `182 pass`, zero fails.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: merge .frame/config.json ignores with --ignore flag"
```

---

### Task 6: Integration test — config ignore patterns honored during `generate`

**Files:**
- Modify: `tests/integration/cli.test.ts`

- [ ] **Step 1: Write the integration test**

Append the following `it` block inside the `describe("CLI integration", ...)` block in `tests/integration/cli.test.ts` (near the other `generate` tests, after the existing `frame generate creates .frame/frame.json` test):

```ts
  it("frame generate honors .frame/config.json ignore patterns", async () => {
    const { writeFile, mkdtemp, mkdir, realpath } = await import(
      "node:fs/promises"
    );
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempRoot = await realpath(
      await mkdtemp(join(tmpdir(), "frame-config-int-")),
    );
    try {
      // Seed two TS files: one kept, one that should be ignored.
      await mkdir(join(tempRoot, "src"), { recursive: true });
      await writeFile(
        join(tempRoot, "src/keep.ts"),
        "export function keep(): number { return 1; }\n",
      );
      await mkdir(join(tempRoot, "excluded"), { recursive: true });
      await writeFile(
        join(tempRoot, "excluded/drop.ts"),
        "export function drop(): number { return 2; }\n",
      );

      // Write a config that excludes `excluded/**`.
      await mkdir(join(tempRoot, ".frame"), { recursive: true });
      await writeFile(
        join(tempRoot, ".frame/config.json"),
        JSON.stringify({ ignore: ["excluded/**"] }) + "\n",
      );

      const { stderr, exitCode } = await run(
        ["generate", "--root", tempRoot],
        { cwd: tempRoot },
      );
      expect(exitCode).toBe(0);
      expect(stderr).toContain("Generated:");

      const data = JSON.parse(
        await Bun.file(join(tempRoot, ".frame/frame.json")).text(),
      );
      const paths = data.files.map((f: { path: string }) => f.path);
      expect(paths).toContain("src/keep.ts");
      expect(paths).not.toContain("excluded/drop.ts");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 30_000);
```

- [ ] **Step 2: Run the integration test**

```
bun test tests/integration/cli.test.ts
```

Expected: new test passes (the wiring from Task 5 makes this work; if it fails, the CLI wiring is incomplete).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/cli.test.ts
git commit -m "test: integration test for .frame/config.json ignore wiring"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the `frame init` section**

In `README.md`, find the `### \`frame init\`` section (around line 71) and replace its body with:

```markdown
### `frame init`

Scaffold `.frame/` and install the bundled Claude Code skills into `<root>/.claude/skills/`. Creates:

- `.frame/.gitignore` containing `*` so the entire `.frame/` directory stays out of git
- `.frame/config.json` prepopulated with sensible ignore defaults (see [Configuration](#configuration))
- `.claude/skills/frame-context.md` and `.claude/skills/frame-populate.md`

Idempotent — files that already exist are skipped and their contents preserved.

```sh
frame init
```

Run once per project. Then run `frame generate`.
```

- [ ] **Step 2: Add the `## Configuration` section**

In `README.md`, insert a new `## Configuration` section immediately before the existing `## Supported languages` section (around line 163). Content:

```markdown
## Configuration

`frame init` writes `.frame/config.json` — a per-developer file (not committed, since `.frame/` is gitignored) that persists ignore patterns across invocations.

```json
{
  "ignore": [
    "vendor/**",
    "node_modules/**",
    "dist/**",
    "build/**",
    ".next/**",
    "out/**",
    "coverage/**",
    "**/*.generated.*",
    "**/*.gen.*",
    "**/*.pb.go",
    "**/*.min.js"
  ]
}
```

Edit the file directly to add or remove patterns. The glob syntax is the same as `--ignore`.

**Merge with the `--ignore` flag.** The final ignore list used during a run is `config.ignore` plus any `--ignore` flag values. The flag adds to the config — it never replaces it. To bypass the config entirely, delete or rename the file.

**Missing config.** If `.frame/config.json` doesn't exist, it's treated as an empty ignore list. Commands don't fail or recreate the file; only `frame init` writes it.

**Unknown fields.** Extra top-level fields are tolerated and ignored. A malformed `ignore` field (not an array, non-string element, or invalid JSON) fails the command with a clear error.
```

- [ ] **Step 3: Add `config.ts` to the architecture tree**

In `README.md`, the existing tree under `core/` is not alphabetical; add `config.ts` in a sensible position (immediately after `walker.ts`, alongside other core-infrastructure files). Insert this line:

```
    config.ts             .frame/config.json schema, defaults, loader
```

Don't reorder any existing entries. Just add the new line.

- [ ] **Step 4: Verify README renders reasonably**

```
bun -e "console.log((await Bun.file('README.md').text()).length)"
```

Expected: non-zero length, no crash. This is a smoke check that the file is still valid UTF-8.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document .frame/config.json and Configuration section"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

```
bun test
```

Expected: `183 pass` (173 existing + 8 config unit + 1 new init test + 1 integration), `0 fail`.

- [ ] **Step 2: Build the compiled binary**

```
bun build --compile ./src/cli.ts --outfile bin/frame
```

Expected: `compile bin/frame` line in output, no errors.

- [ ] **Step 3: Manual smoke test**

```
cd /tmp && rm -rf frame-config-smoke && mkdir frame-config-smoke && cd frame-config-smoke && git init -q
/Users/alawrence/Projects/frame/bin/frame init
cat .frame/config.json
```

Expected: `config.json` contains the default ignore array as JSON.

```
echo 'export const x = 1;' > keep.ts
mkdir -p vendor && echo 'export const y = 2;' > vendor/drop.ts
/Users/alawrence/Projects/frame/bin/frame generate
cat .frame/frame.json | bun -e "const f=JSON.parse(await Bun.stdin.text()); console.log(f.files.map(x=>x.path));"
```

Expected: output includes `keep.ts` but not `vendor/drop.ts`.

- [ ] **Step 4: Lint check**

```
bun run lint
```

Expected: no errors.
