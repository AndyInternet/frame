# Design: `frame-context` Claude Code Skill

**Date:** 2026-04-15
**Status:** Approved, ready for implementation
**Companion to:** `frame-populate` skill (write-side counterpart)

## Goal

Give Claude a skill that auto-loads project context from `.frame/` and teaches it how to use the `frame` CLI's read commands for progressive discovery. Covers the full lifecycle: bootstrap orientation when a conversation starts on a frame-enabled project, then targeted drill-down as Claude works on tasks.

## Non-Goals

- Does NOT run `frame generate` / `frame update` (write operations stay user-driven)
- Does NOT call `frame write-purposes` (that's `frame-populate`'s job)
- Does NOT prescribe a fixed exploration sequence — Claude picks the right tool per situation
- Does NOT replace reading source files when actual implementation detail is needed

## Skill Identity

| Field | Value |
|---|---|
| **Name** | `frame-context` |
| **Description** | Auto-load project context from .frame — orient first, then explore with CLI |
| **Location** | `.claude/skills/frame-context.md` |
| **Trigger** | Auto — when `.frame/` directory exists in the project, or user mentions "frame" / "load context" / similar |

## Structure: Two Phases

### Phase 1 — Orient (always do first)

When the skill activates, Claude runs:

```bash
frame read --json
```

From the parsed output, Claude notes:

- **Project shape:** `totalFiles`, `totalSymbols`, `languageComposition` — sense of size and stack
- **Coverage:** `needsGeneration` — if `> 0`, mention to user that purposes are partially populated and suggest running `frame-populate` to fill gaps; proceed regardless
- **Parse health:** `parseErrors` — if `> 0`, note that some files couldn't be parsed
- **The skeleton itself:** the `files[]` array with paths, languages, purposes, exports, imports — Claude's working map of the project

Claude does **not** drill into every file at this stage. The skeleton is the orientation; deeper reads happen on demand in Phase 2.

### Phase 2 — Explore (on demand, based on the task)

The skill teaches each command's purpose and when it's the right choice. It does NOT prescribe an order:

| Command | Use when… |
|---|---|
| `frame read-file <path> --json` | Need full symbol detail for a specific file — parameters, returns, language features, per-symbol purposes |
| `frame search <query> --json` | Need to find files/symbols by name or purpose text and don't know the path. Supports `--files-only`, `--symbols-only`, `--limit`, `--threshold` |
| `frame api-surface --json` | Need to understand the public contract of the project — all exported symbols grouped by file |
| `frame deps <path> --json` | Need the import graph for a specific file — what it imports and what imports it. Add `--external` for package deps |

**Guidance the skill gives Claude:**

- Prefer these commands over `Read`-ing source files when only structure or intent is needed — frame is denser and pre-summarized
- Reach for raw `Read` when actual implementation is needed, not just the shape
- A typical feature-work path: `search` → `read-file` → `deps` (find entry point, understand it, trace the graph)
- Skip files where `parseError !== null` — frame has nothing useful for them

## Edge Cases

| Situation | Skill behavior |
|---|---|
| No `.frame/` directory | Skill doesn't apply, exit cleanly |
| `.frame/` exists but `frame read` errors with "No frame found" | Tell user to run `frame generate`, then stop |
| `needsGeneration > 0` | Note it to user, suggest `frame-populate`, proceed anyway with whatever purposes exist |
| `parseErrors > 0` | Mention which files couldn't be parsed so Claude knows to fall back to raw `Read` for those |
| `frame` CLI not installed | Fail gracefully with install instructions |

## Skill File Outline

The markdown skill file at `.claude/skills/frame-context.md` will contain:

1. **YAML frontmatter** — `name`, `description`
2. **Brief intro** — what the skill is for, when it activates
3. **Phase 1 section** — the `frame read --json` command, what to look at in the output, how to handle the four edge cases tied to it (`needsGeneration`, `parseErrors`, no-frame error, missing CLI)
4. **Phase 2 section** — the four drill-down commands as a table with "use when" guidance
5. **Guidance block** — prefer-frame-over-Read, fallback-to-Read for implementation, skip parse-errored files
6. **Counterpart pointer** — one-line note that writes (purpose population) live in the `frame-populate` skill

## Acceptance Criteria

- File exists at `.claude/skills/frame-context.md`
- Has valid YAML frontmatter with `name: frame-context` and a description that auto-triggers on `.frame/` presence
- Phase 1 instructs Claude to run `frame read --json` first and inspect specific fields (`needsGeneration`, `parseErrors`, `totalFiles`, `totalSymbols`, `languageComposition`)
- Phase 2 documents all four drill-down commands with "use when" guidance
- All five edge cases from the table above are addressed
- File is markdown, no executable code, ≤200 lines

## Out of Scope (for follow-up)

- Updating the README to mention the new skill
- Updating the spec (`specs/initial-build.md`) to reflect the new skill — this is a post-spec addition
- Any changes to the CLI itself
