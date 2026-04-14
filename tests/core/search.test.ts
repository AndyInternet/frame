import { describe, expect, test } from "bun:test";
import { search } from "../../src/core/search.ts";
import type {
  FileEntry,
  FrameRoot,
  FrameSymbol,
  SearchOptions,
} from "../../src/core/schema.ts";

// --- Test helpers ---

function makeSymbol(overrides: Partial<FrameSymbol> = {}): FrameSymbol {
  return {
    name: "myFunc",
    kind: "function",
    hash: "abc123",
    exported: false,
    purpose: null,
    languageFeatures: {},
    ...overrides,
  };
}

function makeFile(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    path: "src/utils/helper.ts",
    language: "typescript",
    pluginVersion: "1.0.0",
    hash: "xyz789",
    purpose: null,
    parseError: null,
    exports: [],
    imports: [],
    externalImports: [],
    symbols: [],
    ...overrides,
  };
}

function makeFrame(files: FileEntry[]): FrameRoot {
  return {
    version: "1.0.0",
    generatedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    projectRoot: "/project",
    totalFiles: files.length,
    totalSymbols: files.reduce((acc, f) => acc + f.symbols.length, 0),
    needsGeneration: 0,
    parseErrors: 0,
    languageComposition: { typescript: files.length },
    files,
  };
}

function defaultOpts(overrides: Partial<SearchOptions> = {}): SearchOptions {
  return {
    limit: 100,
    filesOnly: false,
    symbolsOnly: false,
    threshold: 0,
    ...overrides,
  };
}

// --- Tests ---

describe("search", () => {
  const exportedSymbol = makeSymbol({
    name: "fetchData",
    kind: "function",
    exported: true,
    purpose: "fetches data from remote API",
  });

  const privateSymbol = makeSymbol({
    name: "parseResponse",
    kind: "function",
    exported: false,
    purpose: "parses raw API response into domain objects",
  });

  const nullPurposeSymbol = makeSymbol({
    name: "helper",
    kind: "function",
    exported: false,
    purpose: null,
  });

  const fileWithSymbols = makeFile({
    path: "src/api/client.ts",
    purpose: "HTTP client for remote API calls",
    symbols: [exportedSymbol, privateSymbol, nullPurposeSymbol],
  });

  const fileNoPurpose = makeFile({
    path: "src/utils/math.ts",
    purpose: null,
    symbols: [
      makeSymbol({ name: "add", exported: true, purpose: "adds two numbers" }),
    ],
  });

  const frame = makeFrame([fileWithSymbols, fileNoPurpose]);

  test("exact symbol name match → score includes 10 points", () => {
    // Query "fetchdata" should match symbol name "fetchData" (case-insensitive)
    const results = search(frame, "fetchData", defaultOpts({ symbolsOnly: true }));
    const hit = results.find((r) => r.symbol?.name === "fetchData");
    expect(hit).toBeDefined();
    // Exact name match = 10, path has no match for "fetchdata",
    // purpose: "fetches data from remote API" — partial match "fetchdata" won't match "fetches" or "data" as a single term
    // Actually "fetchdata" is one term. Let's verify score >= 10
    expect(hit!.score).toBeGreaterThanOrEqual(10);
  });

  test("exact symbol name match case-insensitive", () => {
    const results = search(frame, "FETCHDATA", defaultOpts({ symbolsOnly: true }));
    const hit = results.find((r) => r.symbol?.name === "fetchData");
    expect(hit).toBeDefined();
    expect(hit!.score).toBeGreaterThanOrEqual(10);
  });

  test("path substring match → score includes 5 points", () => {
    // "client" appears in path "src/api/client.ts"
    const results = search(frame, "client", defaultOpts({ filesOnly: true }));
    const hit = results.find((r) => r.filePath === "src/api/client.ts");
    expect(hit).toBeDefined();
    // path match = 5, purpose partial "client" in "HTTP client for remote API calls" = 1
    // only 1 term and it's found → all terms bonus = 3
    expect(hit!.score).toBeGreaterThanOrEqual(5);
  });

  test("all terms in purpose → score includes 3 bonus", () => {
    // "HTTP client" — both terms in purpose "HTTP client for remote API calls"
    const results = search(frame, "HTTP client", defaultOpts({ filesOnly: true }));
    const hit = results.find((r) => r.filePath === "src/api/client.ts");
    expect(hit).toBeDefined();
    // path: "client" matches = 5, "http" no path match = 0 → 5 from path
    // purpose: both "http" and "client" found → all terms bonus = 3
    // Total = 5 + 3 = 8
    expect(hit!.score).toBe(8);
  });

  test("partial purpose match → 1 per matched term", () => {
    // "remote xyz" — "remote" is in purpose, "xyz" is not
    const results = search(frame, "remote xyz", defaultOpts({ filesOnly: true }));
    const hit = results.find((r) => r.filePath === "src/api/client.ts");
    expect(hit).toBeDefined();
    // path: neither "remote" nor "xyz" in "src/api/client.ts" → 0
    // purpose: "remote" found, "xyz" not → partial = 1
    expect(hit!.score).toBe(1);
  });

  test("exported symbol → 1.5x multiplier applied", () => {
    // "fetchData" as single term
    // fetchData (exported): name exact = 10, path "fetchdata" not in "src/api/client.ts" = 0
    //   purpose "fetches data from remote API" — "fetchdata" as one term not in purpose
    //   base = 10, exported → 10 * 1.5 = 15
    // parseResponse (not exported): name "parseresponse" ≠ "fetchdata", no path match
    //   purpose "parses raw API response into domain objects" — "fetchdata" not in purpose
    //   base = 0
    const results = search(frame, "fetchData", defaultOpts({ symbolsOnly: true }));
    const exported = results.find((r) => r.symbol?.name === "fetchData");
    expect(exported).toBeDefined();
    expect(exported!.score).toBe(15); // 10 * 1.5
    expect(exported!.symbol!.exported).toBe(true);
  });

  test("non-exported symbol has no multiplier", () => {
    // "parseResponse" as single term
    // exact name match = 10, no path substring, purpose has "parses" not "parseresponse"
    // base = 10, not exported → stays 10
    const results = search(frame, "parseResponse", defaultOpts({ symbolsOnly: true }));
    const hit = results.find((r) => r.symbol?.name === "parseResponse");
    expect(hit).toBeDefined();
    expect(hit!.score).toBe(10);
  });

  test("filesOnly: true → no symbol results", () => {
    const results = search(frame, "fetchData", defaultOpts({ filesOnly: true }));
    for (const r of results) {
      expect(r.symbol).toBeUndefined();
    }
  });

  test("symbolsOnly: true → no file results", () => {
    const results = search(frame, "client", defaultOpts({ symbolsOnly: true }));
    // All results should have symbol property
    for (const r of results) {
      expect(r.symbol).toBeDefined();
    }
  });

  test("limit: 5 → max 5 results", () => {
    // Build a frame with many files to get more than 5 results
    const manyFiles = Array.from({ length: 20 }, (_, i) =>
      makeFile({
        path: `src/module${i}/index.ts`,
        purpose: `module ${i} handles data processing`,
        symbols: [
          makeSymbol({
            name: `process${i}`,
            exported: true,
            purpose: "processes data",
          }),
        ],
      }),
    );
    const bigFrame = makeFrame(manyFiles);
    const results = search(bigFrame, "data", defaultOpts({ limit: 5 }));
    expect(results.length).toBeLessThanOrEqual(5);
  });

  test("threshold: 10 → low-scoring entries excluded", () => {
    const results = search(frame, "remote", defaultOpts({ threshold: 10 }));
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(10);
    }
  });

  test("null purpose → still searchable by name/path", () => {
    // "helper" matches symbol name "helper" exactly
    const results = search(frame, "helper", defaultOpts({ symbolsOnly: true }));
    const hit = results.find((r) => r.symbol?.name === "helper");
    expect(hit).toBeDefined();
    expect(hit!.symbol!.purpose).toBeNull();
    expect(hit!.score).toBeGreaterThanOrEqual(10); // exact name match
  });

  test("null purpose file → still searchable by path", () => {
    // "math" in path "src/utils/math.ts"
    const results = search(frame, "math", defaultOpts({ filesOnly: true }));
    const hit = results.find((r) => r.filePath === "src/utils/math.ts");
    expect(hit).toBeDefined();
    expect(hit!.filePurpose).toBeNull();
    expect(hit!.score).toBe(5); // path match only, no purpose
  });

  test("empty query → no results", () => {
    const results = search(frame, "", defaultOpts());
    expect(results).toEqual([]);
  });

  test("whitespace-only query → no results", () => {
    const results = search(frame, "   ", defaultOpts());
    expect(results).toEqual([]);
  });

  test("results sorted by score descending", () => {
    const results = search(frame, "api", defaultOpts());
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  test("search result shape matches SearchResult interface", () => {
    const results = search(frame, "fetchData", defaultOpts());
    const symbolResult = results.find((r) => r.symbol);
    const fileResult = results.find((r) => !r.symbol);

    if (symbolResult) {
      expect(typeof symbolResult.score).toBe("number");
      expect(typeof symbolResult.filePath).toBe("string");
      expect(symbolResult.symbol).toBeDefined();
      expect(typeof symbolResult.symbol!.name).toBe("string");
      expect(typeof symbolResult.symbol!.kind).toBe("string");
      expect(typeof symbolResult.symbol!.exported).toBe("boolean");
    }

    if (fileResult) {
      expect(typeof fileResult.score).toBe("number");
      expect(typeof fileResult.filePath).toBe("string");
      expect(fileResult.symbol).toBeUndefined();
    }
  });
});
