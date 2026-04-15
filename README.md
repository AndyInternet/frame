# frame

A CLI tool that generates a structured semantic map of your codebase. Frame parses source files using tree-sitter, extracts symbols (functions, classes, types, interfaces, etc.), tracks imports and exports, and produces a single JSON file (`.frame/frame.json`) that gives AI agents — or any tooling — a complete, navigable picture of a project without reading raw source.

## Why

AI coding agents need to understand a project's structure before they can work in it effectively. Reading every file is slow and blows through context windows. Frame solves this by producing a compact structural index: every file, every symbol, every dependency relationship, with slots for AI-generated purpose descriptions.

## Install

### From source

```sh
git clone https://github.com/AndyInternet/frame.git
cd frame
bun install
bun run build
```

The compiled binary is output to `bin/frame`. Copy it somewhere on your `$PATH`:

```sh
cp bin/frame /usr/local/bin/frame
```

### Cross-platform builds

```sh
bun build --compile --target=bun-linux-x64   ./src/cli.ts --outfile bin/frame-linux-x64
bun build --compile --target=bun-darwin-arm64 ./src/cli.ts --outfile bin/frame-darwin-arm64
bun build --compile --target=bun-windows-x64  ./src/cli.ts --outfile bin/frame-windows-x64.exe
```

### Development

```sh
bun run dev          # run from source
bun test             # run test suite
bun run lint         # check with biome
bun run lint:fix     # auto-fix lint issues
bun run format       # format with biome
```

## Quick start

```sh
# Initialize frame in a project (creates .frame/, installs Claude skills)
frame init

# Generate a frame for the current project
frame generate

# List all files with purposes
frame read

# Drill into a specific file
frame read-file src/core/frame.ts

# Search for symbols or files
frame search "parse"

# View the public API
frame api-surface

# Check a file's dependencies
frame deps src/core/walker.ts
```

## Commands

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

### `frame generate`

Build a frame from scratch. Walks the project, parses all supported files, extracts symbols, and writes `.frame/frame.json`.

```sh
frame generate [--force-unlock] [--concurrency <n>] [--ignore <glob>]
```

### `frame update`

Incrementally sync the frame to current code. Re-hashes files, invalidates purposes for changed code, adds new files, and removes deleted ones. Faster than `generate` — skips unchanged files.

```sh
frame update [--force-unlock] [--concurrency <n>] [--ignore <glob>]
```

### `frame read`

List all files with their language, purpose, exports, and imports. No symbol detail — use `read-file` to drill in.

```sh
frame read [--json]
```

### `frame read-file <path>`

Full symbol detail for a single file: parameters, return types, purposes, language-specific features.

```sh
frame read-file src/core/search.ts [--json]
```

### `frame search <query>`

Search across file names, symbol names, and purposes. Results are ranked by relevance; exported symbols get a score boost.

```sh
frame search "auth middleware" [--limit <n>] [--files-only] [--symbols-only] [--threshold <n>] [--json]
```

### `frame api-surface`

All exported symbols grouped by file, showing kind, name, parameters, and return types.

```sh
frame api-surface [--json]
```

### `frame deps <path>`

Import relationships for a file: what it imports, what imports it, and optionally external packages.

```sh
frame deps src/core/frame.ts [--external] [--json]
```

### `frame write-purposes`

Patch AI-generated purpose descriptions from stdin. Accepts a JSON array of `{path, symbolName?, purpose}` objects.

```sh
echo '[{"path":"src/cli.ts","purpose":"CLI entry point"}]' | frame write-purposes
```

### `frame help`

```sh
frame help              # top-level overview
frame help <command>    # detail for a specific command
frame help --agent      # machine-optimized output for agent context injection
```

### Global options

| Flag | Description |
|------|-------------|
| `--root <path>` | Project root (default: nearest ancestor with `.git` or `.frame/`, else cwd) |
| `--data <path>` | Frame file location (default: `.frame/frame.json`) |
| `--json` | Raw JSON output instead of formatted text |
| `--concurrency <n>` | Worker count for generate/update (default: CPU count) |
| `--ignore <glob>` | Additional ignore pattern for file walking (repeatable) |

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

## Supported languages

| Language | Extensions | Extracted symbols |
|----------|-----------|-------------------|
| TypeScript | `.ts`, `.tsx` | functions, methods, classes, interfaces, types, enums, constants, variables |
| Go | `.go` | functions, methods, structs, interfaces, enums, constants, variables |

## Output format

Frame produces `.frame/frame.json` with this structure:

```json
{
  "version": "1.0.0",
  "generatedAt": "2026-04-14T00:00:00.000Z",
  "updatedAt": "2026-04-14T00:00:00.000Z",
  "projectRoot": "/path/to/project",
  "totalFiles": 42,
  "totalSymbols": 318,
  "needsGeneration": 0,
  "parseErrors": 0,
  "languageComposition": { "typescript": 38, "go": 4 },
  "files": [
    {
      "path": "src/core/frame.ts",
      "language": "typescript",
      "hash": "a1b2c3",
      "purpose": "Core frame generation and update logic",
      "exports": ["generateFrame", "updateFrame"],
      "imports": ["./walker.js", "./schema.js"],
      "externalImports": ["commander"],
      "symbols": [
        {
          "name": "generateFrame",
          "kind": "function",
          "hash": "d4e5f6",
          "exported": true,
          "purpose": "Walks project and builds frame from scratch",
          "parameters": [{ "name": "opts", "type": "GenerateOptions" }],
          "returns": ["Promise<FrameRoot>"],
          "languageFeatures": {}
        }
      ]
    }
  ]
}
```

Purposes are nullable — `null` means "not yet generated." Run `frame update` followed by `frame-populate` (the Claude Code skill) to fill them with AI-generated descriptions.

## Architecture

```
src/
  cli.ts                  CLI entry point (commander)
  core/
    frame.ts              Generation and update logic
    walker.ts             File discovery (git-aware, respects .gitignore)
    config.ts             .frame/config.json schema, defaults, loader
    workers.ts            Parallel parsing via Bun worker threads
    worker-entry.ts       Worker thread entry point
    registry.ts           Language plugin registration and lookup
    schema.ts             TypeScript types for all data structures
    hash.ts               Fast hashing (Bun wyhash, base62 encoded)
    lock.ts               File-based locking with PID liveness checks
    search.ts             Tokenized search with weighted scoring
    formatter.ts          Human-readable output formatting
    root.ts               Project root auto-detection
    init.ts               Project scaffolding (frame init)
    wasm-loader.ts        Static WASM grammar imports
  plugins/
    typescript/           TypeScript/TSX language plugin
      index.ts            Plugin manifest
      parser.ts           AST traversal and symbol extraction
      hashing.ts          AST-level hashing (ignores comments/whitespace)
      prompts.ts          AI purpose generation templates
    go/                   Go language plugin (same structure)
grammars/                 Tree-sitter WASM grammar files
```

### Key design decisions

- **AST-level hashing**: Hashes are computed from the AST with comments and whitespace stripped, so reformatting or adding comments won't invalidate purposes.
- **Plugin architecture**: Each language is a self-contained plugin. Adding a new language means implementing the plugin interface, registering it, and adding a WASM grammar import.
- **WASM over native addons**: Tree-sitter grammars are loaded as WASM, making them embeddable in the compiled binary with no platform-specific compilation step.
- **Parallel workers**: Files are parsed concurrently using Bun worker threads, with automatic fallback to in-process parsing if workers are unavailable.
- **File locking**: A PID-based lockfile prevents concurrent frame modifications, with automatic cleanup of stale locks from dead processes.

## Adding a language

1. Create a plugin directory under `src/plugins/<language>/` with `index.ts`, `parser.ts`, `hashing.ts`, and `prompts.ts`
2. Register the plugin in `src/core/registry.ts`
3. Add the WASM grammar import in `src/core/wasm-loader.ts`
4. Run `bun run update-grammars` to copy the `.wasm` file into `grammars/`

## Tech stack

| Concern | Choice |
|---------|--------|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript |
| AST parsing | [web-tree-sitter](https://github.com/nicolo-ribaudo/tree-sitter-wasm) (WASM) |
| CLI framework | [Commander](https://github.com/tj/commander.js) |
| Lint/format | [Biome](https://biomejs.dev) |
| Testing | `bun:test` |
| Distribution | `bun build --compile` (single binary, all WASM embedded) |

## License

MIT - see [LICENSE](LICENSE).
