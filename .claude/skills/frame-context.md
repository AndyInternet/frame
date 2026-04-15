---
name: frame-context
description: Auto-load project context from .frame — orient first, then explore with the frame CLI. Use whenever a `.frame/` directory is present in the project, or when the user asks to load context, frame, or project understanding.
---

# frame-context

Load semantic project context using the `frame` CLI before doing any non-trivial work in a frame-enabled project. Frame is denser than reading source files — purposes are pre-summarized, structure is pre-extracted.

Companion to `frame-populate` (which fills missing purposes). This skill is read-only.

## When to use

- Project has a `.frame/` directory at its root
- Starting work on an unfamiliar file or feature
- User asks about project structure, exports, dependencies, or "what does X do"

If `.frame/` is missing, this skill does not apply — fall back to normal exploration.

## Phase 1 — Orient (always do first)

Run:

```bash
frame read --json
```

From the output, note:

- **Shape:** `totalFiles`, `totalSymbols`, `languageComposition` — size and stack
- **Coverage:** `needsGeneration` — count of unpopulated purposes. If `> 0`, tell the user purposes are partially populated and suggest `frame-populate` to fill gaps. Proceed regardless.
- **Parse health:** `parseErrors` — if `> 0`, identify which files (look for `parseError !== null` in the `files[]` array) and remember to fall back to raw `Read` for those
- **The skeleton:** the `files[]` array — paths, languages, purposes, exports, imports. This is your working map.

Do NOT drill into every file at this stage. The skeleton is the orientation; deeper reads happen on demand.

### Edge cases for Phase 1

- **`frame read` errors with "No frame found":** tell the user to run `frame generate` first, then stop.
- **`frame` command not found:** tell the user the `frame` CLI is not installed, point them at the project README, then stop.
- **`needsGeneration > 0`:** mention to user, suggest `frame-populate`, continue with whatever purposes exist.
- **`parseErrors > 0`:** mention which files failed to parse so you know to use raw `Read` for those.

## Phase 2 — Explore (on demand)

Pick the right command for the task. Do not run all of them.

| Command | Use when… |
|---|---|
| `frame read-file <path> --json` | Need full symbol detail for a specific file — parameters, returns, language features, per-symbol purposes |
| `frame search <query> --json` | Need to find files/symbols by name or purpose text and don't know the path. Flags: `--files-only`, `--symbols-only`, `--limit N`, `--threshold N` |
| `frame api-surface --json` | Need to understand the public contract of the project — all exported symbols grouped by file |
| `frame deps <path> --json` | Need the import graph for a file — what it imports and what imports it. Add `--external` for package deps |

### Guidance

- Prefer these over `Read` when you only need structure or intent — frame is denser and pre-summarized
- Reach for `Read` when you need actual implementation, not just shape
- Typical feature-work path: `search` → `read-file` → `deps` (find entry point, understand it, trace the graph)
- Skip files where `parseError !== null` — frame has nothing useful for them; use `Read` instead

## What this skill does NOT do

- Does not run `frame generate` or `frame update` — those are user-driven write operations
- Does not call `frame write-purposes` — that's the `frame-populate` skill's job
- Does not prescribe a fixed exploration sequence — pick what fits the task
