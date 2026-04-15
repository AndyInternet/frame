# Design: `frame init` Command and Project-Root Auto-Detection

**Date:** 2026-04-15
**Status:** Approved, ready for implementation

## Goal

Make adopting frame in a new project a single command, and stop forcing the user to run frame from the project root. Two coupled changes:

1. **Auto-detect the project root** by walking up from `cwd` looking for `.git` or `.frame/`. This means commands run from any subdirectory still operate on the right project.
2. **Add `frame init`** — scaffolds `.frame/` with the right `.gitignore`, and copies the bundled Claude Code skills (`frame-context`, `frame-populate`) into the target project's `.claude/skills/`.

## Non-Goals

- `frame init` does NOT run `generate` — that's a separate, potentially slow command and stays explicit.
- Does NOT modify the project's root `.gitignore`. Frame data is per-developer and ignored locally inside `.frame/`.
- Does NOT publish or distribute frame itself (no Homebrew, no npm). Install story for the binary is unchanged; this design is about what happens *after* `frame` is on `$PATH`.
- Does NOT add a flag to disable auto-detection. Explicit `--root <path>` already overrides it.

## Auto-Detection

### Behavior

When a user does NOT pass `--root`, frame walks up from `process.cwd()` and uses the first ancestor directory that contains either:

- A `.git` entry (file or directory — covers worktrees), OR
- A `.frame` entry (file or directory)

If neither is found anywhere up the chain, fall back to `process.cwd()` (today's behavior). When `--root` IS passed, that path wins unconditionally.

If both anchors exist on the path, the **closest one wins**. This matters in nested cases — a `.frame/` inside a subdirectory of a git repo means that subdirectory is treated as its own frame project (which is what `init` did there).

### API

New module `src/core/root.ts`:

```ts
/** Walk up from `start` looking for .git or .frame (file or dir).
 *  Returns the first ancestor with either marker, or `start` if none found.
 *  Closest marker wins when both exist on the path. */
export function findProjectRoot(start: string): string;
```

### Wiring

In `src/cli.ts:52-62`, change `resolveGlobal` so that when `opts.root` was not set by the user (Commander tracks this via the source of an option's value), `root` becomes `findProjectRoot(process.cwd())` instead of `process.cwd()`.

Implementation note: Commander sets the default value when no flag is passed, so distinguishing "user passed `--root`" from "default applied" requires either checking `cmd.getOptionValueSource("root")` or removing the default and treating `undefined` as "auto-detect". The latter is simpler and what this design uses.

This applies to **all** commands. `init` benefits too: running `frame init` from `~/myproject/src/utils/` correctly anchors `.frame/` at `~/myproject/`.

## `frame init` Command

### What it does

Five operations, each idempotent (exists check then skip):

1. `mkdir -p <root>/.frame/`
2. Write `<root>/.frame/.gitignore` containing exactly `*\n`
3. `mkdir -p <root>/.claude/skills/`
4. Write `<root>/.claude/skills/frame-context.md` (from embedded source)
5. Write `<root>/.claude/skills/frame-populate.md` (from embedded source)

Directory creates use `recursive: true` and don't appear in the report; only the three written files do.

### API

New module `src/core/init.ts`:

```ts
interface InitOutcome {
  path: string;              // relative to root, e.g. ".frame/.gitignore"
  status: "created" | "skipped";
}

interface InitResult {
  root: string;              // absolute project root path
  outcomes: InitOutcome[];   // exactly 3 entries, in stable order
}

export async function init(root: string): Promise<InitResult>;
```

### Skill embedding

The canonical skill source files at `.claude/skills/frame-context.md` and `.claude/skills/frame-populate.md` (which frame itself uses) get embedded into the compiled binary using Bun's existing pattern from `src/core/wasm-loader.ts:4-12`:

```ts
import frameContextSkill from "../../.claude/skills/frame-context.md" with { type: "file" };
import framePopulateSkill from "../../.claude/skills/frame-populate.md" with { type: "file" };
```

At runtime these resolve to file paths; `Bun.file(path).text()` reads the embedded content. **One source of truth** — the skills frame ships are the skills frame itself uses. Updating the canonical files automatically updates what `frame init` installs (after rebuild).

### CLI wiring

In `src/cli.ts`, register the command alongside the others:

```ts
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

### Output format

New `formatInitResult` in `src/core/formatter.ts`. On a clean run:

```
Initialized frame at /Users/me/myproject
  created  .frame/.gitignore
  created  .claude/skills/frame-context.md
  created  .claude/skills/frame-populate.md

Next: run `frame generate`
```

On re-run with everything present:

```
Initialized frame at /Users/me/myproject
  skipped  .frame/.gitignore (exists)
  skipped  .claude/skills/frame-context.md (exists)
  skipped  .claude/skills/frame-populate.md (exists)

Next: run `frame generate`
```

Mixed case shows a per-line mix of `created` / `skipped`. The trailing "Next" line always prints — useful guidance regardless of state.

## Tests

### `tests/core/root.test.ts`

`findProjectRoot` covers:
- `.git` directory found in an ancestor
- `.git` file found (worktree case)
- `.frame` directory found
- No marker anywhere up the chain → returns `start`
- Both markers on path, `.frame` is closer → returns `.frame` ancestor (closer wins)

### `tests/core/init.test.ts`

`init`:
- Clean run on empty directory creates all 3 files; `outcomes` shows 3 `created`.
- Re-run on already-initialized directory creates nothing; `outcomes` shows 3 `skipped`.
- Partial state (only `.frame/.gitignore` exists) creates the 2 missing skill files; `outcomes` shows 1 `skipped` + 2 `created`.
- `.frame/.gitignore` content is exactly `*\n`.
- Embedded skill content matches the source files in this repo's `.claude/skills/`.

## Documentation Updates

`README.md`:

- Add `frame init` as the first command in the **Quick start** block.
- Add an `### frame init` subsection in the Commands list.
- Add a one-line note in the Global options table that `--root` defaults to "the nearest ancestor containing `.git` or `.frame/`, else cwd".
- Update the install section to point at `frame init` as the project-side bootstrap step.
