# `frame-context` Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `frame-context` Claude Code skill that auto-loads project context from `.frame/` via the `frame` CLI's progressive-discovery commands.

**Architecture:** A single markdown skill file at `.claude/skills/frame-context.md`, structured in two phases — Phase 1 always runs `frame read --json` to orient; Phase 2 documents the four drill-down commands (`read-file`, `search`, `api-surface`, `deps`) with "use when" guidance. The skill description triggers Claude when a `.frame/` directory is present in the project. This skill is the read-side counterpart to the existing `frame-populate` write-side skill.

**Tech Stack:** Markdown only — no executable code. Skill file follows the same YAML-frontmatter format as `.claude/skills/frame-populate.md`.

**Spec:** `docs/superpowers/specs/2026-04-15-frame-context-skill-design.md`

---

## File Structure

| Path | Purpose | Action |
|---|---|---|
| `.claude/skills/frame-context.md` | The new skill file. YAML frontmatter + two-phase markdown content. | Create |
| `.claude/skills/frame-populate.md` | Existing companion skill. Reference only — do not modify. | Read for format reference |

Single file, no test harness (skills are markdown instructions for an LLM, not code).

---

### Task 1: Create the `frame-context` skill file

**Files:**
- Create: `.claude/skills/frame-context.md`
- Reference: `.claude/skills/frame-populate.md` (for frontmatter format and tone)
- Reference: `docs/superpowers/specs/2026-04-15-frame-context-skill-design.md` (the spec)

- [ ] **Step 1: Read the existing `frame-populate` skill for format reference**

Run: read `.claude/skills/frame-populate.md` in full. Note the YAML frontmatter shape, the section headers (`## Rules`, `## Workflow`), the bash code-fence convention, and the terse "caveman" tone. The new skill should match this style.

- [ ] **Step 2: Read the design spec**

Run: read `docs/superpowers/specs/2026-04-15-frame-context-skill-design.md` in full. Confirm the two-phase structure, the four edge cases tied to Phase 1, the four drill-down commands in Phase 2, and the acceptance criteria.

- [ ] **Step 3: Write the skill file**

Create `.claude/skills/frame-context.md` with the following exact content:

````markdown
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
````

- [ ] **Step 4: Verify the file structure**

Run: read `.claude/skills/frame-context.md` and confirm:
- YAML frontmatter has `name: frame-context` and a description
- Two `## Phase` sections present
- All four drill-down commands documented in the Phase 2 table
- All four Phase 1 edge cases listed
- "What this skill does NOT do" section present
- File length under 200 lines

If any of these are missing, edit the file to add them — do NOT mark this step complete until all checks pass.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/frame-context.md
git commit -m "$(cat <<'EOF'
feat: add frame-context skill

Read-side companion to frame-populate. Auto-loads project context
from the frame CLI when .frame/ is present. Two phases: orient
with `frame read`, then explore with read-file / search /
api-surface / deps as the task demands.

Spec: docs/superpowers/specs/2026-04-15-frame-context-skill-design.md
EOF
)"
```

Expected: commit succeeds, working tree clean.

---

## Self-Review

After implementation, verify against the spec acceptance criteria:

- [ ] File exists at `.claude/skills/frame-context.md`
- [ ] Has valid YAML frontmatter with `name: frame-context`
- [ ] Description mentions auto-trigger on `.frame/` presence
- [ ] Phase 1 instructs running `frame read --json` first and inspects `needsGeneration`, `parseErrors`, `totalFiles`, `totalSymbols`, `languageComposition`
- [ ] Phase 2 documents all four drill-down commands with "use when" guidance
- [ ] All five edge cases addressed (no `.frame/` is implicit via the "When to use" gate; the other four are in the Phase 1 edge cases section)
- [ ] No executable code, just markdown
- [ ] File length ≤200 lines
