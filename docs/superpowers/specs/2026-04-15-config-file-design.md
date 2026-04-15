# `.frame/config.json` — per-developer config file

## Summary

Add a JSON config file at `.frame/config.json` that persists ignore patterns across invocations. The file is per-developer (not committed), created by `frame init` with sensible defaults, and merges additively with the existing `--ignore` CLI flag.

## Motivation

Today, ignore patterns must be passed on every invocation via `--ignore <glob>`. Projects with vendored or generated code (e.g. Go's `vendor/`, Node's `node_modules/`) force users to either remember the flags each run or wrap the binary in a script. A persistent config removes that friction.

The immediate trigger: during the `frame generate` crash investigation on `inngest-mono/inngest`, the workaround was `frame generate --ignore 'vendor/**'`. That pattern should be a one-time setup, not a per-run flag.

## Design

### Location and scope

- **Path:** `<projectRoot>/.frame/config.json`, resolved relative to the same project root used by every other command (see `src/core/root.ts`).
- **Scope:** per-developer. The existing `.frame/.gitignore` has `*`, which already excludes `config.json` from git. No change to the gitignore.
- **Lifecycle:** a missing file is not an error; it's treated as `{ "ignore": [] }`. Commands never create the file implicitly — only `frame init` writes it.

### Schema

```json
{
  "ignore": ["vendor/**", "node_modules/**"]
}
```

- Exactly one field for now: `ignore: string[]` — array of glob patterns matching the same syntax and semantics as `--ignore`.
- Unknown top-level fields are ignored silently, so future config additions don't break older CLIs that encounter a newer config.
- A missing `ignore` field is equivalent to `[]`.
- A non-array `ignore` value, or a non-string element, is a hard parse error: the command fails with a clear message naming the file and the offending shape.

### Merge semantics

- Final ignore list used by `walker.ts` = `config.ignore ∪ flagIgnores`.
- No deduplication step required; `Bun.Glob` doesn't care about duplicates.
- The merge happens in `resolveGlobal` in `src/cli.ts`, so every command that accepts `--ignore` picks up the config automatically.

### Prepopulated defaults

`frame init` writes the following as the default config. Rationale for each pattern is noted inline; rationale is not written into the JSON file.

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

| Pattern | Why |
|---|---|
| `vendor/**` | Go vendored deps — the explicit trigger for this feature |
| `node_modules/**` | JS/TS dependencies. Walker's `SKIP_DIRS` already handles this when falling back to `fsWalk`, but `git ls-files` may list it if someone is_add_ing it; defensive. |
| `dist/**`, `build/**`, `out/**` | Common build output directories |
| `.next/**` | Next.js build output |
| `coverage/**` | Test coverage reports |
| `**/*.generated.*`, `**/*.gen.*` | Convention for auto-generated source files |
| `**/*.pb.go` | Protobuf-generated Go (common in inngest-mono and similar repos) |
| `**/*.min.js` | Minified JS bundles |

### Idempotency of `init`

`frame init` uses `writeIfMissing` (see `src/core/init.ts:63-75`). The new config file follows the same rule: if `.frame/config.json` already exists, it's reported as `skipped` and never overwritten. Users who customize the list keep their changes.

## Implementation

### New module: `src/core/config.ts`

```ts
export interface FrameConfig {
  ignore: string[];
}

export function defaultConfig(): FrameConfig;
export async function loadConfig(root: string): Promise<FrameConfig>;
```

- `loadConfig(root)`:
  - Reads `<root>/.frame/config.json`.
  - Missing file → returns `{ ignore: [] }`.
  - Present-but-invalid JSON → throws `Error` with message `Invalid JSON in .frame/config.json: <parser message>`.
  - Valid JSON but `ignore` is not an array of strings → throws `Error` naming the offending field.
  - Valid shape with extra fields → ignores the extras.
- `defaultConfig()` returns the prepopulated list above. Keeps the default list in one place so `init.ts` and any future "reset" tooling reference the same source.

### `src/cli.ts` integration

- Add `loadConfig` call inside `resolveGlobal`:
  ```ts
  const config = await loadConfig(root);
  const extraIgnores = [...config.ignore, ...(opts.ignore ?? [])];
  ```
- `resolveGlobal` becomes async; update the three call sites (`generate`, `update`, everything in the command actions) accordingly. They already run inside `async` actions, so this is a `await` at the call.
- Ignore-flag-unaffected commands (`read`, `read-file`, `search`, etc.) don't need to load the config — but loading is cheap and the code is simpler if every command goes through one code path. Load it unconditionally.

### `src/core/init.ts` changes

- Import `defaultConfig` from `./config.ts`.
- After the existing `.frame/.gitignore` write, call `writeIfMissing` for `.frame/config.json` with `JSON.stringify(defaultConfig(), null, 2) + "\n"`.
- The new outcome shows up in `InitResult.outcomes` in its natural ordering.

### `src/core/formatter.ts` (`formatInitResult`)

- No structural change — `formatInitResult` already iterates over `outcomes`, so the new entry renders automatically.

### Tests

New file `tests/core/config.test.ts`:

- `loadConfig` on a root with no `.frame/config.json` → returns `{ ignore: [] }`.
- Valid config with `ignore: ["foo/**"]` → returned verbatim.
- Valid JSON with no `ignore` field → returns `{ ignore: [] }`.
- Extra unknown field alongside valid `ignore` → field ignored, `ignore` returned.
- Malformed JSON → throws with a message mentioning `.frame/config.json`.
- `ignore` present but not an array → throws with a message naming the field.
- `ignore` as an array containing a non-string → throws.

Integration update in `tests/integration/cli.test.ts`:

- Add one test: write `.frame/config.json` with `{ ignore: ["excluded/**"] }`, create a file under `excluded/`, run `generate`, assert the excluded file is not in the frame.

Existing `init.ts` tests:

- Update expectations to include the new `config.json` outcome in the result.

### Documentation

- README `## Commands` → extend `frame init` section to mention that it also scaffolds `.frame/config.json` with sensible defaults.
- README `### Global options` → add a paragraph under the table describing the config file, the merge behavior, and the default list.
- Architecture tree gains `config.ts`.

## Non-goals

- No validation beyond "valid JSON with an optional string-array `ignore`".
- No per-language config — the ignore list is a flat project-wide set.
- No `--no-config` flag. Users who want a clean slate can delete or rename the file.
- No YAML/TOML support. JSON only.
- No tracked/committed variant. The file is per-developer by design; a future spec can revisit this if needed.
- No migration of patterns from any other file.

## Risks and open questions

- **Walker fallback already filters `node_modules` and `.git`.** Including `node_modules/**` in the default list is redundant in the common (git-based) path but harmless, and helpful if a future walker path misses it.
- **Glob semantics.** `Bun.Glob` matches using both full path and basename (`walker.ts:22-24`). The default patterns assume that behavior; if the matcher ever changes, a couple of entries (`.next/**`, `coverage/**`) may need revising.
- **Forward compatibility.** Tolerating unknown top-level fields is a one-way door: once we ship, users might rely on us not erroring on them, so we keep that behavior indefinitely. That's fine for a tiny config, but worth noting.
