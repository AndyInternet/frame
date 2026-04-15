import { describe, test, expect, beforeAll } from "bun:test";
import {
  initParser,
  getParser,
} from "../../../src/core/wasm-loader.ts";
import { parse } from "../../../src/plugins/typescript/parser.ts";
import { typescriptPlugin } from "../../../src/plugins/typescript/index.ts";
import type Parser from "web-tree-sitter";

let parser: Parser;

beforeAll(async () => {
  await initParser();
  parser = await getParser("tree-sitter-typescript.wasm");
});

describe("TypeScript parser — simple.ts", () => {
  test("extracts correct symbol count", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/simple.ts",
    ).text();
    const result = await parse("simple.ts", source, parser);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // MAX_RETRIES, greet, add, internalHelper
    expect(result.parsed.symbols).toHaveLength(4);
  });

  test("extracts symbol names and kinds", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/simple.ts",
    ).text();
    const result = await parse("simple.ts", source, parser);
    if (!result.ok) throw new Error(result.error);

    const names = result.parsed.symbols.map((s) => s.name);
    expect(names).toContain("MAX_RETRIES");
    expect(names).toContain("greet");
    expect(names).toContain("add");
    expect(names).toContain("internalHelper");

    const byName = Object.fromEntries(
      result.parsed.symbols.map((s) => [s.name, s]),
    );
    expect(byName.MAX_RETRIES.kind).toBe("constant");
    expect(byName.greet.kind).toBe("function");
    expect(byName.add.kind).toBe("function");
    expect(byName.internalHelper.kind).toBe("function");
  });

  test("detects exported flags", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/simple.ts",
    ).text();
    const result = await parse("simple.ts", source, parser);
    if (!result.ok) throw new Error(result.error);

    const byName = Object.fromEntries(
      result.parsed.symbols.map((s) => [s.name, s]),
    );
    expect(byName.MAX_RETRIES.exported).toBe(true);
    expect(byName.greet.exported).toBe(true);
    expect(byName.add.exported).toBe(true);
    expect(byName.internalHelper.exported).toBe(false);
  });

  test("extracts parameter types", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/simple.ts",
    ).text();
    const result = await parse("simple.ts", source, parser);
    if (!result.ok) throw new Error(result.error);

    const byName = Object.fromEntries(
      result.parsed.symbols.map((s) => [s.name, s]),
    );

    expect(byName.greet.parameters).toEqual([
      { name: "name", type: "string" },
    ]);
    expect(byName.add.parameters).toEqual([
      { name: "a", type: "number" },
      { name: "b", type: "number" },
    ]);
    expect(byName.internalHelper.parameters).toEqual([]);
  });

  test("extracts return types", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/simple.ts",
    ).text();
    const result = await parse("simple.ts", source, parser);
    if (!result.ok) throw new Error(result.error);

    const byName = Object.fromEntries(
      result.parsed.symbols.map((s) => [s.name, s]),
    );
    expect(byName.greet.returns).toEqual(["string"]);
    expect(byName.add.returns).toEqual(["number"]);
    expect(byName.internalHelper.returns).toEqual(["void"]);
  });

  test("extracts import paths", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/simple.ts",
    ).text();
    const result = await parse("simple.ts", source, parser);
    if (!result.ok) throw new Error(result.error);

    expect(result.parsed.imports).toEqual(["./utils", "node:fs"]);
  });

  test("classifies imports correctly", () => {
    const plugin = typescriptPlugin;
    expect(plugin.classifyImport("./utils", "/project")).toBe("internal");
    expect(plugin.classifyImport("../shared", "/project")).toBe("internal");
    expect(plugin.classifyImport("node:fs", "/project")).toBe("external");
    expect(plugin.classifyImport("react", "/project")).toBe("external");
    expect(plugin.classifyImport("@angular/core", "/project")).toBe(
      "external",
    );
    expect(plugin.classifyImport("@/components", "/project")).toBe(
      "internal",
    );
  });

  test("constant has declaration kind and value", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/simple.ts",
    ).text();
    const result = await parse("simple.ts", source, parser);
    if (!result.ok) throw new Error(result.error);

    const maxRetries = result.parsed.symbols.find(
      (s) => s.name === "MAX_RETRIES",
    )!;
    expect(maxRetries.languageFeatures.declarationKind).toBe("const");
    expect(maxRetries.languageFeatures.value).toBe("3");
  });
});

describe("TypeScript parser — complex.ts", () => {
  test("extracts class with methods, properties, constructor", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/complex.ts",
    ).text();
    const result = await parse("complex.ts", source, parser);
    if (!result.ok) throw new Error(result.error);

    const classSym = result.parsed.symbols.find(
      (s) => s.kind === "class" && s.name === "Repository",
    );
    expect(classSym).toBeDefined();
    expect(classSym!.exported).toBe(true);

    const features = classSym!.languageFeatures as Record<string, unknown>;
    expect(features.methods).toEqual([
      "constructor",
      "get",
      "set",
      "clear",
    ]);

    const props = features.properties as Array<{
      name: string;
      type: string;
      visibility: string;
    }>;
    expect(props).toHaveLength(2);
    expect(props[0]).toEqual({
      name: "items",
      type: "Map<string, T>",
      visibility: "private",
    });
    expect(props[1]).toEqual({
      name: "name",
      type: "string",
      visibility: "public",
    });

    const ctorFeature = features.constructor as {
      parameters: Array<{ name: string; type: string }>;
    };
    expect(ctorFeature.parameters).toEqual([
      { name: "name", type: "string" },
    ]);
  });

  test("extracts methods as separate symbols", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/complex.ts",
    ).text();
    const result = await parse("complex.ts", source, parser);
    if (!result.ok) throw new Error(result.error);

    const methods = result.parsed.symbols.filter(
      (s) => s.kind === "method",
    );
    const methodNames = methods.map((m) => m.name);
    expect(methodNames).toContain("constructor");
    expect(methodNames).toContain("get");
    expect(methodNames).toContain("set");
    expect(methodNames).toContain("clear");

    // Methods reference parent class
    for (const m of methods) {
      expect(m.languageFeatures.class).toBe("Repository");
      expect(m.exported).toBe(false);
    }
  });

  test("extracts interface with members", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/complex.ts",
    ).text();
    const result = await parse("complex.ts", source, parser);
    if (!result.ok) throw new Error(result.error);

    const iface = result.parsed.symbols.find(
      (s) => s.kind === "interface" && s.name === "Serializable",
    );
    expect(iface).toBeDefined();
    expect(iface!.exported).toBe(true);

    const features = iface!.languageFeatures as Record<string, unknown>;
    expect(features.structural).toBe(false);
    const members = features.members as Array<{
      name: string;
      type: string;
    }>;
    expect(members).toHaveLength(2);
    expect(members[0].name).toBe("serialize");
    expect(members[1].name).toBe("deserialize");
  });

  test("extracts type alias with definition and generic params", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/complex.ts",
    ).text();
    const result = await parse("complex.ts", source, parser);
    if (!result.ok) throw new Error(result.error);

    const typeSym = result.parsed.symbols.find(
      (s) => s.kind === "type" && s.name === "Result",
    );
    expect(typeSym).toBeDefined();
    expect(typeSym!.exported).toBe(true);
    expect(typeSym!.genericParams).toEqual(["T", "E = Error"]);

    const features = typeSym!.languageFeatures as Record<string, unknown>;
    expect(features.definition).toContain("ok: true");
    expect(features.definition).toContain("ok: false");
  });

  test("extracts enum with members", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/complex.ts",
    ).text();
    const result = await parse("complex.ts", source, parser);
    if (!result.ok) throw new Error(result.error);

    const enumSym = result.parsed.symbols.find(
      (s) => s.kind === "enum" && s.name === "Status",
    );
    expect(enumSym).toBeDefined();
    expect(enumSym!.exported).toBe(true);

    const features = enumSym!.languageFeatures as Record<string, unknown>;
    const members = features.members as Array<{
      name: string;
      value?: string;
    }>;
    expect(members).toHaveLength(3);
    expect(members[0]).toEqual({ name: "Active", value: "active" });
    expect(members[1]).toEqual({ name: "Inactive", value: "inactive" });
    expect(members[2]).toEqual({ name: "Pending", value: "pending" });
  });

  test("detects async functions", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/complex.ts",
    ).text();
    const result = await parse("complex.ts", source, parser);
    if (!result.ok) throw new Error(result.error);

    const fetchData = result.parsed.symbols.find(
      (s) => s.name === "fetchData",
    );
    expect(fetchData).toBeDefined();
    expect(fetchData!.languageFeatures.async).toBe(true);
    expect(fetchData!.kind).toBe("function");
  });

  test("extracts generic params on class and function", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/complex.ts",
    ).text();
    const result = await parse("complex.ts", source, parser);
    if (!result.ok) throw new Error(result.error);

    const repo = result.parsed.symbols.find(
      (s) => s.name === "Repository",
    );
    expect(repo!.genericParams).toEqual(["T extends Serializable"]);

    const fetchData = result.parsed.symbols.find(
      (s) => s.name === "fetchData",
    );
    expect(fetchData!.genericParams).toEqual(["T"]);
  });
});

describe("TypeScript parser — broken.ts", () => {
  test("returns parse error", async () => {
    const source = await Bun.file(
      "tests/fixtures/typescript/broken.ts",
    ).text();
    const result = await parse("broken.ts", source, parser);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeGreaterThan(0);
  });
});

describe("TypeScript parser — edge cases", () => {
  test("file with only imports produces empty symbols", async () => {
    const source = `import { foo } from "./bar";\nimport React from "react";`;
    const result = await parse("imports-only.ts", source, parser);
    if (!result.ok) throw new Error(result.error);
    expect(result.parsed.symbols).toHaveLength(0);
    expect(result.parsed.imports).toEqual(["./bar", "react"]);
  });

  test("arrow function in const is kind function", async () => {
    const source = `export const greet = (name: string): string => \`Hello, \${name}\`;`;
    const result = await parse("arrow.ts", source, parser);
    if (!result.ok) throw new Error(result.error);
    expect(result.parsed.symbols).toHaveLength(1);
    expect(result.parsed.symbols[0].kind).toBe("function");
    expect(result.parsed.symbols[0].name).toBe("greet");
    expect(result.parsed.symbols[0].exported).toBe(true);
  });

  test("export default function gets name or default", async () => {
    const source = `export default function handler() { return 1; }`;
    const result = await parse("default.ts", source, parser);
    if (!result.ok) throw new Error(result.error);
    expect(result.parsed.symbols).toHaveLength(1);
    expect(result.parsed.symbols[0].exported).toBe(true);
    expect(result.parsed.symbols[0].name).toBe("handler");
  });

  test("re-exports tracked as imports not symbols", async () => {
    const source = `export { foo } from './bar';`;
    const result = await parse("reexport.ts", source, parser);
    if (!result.ok) throw new Error(result.error);
    expect(result.parsed.symbols).toHaveLength(0);
    expect(result.parsed.imports).toContain("./bar");
  });
});
