import { describe, expect, test } from "bun:test";
import {
  formatApiSurface,
  formatDeps,
  formatFileDetail,
  formatHelp,
  formatInitResult,
  formatSearchResults,
  formatSkeleton,
} from "../../src/core/formatter.js";
import type {
  FileEntry,
  FrameRoot,
  FrameSymbol,
  SearchResult,
} from "../../src/core/schema.js";

// --- Test Fixtures ---

function makeSymbol(overrides: Partial<FrameSymbol> = {}): FrameSymbol {
  return {
    name: "doStuff",
    kind: "function",
    hash: "abc123",
    exported: true,
    purpose: "does stuff",
    parameters: [{ name: "input", type: "string" }],
    returns: ["boolean"],
    languageFeatures: {},
    ...overrides,
  };
}

function makeFile(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    path: "src/auth/handler.ts",
    language: "typescript",
    pluginVersion: "1.0.0",
    hash: "3vKx9mP",
    purpose: "handles HTTP auth routes",
    parseError: null,
    exports: ["AuthHandler", "validateToken"],
    imports: ["src/db/user.ts", "src/lib/jwt.ts"],
    externalImports: ["jsonwebtoken", "zod"],
    symbols: [makeSymbol()],
    ...overrides,
  };
}

function makeFrame(overrides: Partial<FrameRoot> = {}): FrameRoot {
  return {
    version: "1.0.0",
    generatedAt: "2026-04-14T10:00:00Z",
    updatedAt: "2026-04-14T12:00:00Z",
    projectRoot: "/project",
    totalFiles: 1,
    totalSymbols: 1,
    needsGeneration: 0,
    parseErrors: 0,
    languageComposition: { typescript: 1 },
    files: [makeFile()],
    ...overrides,
  };
}

// No ANSI escape codes in any output
const ANSI_RE = /\x1b\[/;

// --- formatSkeleton ---

describe("formatSkeleton", () => {
  test("shows file path and language", () => {
    const out = formatSkeleton(makeFrame());
    expect(out).toContain("src/auth/handler.ts [typescript]");
  });

  test("shows purpose text", () => {
    const out = formatSkeleton(makeFrame());
    expect(out).toContain("handles HTTP auth routes");
  });

  test("shows exports list", () => {
    const out = formatSkeleton(makeFrame());
    expect(out).toContain("exports: AuthHandler, validateToken");
  });

  test("shows imports list", () => {
    const out = formatSkeleton(makeFrame());
    expect(out).toContain("imports: src/db/user.ts, src/lib/jwt.ts");
  });

  test("shows [parse error] marker for errored files", () => {
    const frame = makeFrame({
      files: [makeFile({ parseError: "syntax error at line 5" })],
    });
    const out = formatSkeleton(frame);
    expect(out).toContain("[parse error]");
  });

  test("shows [purpose pending] for null purpose", () => {
    const frame = makeFrame({
      files: [makeFile({ purpose: null })],
    });
    const out = formatSkeleton(frame);
    expect(out).toContain("[purpose pending]");
  });

  test("does not include externalImports", () => {
    const out = formatSkeleton(makeFrame());
    expect(out).not.toContain("jsonwebtoken");
    expect(out).not.toContain("zod");
  });

  test("no ANSI codes", () => {
    const out = formatSkeleton(makeFrame());
    expect(ANSI_RE.test(out)).toBe(false);
  });
});

// --- formatFileDetail ---

describe("formatFileDetail", () => {
  test("shows symbol blocks", () => {
    const out = formatFileDetail(makeFile());
    expect(out).toContain("function doStuff (exported) hash:abc123");
    expect(out).toContain("does stuff");
    expect(out).toContain("params: input: string");
    expect(out).toContain("returns: boolean");
  });

  test("renders languageFeatures as key:value", () => {
    const file = makeFile({
      symbols: [
        makeSymbol({
          languageFeatures: { async: true, throws: "InvalidTokenError" },
        }),
      ],
    });
    const out = formatFileDetail(file);
    expect(out).toContain("async: true");
    expect(out).toContain("throws: InvalidTokenError");
  });

  test("shows parse error message instead of symbols", () => {
    const file = makeFile({
      parseError: "syntax error at line 5",
      symbols: [],
    });
    const out = formatFileDetail(file);
    expect(out).toContain("parse error: syntax error at line 5");
    expect(out).toContain("[parse error]");
  });

  test("shows file hash", () => {
    const out = formatFileDetail(makeFile());
    expect(out).toContain("hash:3vKx9mP");
  });

  test("shows external imports", () => {
    const out = formatFileDetail(makeFile());
    expect(out).toContain("external: jsonwebtoken, zod");
  });

  test("no ANSI codes", () => {
    const out = formatFileDetail(makeFile());
    expect(ANSI_RE.test(out)).toBe(false);
  });
});

// --- formatSearchResults ---

describe("formatSearchResults", () => {
  const results: SearchResult[] = [
    {
      score: 8.5,
      filePath: "src/auth/handler.ts",
      filePurpose: "handles auth",
      symbol: {
        name: "validateToken",
        kind: "function",
        purpose: "validates JWT",
        exported: true,
      },
    },
    {
      score: 3.2,
      filePath: "src/db/user.ts",
      filePurpose: null,
    },
  ];

  test("shows query and count", () => {
    const out = formatSearchResults(results, "auth token");
    expect(out).toContain('search: "auth token" (2 results)');
  });

  test("shows score and path", () => {
    const out = formatSearchResults(results, "auth");
    expect(out).toContain("score: 8.5");
    expect(out).toContain("path: src/auth/handler.ts");
  });

  test("shows symbol details for symbol matches", () => {
    const out = formatSearchResults(results, "auth");
    expect(out).toContain("symbol: validateToken");
    expect(out).toContain("kind: function");
    expect(out).toContain("exported: true");
  });

  test("shows [purpose pending] for null file purpose", () => {
    const out = formatSearchResults(results, "auth");
    expect(out).toContain("[purpose pending]");
  });

  test("no ANSI codes", () => {
    const out = formatSearchResults(results, "auth");
    expect(ANSI_RE.test(out)).toBe(false);
  });
});

// --- formatApiSurface ---

describe("formatApiSurface", () => {
  test("shows only exported symbols grouped by file", () => {
    const frame = makeFrame({
      files: [
        makeFile({
          symbols: [
            makeSymbol({ name: "pub", exported: true }),
            makeSymbol({ name: "priv", exported: false }),
          ],
        }),
      ],
    });
    const out = formatApiSurface(frame);
    expect(out).toContain("src/auth/handler.ts");
    expect(out).toContain("function pub(input: string) → boolean");
    expect(out).not.toContain("priv");
  });

  test("skips files with no exports", () => {
    const frame = makeFrame({
      files: [
        makeFile({
          path: "src/internal.ts",
          symbols: [makeSymbol({ exported: false })],
        }),
      ],
    });
    const out = formatApiSurface(frame);
    expect(out).not.toContain("src/internal.ts");
  });

  test("handles symbols with no params or returns", () => {
    const frame = makeFrame({
      files: [
        makeFile({
          symbols: [
            makeSymbol({
              name: "MY_CONST",
              kind: "constant",
              parameters: undefined,
              returns: undefined,
            }),
          ],
        }),
      ],
    });
    const out = formatApiSurface(frame);
    expect(out).toContain("constant MY_CONST");
    expect(out).not.toContain("(");
    expect(out).not.toContain("→");
  });

  test("no ANSI codes", () => {
    const out = formatApiSurface(makeFrame());
    expect(ANSI_RE.test(out)).toBe(false);
  });
});

// --- formatDeps ---

describe("formatDeps", () => {
  test("shows imports section", () => {
    const out = formatDeps(makeFile(), ["src/routes.ts"], false);
    expect(out).toContain("Imports:");
    expect(out).toContain("src/db/user.ts");
    expect(out).toContain("src/lib/jwt.ts");
  });

  test("shows reverse deps section", () => {
    const out = formatDeps(makeFile(), ["src/routes.ts"], false);
    expect(out).toContain("Imported by:");
    expect(out).toContain("src/routes.ts");
  });

  test("external only shown when flag set", () => {
    const out1 = formatDeps(makeFile(), [], false);
    expect(out1).not.toContain("External imports:");

    const out2 = formatDeps(makeFile(), [], true);
    expect(out2).toContain("External imports:");
    expect(out2).toContain("jsonwebtoken");
    expect(out2).toContain("zod");
  });

  test("omits empty sections", () => {
    const file = makeFile({ imports: [], externalImports: [] });
    const out = formatDeps(file, [], false);
    expect(out).not.toContain("Imports:");
    expect(out).not.toContain("External imports:");
    expect(out).not.toContain("Imported by:");
  });

  test("no ANSI codes", () => {
    const out = formatDeps(makeFile(), ["src/routes.ts"], true);
    expect(ANSI_RE.test(out)).toBe(false);
  });
});

// --- formatHelp ---

describe("formatHelp", () => {
  test("no args returns top-level help with COMMANDS", () => {
    const out = formatHelp();
    expect(out).toContain("COMMANDS");
    expect(out).toContain("generate");
    expect(out).toContain("update");
    expect(out).toContain("read");
    expect(out).toContain("read-file");
    expect(out).toContain("search");
    expect(out).toContain("api-surface");
    expect(out).toContain("deps");
    expect(out).toContain("help");
  });

  test("command help contains ARGUMENTS, FLAGS, AGENT HINT", () => {
    const out = formatHelp("search");
    expect(out).toContain("ARGUMENTS");
    expect(out).toContain("FLAGS");
    expect(out).toContain("AGENT HINT");
  });

  test("agent mode contains TOOL: frame and READ WORKFLOW", () => {
    const out = formatHelp(undefined, true);
    expect(out).toContain("TOOL: frame");
    expect(out).toContain("READ WORKFLOW:");
  });

  test("agent mode contains NULL PURPOSE FIELDS", () => {
    const out = formatHelp(undefined, true);
    expect(out).toContain("NULL PURPOSE FIELDS:");
  });

  test("agent mode contains PARSE ERRORS", () => {
    const out = formatHelp(undefined, true);
    expect(out).toContain("PARSE ERRORS:");
  });

  test("top-level help contains OPTIONS", () => {
    const out = formatHelp();
    expect(out).toContain("OPTIONS");
    expect(out).toContain("--root");
    expect(out).toContain("--json");
    expect(out).toContain("--concurrency");
  });

  test("unknown command falls back to top-level", () => {
    const out = formatHelp("nonexistent");
    expect(out).toContain("Unknown command: nonexistent");
    expect(out).toContain("COMMANDS");
  });

  test("no ANSI codes in any help output", () => {
    expect(ANSI_RE.test(formatHelp())).toBe(false);
    expect(ANSI_RE.test(formatHelp("search"))).toBe(false);
    expect(ANSI_RE.test(formatHelp(undefined, true))).toBe(false);
  });

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
});

// --- formatInitResult ---

describe("formatInitResult", () => {
  test("clean run shows all created with Next hint", () => {
    const out = formatInitResult({
      root: "/Users/me/myproject",
      outcomes: [
        { path: ".frame/.gitignore", status: "created" },
        { path: ".claude/skills/frame-context/SKILL.md", status: "created" },
        { path: ".claude/skills/frame-populate/SKILL.md", status: "created" },
      ],
    });

    expect(out).toBe(
      [
        "Initialized frame at /Users/me/myproject",
        "  created  .frame/.gitignore",
        "  created  .claude/skills/frame-context/SKILL.md",
        "  created  .claude/skills/frame-populate/SKILL.md",
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
        { path: ".claude/skills/frame-context/SKILL.md", status: "skipped" },
        { path: ".claude/skills/frame-populate/SKILL.md", status: "skipped" },
      ],
    });

    expect(out).toBe(
      [
        "Initialized frame at /tmp/p",
        "  skipped  .frame/.gitignore (exists)",
        "  skipped  .claude/skills/frame-context/SKILL.md (exists)",
        "  skipped  .claude/skills/frame-populate/SKILL.md (exists)",
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
        { path: ".claude/skills/frame-context/SKILL.md", status: "created" },
        { path: ".claude/skills/frame-populate/SKILL.md", status: "created" },
      ],
    });

    expect(out).toBe(
      [
        "Initialized frame at /x",
        "  skipped  .frame/.gitignore (exists)",
        "  created  .claude/skills/frame-context/SKILL.md",
        "  created  .claude/skills/frame-populate/SKILL.md",
        "",
        "Next: run `frame generate`",
      ].join("\n"),
    );
  });
});
