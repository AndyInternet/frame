import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeStats,
  generate,
  loadFrame,
  writePurposes,
} from "../../src/core/frame.ts";
import {
  FrameNotFoundError,
  type FileEntry,
  type FrameSymbol,
} from "../../src/core/schema.ts";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "frame-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeSymbol(overrides: Partial<FrameSymbol> = {}): FrameSymbol {
  return {
    name: "test",
    kind: "function",
    hash: "sym123",
    exported: true,
    purpose: null,
    languageFeatures: {},
    ...overrides,
  };
}

function makeFile(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    path: "test.ts",
    language: "typescript",
    pluginVersion: "0.1.0",
    hash: "abc123",
    purpose: null,
    parseError: null,
    exports: [],
    imports: [],
    externalImports: [],
    symbols: [],
    ...overrides,
  };
}

describe("computeStats", () => {
  test("known FileEntry[] → verify all counts", () => {
    const files: FileEntry[] = [
      makeFile({
        path: "a.ts",
        language: "typescript",
        purpose: "file a purpose",
        symbols: [
          makeSymbol({ name: "foo", purpose: "foo purpose" }),
          makeSymbol({ name: "bar", purpose: null }),
        ],
      }),
      makeFile({
        path: "b.go",
        language: "go",
        purpose: null,
        symbols: [makeSymbol({ name: "baz", purpose: "baz purpose" })],
      }),
    ];

    const stats = computeStats(files);
    expect(stats.totalFiles).toBe(2);
    expect(stats.totalSymbols).toBe(3);
    // b.go null purpose (1) + bar null purpose (1) = 2
    expect(stats.needsGeneration).toBe(2);
    expect(stats.parseErrors).toBe(0);
    expect(stats.languageComposition).toEqual({ typescript: 1, go: 1 });
  });

  test("file with parseError → excluded from needsGeneration, counted in parseErrors", () => {
    const files: FileEntry[] = [
      makeFile({
        path: "broken.ts",
        parseError: "Syntax error at line 1",
        purpose: null,
      }),
      makeFile({
        path: "ok.ts",
        purpose: "works fine",
      }),
    ];

    const stats = computeStats(files);
    expect(stats.parseErrors).toBe(1);
    expect(stats.needsGeneration).toBe(0);
  });

  test("file with null purpose + 2 symbols with null purpose → contributes 3 to needsGeneration", () => {
    const files: FileEntry[] = [
      makeFile({
        path: "a.ts",
        purpose: null,
        symbols: [
          makeSymbol({ name: "x", purpose: null }),
          makeSymbol({ name: "y", purpose: null }),
        ],
      }),
    ];

    const stats = computeStats(files);
    expect(stats.needsGeneration).toBe(3);
  });
});

describe("generate", () => {
  test(
    "against typescript fixtures: creates frame.json, parseable, correct file count, all purposes null",
    async () => {
      // Copy fixture files to isolated temp dir
      const fixtureDir = join(import.meta.dir, "../fixtures/typescript");
      for (const name of ["simple.ts", "complex.ts", "broken.ts"]) {
        const content = await Bun.file(join(fixtureDir, name)).text();
        await writeFile(join(tempDir, name), content);
      }

      const dataPath = join(tempDir, ".frame", "frame.json");
      const frame = await generate({
        root: tempDir,
        dataPath,
        concurrency: 2,
        extraIgnores: [],
      });

      // File created on disk
      expect(existsSync(dataPath)).toBe(true);

      // Parseable from disk
      const loaded = await loadFrame(dataPath);
      expect(loaded.version).toBe("1.0.0");

      // Correct file count — 3 .ts files
      expect(frame.files.length).toBe(3);

      // All purposes null
      for (const file of frame.files) {
        expect(file.purpose).toBeNull();
        for (const sym of file.symbols) {
          expect(sym.purpose).toBeNull();
        }
      }
    },
    30000,
  );
});

describe("loadFrame", () => {
  test("non-existent path → throws FrameNotFoundError", async () => {
    const badPath = join(tempDir, "nonexistent", "frame.json");
    await expect(loadFrame(badPath)).rejects.toThrow(FrameNotFoundError);
  });
});

describe("writePurposes", () => {
  test(
    "patch a file purpose, re-read → purpose updated",
    async () => {
      await writeFile(
        join(tempDir, "hello.ts"),
        'export function hello(): string { return "hi"; }\n',
      );

      const dataPath = join(tempDir, ".frame", "frame.json");
      await generate({
        root: tempDir,
        dataPath,
        concurrency: 1,
        extraIgnores: [],
      });

      const dataDir = join(tempDir, ".frame");
      await writePurposes(dataDir, [
        { path: "hello.ts", purpose: "Says hello" },
      ]);

      const frame = await loadFrame(dataPath);
      const file = frame.files.find((f) => f.path === "hello.ts");
      expect(file?.purpose).toBe("Says hello");
    },
    30000,
  );

  test(
    "patch a symbol purpose by name → symbol purpose updated",
    async () => {
      await writeFile(
        join(tempDir, "greet.ts"),
        "export function greet(name: string): string { return `Hi ${name}`; }\n",
      );

      const dataPath = join(tempDir, ".frame", "frame.json");
      await generate({
        root: tempDir,
        dataPath,
        concurrency: 1,
        extraIgnores: [],
      });

      const dataDir = join(tempDir, ".frame");
      await writePurposes(dataDir, [
        { path: "greet.ts", symbolName: "greet", purpose: "Greets a person" },
      ]);

      const frame = await loadFrame(dataPath);
      const file = frame.files.find((f) => f.path === "greet.ts");
      const sym = file?.symbols.find((s) => s.name === "greet");
      expect(sym?.purpose).toBe("Greets a person");
    },
    30000,
  );
});

describe(".frame/.gitignore", () => {
  test(
    "created with content '*'",
    async () => {
      await writeFile(join(tempDir, "x.ts"), "export const x = 1;\n");

      const dataPath = join(tempDir, ".frame", "frame.json");
      await generate({
        root: tempDir,
        dataPath,
        concurrency: 1,
        extraIgnores: [],
      });

      const gitignorePath = join(tempDir, ".frame", ".gitignore");
      expect(existsSync(gitignorePath)).toBe(true);
      const content = await readFile(gitignorePath, "utf-8");
      expect(content).toBe("*");
    },
    30000,
  );
});
