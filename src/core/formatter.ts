import type { InitResult } from "./init.ts";
import type { FileEntry, FrameRoot, SearchResult } from "./schema.js";

// --- formatSkeleton ---

export function formatSkeleton(frame: FrameRoot): string {
  const blocks: string[] = [];
  for (const file of frame.files) {
    const tag = file.parseError
      ? `${file.language}] [parse error`
      : file.language;
    let block = `${file.path} [${tag}]`;
    const purpose = file.purpose ?? "[purpose pending]";
    block += `\n  ${purpose}`;
    if (file.exports.length > 0) {
      block += `\n  exports: ${file.exports.join(", ")}`;
    }
    const internalImports = file.imports;
    if (internalImports.length > 0) {
      block += `\n  imports: ${internalImports.join(", ")}`;
    }
    blocks.push(block);
  }
  return blocks.join("\n\n");
}

// --- formatFileDetail ---

export function formatFileDetail(file: FileEntry): string {
  const tag = file.parseError
    ? `${file.language}] [parse error`
    : file.language;
  let out = `${file.path} [${tag}] hash:${file.hash}`;
  const purpose = file.purpose ?? "[purpose pending]";
  out += `\n  ${purpose}`;

  if (file.exports.length > 0) {
    out += `\n  exports: ${file.exports.join(", ")}`;
  }
  if (file.imports.length > 0) {
    out += `\n  imports: ${file.imports.join(", ")}`;
  }
  if (file.externalImports.length > 0) {
    out += `\n  external: ${file.externalImports.join(", ")}`;
  }

  if (file.parseError) {
    out += `\n\n  parse error: ${file.parseError}`;
    return out;
  }

  for (const sym of file.symbols) {
    out += "\n";
    const exported = sym.exported ? " (exported)" : "";
    out += `\n  ${sym.kind} ${sym.name}${exported} hash:${sym.hash}`;
    const symPurpose = sym.purpose ?? "[purpose pending]";
    out += `\n    ${symPurpose}`;
    if (sym.parameters && sym.parameters.length > 0) {
      out += `\n    params: ${sym.parameters.map((p) => `${p.name}: ${p.type}`).join(", ")}`;
    }
    if (sym.returns && sym.returns.length > 0) {
      out += `\n    returns: ${sym.returns.join(", ")}`;
    }
    const featureEntries = Object.entries(sym.languageFeatures);
    for (const [key, value] of featureEntries) {
      out += `\n    ${key}: ${value}`;
    }
  }

  return out;
}

// --- formatSearchResults ---

export function formatSearchResults(
  results: SearchResult[],
  query: string,
): string {
  let out = `search: "${query}" (${results.length} results)`;

  for (const r of results) {
    out += "\n";
    const purpose = r.filePurpose ?? "[purpose pending]";
    out += `\n  score: ${r.score}`;
    out += `\n  path: ${r.filePath}`;
    out += `\n  purpose: ${purpose}`;
    if (r.symbol) {
      out += `\n  symbol: ${r.symbol.name}`;
      out += `\n  kind: ${r.symbol.kind}`;
      out += `\n  exported: ${r.symbol.exported}`;
      if (r.symbol.purpose !== undefined && r.symbol.purpose !== null) {
        out += `\n  symbol purpose: ${r.symbol.purpose}`;
      } else {
        out += "\n  symbol purpose: [purpose pending]";
      }
    }
  }

  return out;
}

// --- formatApiSurface ---

export function formatApiSurface(frame: FrameRoot): string {
  const blocks: string[] = [];

  for (const file of frame.files) {
    const exported = file.symbols.filter((s) => s.exported);
    if (exported.length === 0) continue;

    let block = file.path;
    for (const sym of exported) {
      const params =
        sym.parameters && sym.parameters.length > 0
          ? `(${sym.parameters.map((p) => `${p.name}: ${p.type}`).join(", ")})`
          : "";
      const returns =
        sym.returns && sym.returns.length > 0
          ? ` → ${sym.returns.join(", ")}`
          : "";
      block += `\n  ${sym.kind} ${sym.name}${params}${returns}`;
    }
    blocks.push(block);
  }

  return blocks.join("\n\n");
}

// --- formatDeps ---

export function formatDeps(
  file: FileEntry,
  reverseDeps: string[],
  includeExternal: boolean,
): string {
  let out = file.path;
  const sections: string[] = [];

  if (file.imports.length > 0) {
    let section = "\n\nImports:";
    for (const imp of file.imports) {
      section += `\n  ${imp}`;
    }
    sections.push(section);
  }

  if (includeExternal && file.externalImports.length > 0) {
    let section = "\n\nExternal imports:";
    for (const imp of file.externalImports) {
      section += `\n  ${imp}`;
    }
    sections.push(section);
  }

  if (reverseDeps.length > 0) {
    let section = "\n\nImported by:";
    for (const dep of reverseDeps) {
      section += `\n  ${dep}`;
    }
    sections.push(section);
  }

  out += sections.join("");
  return out;
}

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

// --- formatHelp ---

const COMMANDS: Record<
  string,
  { usage: string; args?: string; flags?: string; output: string; hint: string }
> = {
  generate: {
    usage: "frame generate",
    flags: [
      "--force-unlock  clear stale frame lock",
      "--concurrency <n> worker count (default: cpu count)",
      "--ignore <glob>   additional ignore pattern (repeatable)",
      "--json          return raw JSON instead of formatted text",
    ].join("\n    "),
    output:
      "builds frame.json from scratch by walking project,\n    parsing all supported files, and computing hashes.",
    hint: "use when no frame exists or frame is corrupt.\n    prefer `frame update` for incremental changes.",
  },
  update: {
    usage: "frame update",
    flags: [
      "--force-unlock  clear stale frame lock",
      "--concurrency <n> worker count (default: cpu count)",
      "--ignore <glob>   additional ignore pattern (repeatable)",
      "--json          return raw JSON instead of formatted text",
    ].join("\n    "),
    output:
      "re-hashes all files, invalidates purposes for changed code,\n    adds new files, removes deleted files.",
    hint: "run after code changes to keep frame current.\n    faster than generate — skips unchanged files.",
  },
  read: {
    usage: "frame read",
    flags: "--json          return raw JSON instead of formatted text",
    output:
      "all files with paths, languages, purposes, exports, and imports.\n    no symbol detail — use read-file for that.",
    hint: "start here. scan file list, then drill into\n    specific files with `frame read-file <path>`.",
  },
  "read-file": {
    usage: "frame read-file <path>",
    args: "path            relative path from project root",
    flags: "--json          return raw JSON instead of formatted text",
    output:
      "file metadata, exports, imports, externalImports, and all symbols with\n    purposes, kinds, parameters, return types, and languageFeatures.\n    Files with parse errors show the error message instead of symbols.",
    hint: "call after `frame read` to drill into a specific file",
  },
  search: {
    usage: "frame search <query>",
    args: "query           one or more search terms",
    flags: [
      "--limit <n>     max results (default: 20)",
      "--files-only    file-level matches only",
      "--symbols-only  symbol-level matches only",
      "--threshold <n> minimum score to include (default: 1)",
      "--json          return raw JSON instead of formatted text",
    ].join("\n    "),
    output:
      "ranked list of matching files and symbols with scores,\n    paths, names, kinds, purposes, and export status.\n    entries with null purpose show [purpose pending].",
    hint: "primary discovery tool — use when you know what you need\n    but not where it lives. start broad, narrow with flags.",
  },
  "api-surface": {
    usage: "frame api-surface",
    flags: "--json          return raw JSON instead of formatted text",
    output:
      "all exported symbols grouped by file.\n    one line per symbol: kind name(params) → returns.",
    hint: "use to understand public API shape across the project.\n    combine with search to find specific exports.",
  },
  deps: {
    usage: "frame deps <path>",
    args: "path            relative path from project root",
    flags: [
      "--external      include external package imports",
      "--json          return raw JSON instead of formatted text",
    ].join("\n    "),
    output:
      "what this file imports from (internal, and external with flag)\n    and what other project files import this file.",
    hint: "use to understand dependency context before changes.\n    --external for build/package issues.",
  },
};

const TOP_LEVEL_HELP = `frame — structural frame of your codebase

COMMANDS
  generate          build frame from scratch
  update            re-hash files, invalidate changed purposes
  read              list all files with purposes (no symbols)
  read-file <path>  full symbol detail for one file
  search <query>    search purposes across all files and symbols
  api-surface       all exported symbols grouped by file
  deps <path>       import relationships for one file

  help              show this message
  help <command>    detail for a specific command
  help --agent      machine-optimized summary for agent context injection

OPTIONS
  --root <path>     project root (default: cwd)
  --data <path>     frame file location (default: .frame/frame.json)
  --json            return raw JSON instead of formatted text (read commands)
  --concurrency <n> worker count for generate/update (default: cpu count)
  --ignore <glob>   additional ignore pattern for file walking (repeatable)`;

const AGENT_HELP = `TOOL: frame
PURPOSE: query structural frame of this project

READ WORKFLOW:
  1. frame read                → file list + purposes, no symbols
  2. frame read-file <path>    → full symbols for one file
  3. frame search <query>      → find files/symbols by purpose text, name, path
  4. frame api-surface         → all exported symbols
  5. frame deps <path>         → import graph for one file (--external for packages)

WRITE WORKFLOW (maintainers only):
  frame generate               → build frame from scratch
  frame update                 → sync frame to current code

FLAGS (all commands):
  --json                       → raw JSON output
  --root <path>                → project root override
  --data <path>                → frame file override

SEARCH FLAGS:
  --limit <n>                  → max results (default 20)
  --files-only                 → file matches only
  --symbols-only               → symbol matches only
  --threshold <n>              → min relevance score

DEPS FLAGS:
  --external                   → include external package imports

WRITE FLAGS:
  --concurrency <n>            → worker count (default: cpu count)
  --force-unlock               → clear stale frame lock
  --ignore <glob>              → additional ignore pattern (repeatable)

NULL PURPOSE FIELDS:
  purpose: null means not yet generated
  run: frame update && frame-populate to fill

PARSE ERRORS:
  files that fail to parse appear with [parse error] marker
  symbols array is empty, parseError field has details`;

export function formatHelp(command?: string, agent?: boolean): string {
  if (agent) {
    return AGENT_HELP;
  }

  if (!command) {
    return TOP_LEVEL_HELP;
  }

  const cmd = COMMANDS[command];
  if (!cmd) {
    return `Unknown command: ${command}\n\n${TOP_LEVEL_HELP}`;
  }

  let out = cmd.usage;
  if (cmd.args) {
    out += `\n\n  ARGUMENTS\n    ${cmd.args}`;
  }
  if (cmd.flags) {
    out += `\n\n  FLAGS\n    ${cmd.flags}`;
  }
  out += `\n\n  OUTPUT\n    ${cmd.output}`;
  out += `\n\n  AGENT HINT\n    ${cmd.hint}`;

  return out;
}
