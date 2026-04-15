---
name: frame-populate
description: Fill missing purpose fields in .frame/frame.json — symbols first, then file rollups
---

# frame-populate

Generate purpose strings for all unpopulated entries in the project frame.

## Rules

- Write caveman: short, dense, no articles, no filler
- "validate JWT, return payload or error" YES
- "This function validates a JSON Web Token and returns the payload or an error" NO
- Symbols first, file purpose last (bottom-up rollup)
- Batch ≤10 symbol patches per write-purposes call
- Skip files with parseError — nothing to describe
- If a symbol's role is obvious from its name + signature, still write a purpose — but keep it tight

## Concurrency

`frame write-purposes` is safe to call in parallel. It acquires a PID-based file lock (`.frame/frame.lock`) on every write and retries with timeout if another writer is active. Stale locks from dead PIDs are cleared automatically.

For large projects, fan out: dispatch parallel subagents (one per file or per batch of files), and each subagent pipes its own `frame write-purposes` call. Don't reach for `flock`, JSONL patch merging, or any other external coordination — the CLI already serializes writes correctly.

Stale lock recovery: if you ever see `frame.json is locked by PID N. Run frame update --force-unlock ...`, run `frame update --force-unlock` once to clear it, then retry.

## Workflow

1. Get current frame state:
   ```bash
   frame read --json
   ```

2. Parse the JSON. Collect files where `purpose === null` or any symbol has `purpose === null`. Exclude files where `parseError !== null`.

3. For each file needing purposes, process symbols first:
   ```bash
   frame read-file <path> --json
   ```
   Read the full symbol detail. For each symbol with `purpose: null`, write a caveman purpose based on the symbol's name, kind, parameters, returns, and languageFeatures.

4. Batch symbol purposes (up to 10) into a JSON array of `PurposePatch` objects and pipe to CLI:
   ```bash
   echo '[{"path":"<file>","symbolName":"<name>","purpose":"<text>"},...]' | frame write-purposes
   ```

5. After all symbols in a file are populated, write the file-level purpose — a one-line rollup summarizing what the file does based on its symbol purposes:
   ```bash
   echo '[{"path":"<file>","purpose":"<rollup text>"}]' | frame write-purposes
   ```

6. Repeat for all files. When done, verify:
   ```bash
   frame read --json
   ```
   Confirm `needsGeneration === 0`.
