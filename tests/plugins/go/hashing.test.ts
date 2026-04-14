import { describe, test, expect, beforeAll } from "bun:test";
import {
  initParser,
  loadLanguage,
} from "../../../src/core/wasm-loader.ts";
import { parse } from "../../../src/plugins/go/parser.ts";
import {
  hashFile,
  hashSymbol,
} from "../../../src/plugins/go/hashing.ts";
import type Parser from "web-tree-sitter";

let language: Parser.Language;

beforeAll(async () => {
  await initParser();
  language = await loadLanguage("tree-sitter-go.wasm");
});

describe("Go hashing", () => {
  test("same source produces same hash (deterministic)", async () => {
    const source = "package main\n\nfunc Foo() int { return 1 }\n";
    const r1 = await parse("test.go", source, language);
    const r2 = await parse("test.go", source, language);
    if (!r1.ok || !r2.ok) throw new Error("parse failed");

    expect(hashFile(r1.parsed)).toBe(hashFile(r2.parsed));
    expect(hashSymbol(r1.parsed.symbols[0])).toBe(
      hashSymbol(r2.parsed.symbols[0]),
    );
  });

  test("adding comment does not change hash", async () => {
    const source1 = "package main\n\nfunc Foo() int { return 1 }\n";
    const source2 =
      "package main\n\n// top comment\nfunc Foo() int { return 1 }\n";
    const r1 = await parse("test.go", source1, language);
    const r2 = await parse("test.go", source2, language);
    if (!r1.ok || !r2.ok) throw new Error("parse failed");

    expect(hashFile(r1.parsed)).toBe(hashFile(r2.parsed));
    expect(hashSymbol(r1.parsed.symbols[0])).toBe(
      hashSymbol(r2.parsed.symbols[0]),
    );
  });

  test("inline comment inside function does not change hash", async () => {
    const source1 = "package main\n\nfunc Foo() int { return 1 }\n";
    const source2 =
      "package main\n\nfunc Foo() int { /* comment */ return 1 }\n";
    const r1 = await parse("test.go", source1, language);
    const r2 = await parse("test.go", source2, language);
    if (!r1.ok || !r2.ok) throw new Error("parse failed");

    expect(hashSymbol(r1.parsed.symbols[0])).toBe(
      hashSymbol(r2.parsed.symbols[0]),
    );
  });

  test("changing function body produces different hash", async () => {
    const source1 = "package main\n\nfunc Foo() int { return 1 }\n";
    const source2 = "package main\n\nfunc Foo() int { return 2 }\n";
    const r1 = await parse("test.go", source1, language);
    const r2 = await parse("test.go", source2, language);
    if (!r1.ok || !r2.ok) throw new Error("parse failed");

    expect(hashFile(r1.parsed)).not.toBe(hashFile(r2.parsed));
    expect(hashSymbol(r1.parsed.symbols[0])).not.toBe(
      hashSymbol(r2.parsed.symbols[0]),
    );
  });

  test("symbol hash is non-empty base62 string", async () => {
    const source = "package main\n\nfunc Foo() int { return 1 }\n";
    const r = await parse("test.go", source, language);
    if (!r.ok) throw new Error("parse failed");

    const hash = hashSymbol(r.parsed.symbols[0]);
    expect(hash.length).toBeGreaterThan(0);
    expect(hash).toMatch(/^[0-9A-Za-z]+$/);
  });

  test("file hash is non-empty base62 string", async () => {
    const source = await Bun.file("tests/fixtures/go/simple.go").text();
    const r = await parse("simple.go", source, language);
    if (!r.ok) throw new Error("parse failed");

    const hash = hashFile(r.parsed);
    expect(hash.length).toBeGreaterThan(0);
    expect(hash).toMatch(/^[0-9A-Za-z]+$/);
  });
});
