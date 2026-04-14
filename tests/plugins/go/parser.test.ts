import { describe, test, expect, beforeAll } from "bun:test";
import {
  initParser,
  loadLanguage,
} from "../../../src/core/wasm-loader.ts";
import {
  parse,
  classifyImport,
} from "../../../src/plugins/go/parser.ts";
import type Parser from "web-tree-sitter";

let language: Parser.Language;

beforeAll(async () => {
  await initParser();
  language = await loadLanguage("tree-sitter-go.wasm");
});

describe("Go parser — simple.go", () => {
  test("extracts correct function count", async () => {
    const source = await Bun.file("tests/fixtures/go/simple.go").text();
    const result = await parse("simple.go", source, language);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Greet, Add, Divide, internalHelper
    expect(result.parsed.symbols).toHaveLength(4);
  });

  test("extracts symbol names and kinds", async () => {
    const source = await Bun.file("tests/fixtures/go/simple.go").text();
    const result = await parse("simple.go", source, language);
    if (!result.ok) throw new Error(result.error);

    const names = result.parsed.symbols.map((s) => s.name);
    expect(names).toContain("Greet");
    expect(names).toContain("Add");
    expect(names).toContain("Divide");
    expect(names).toContain("internalHelper");

    for (const sym of result.parsed.symbols) {
      expect(sym.kind).toBe("function");
    }
  });

  test("detects exported vs unexported", async () => {
    const source = await Bun.file("tests/fixtures/go/simple.go").text();
    const result = await parse("simple.go", source, language);
    if (!result.ok) throw new Error(result.error);

    const byName = Object.fromEntries(
      result.parsed.symbols.map((s) => [s.name, s]),
    );
    expect(byName.Greet.exported).toBe(true);
    expect(byName.Add.exported).toBe(true);
    expect(byName.Divide.exported).toBe(true);
    expect(byName.internalHelper.exported).toBe(false);
  });

  test("detects error return", async () => {
    const source = await Bun.file("tests/fixtures/go/simple.go").text();
    const result = await parse("simple.go", source, language);
    if (!result.ok) throw new Error(result.error);

    const byName = Object.fromEntries(
      result.parsed.symbols.map((s) => [s.name, s]),
    );
    expect(byName.Divide.languageFeatures.errorReturn).toBe(true);
    expect(byName.Greet.languageFeatures.errorReturn).toBe(false);
    expect(byName.Add.languageFeatures.errorReturn).toBe(false);
    expect(byName.internalHelper.languageFeatures.errorReturn).toBe(false);
  });

  test("extracts import paths", async () => {
    const source = await Bun.file("tests/fixtures/go/simple.go").text();
    const result = await parse("simple.go", source, language);
    if (!result.ok) throw new Error(result.error);

    expect(result.parsed.imports).toContain("fmt");
    expect(result.parsed.imports).toContain("errors");
    expect(result.parsed.imports).toHaveLength(2);
  });

  test("extracts parameters", async () => {
    const source = await Bun.file("tests/fixtures/go/simple.go").text();
    const result = await parse("simple.go", source, language);
    if (!result.ok) throw new Error(result.error);

    const byName = Object.fromEntries(
      result.parsed.symbols.map((s) => [s.name, s]),
    );
    expect(byName.Greet.parameters).toEqual([
      { name: "name", type: "string" },
    ]);
    expect(byName.Add.parameters).toEqual([
      { name: "a", type: "int" },
      { name: "b", type: "int" },
    ]);
    expect(byName.Divide.parameters).toEqual([
      { name: "a", type: "float64" },
      { name: "b", type: "float64" },
    ]);
    expect(byName.internalHelper.parameters).toEqual([]);
  });

  test("extracts return types", async () => {
    const source = await Bun.file("tests/fixtures/go/simple.go").text();
    const result = await parse("simple.go", source, language);
    if (!result.ok) throw new Error(result.error);

    const byName = Object.fromEntries(
      result.parsed.symbols.map((s) => [s.name, s]),
    );
    expect(byName.Greet.returns).toEqual(["string"]);
    expect(byName.Add.returns).toEqual(["int"]);
    expect(byName.Divide.returns).toEqual(["float64", "error"]);
    expect(byName.internalHelper.returns).toBeUndefined();
  });
});

describe("Go parser — complex.go", () => {
  test("extracts struct with fields and tags", async () => {
    const source = await Bun.file("tests/fixtures/go/complex.go").text();
    const result = await parse("complex.go", source, language);
    if (!result.ok) throw new Error(result.error);

    const userStruct = result.parsed.symbols.find(
      (s) => s.kind === "struct" && s.name === "User",
    );
    expect(userStruct).toBeDefined();
    expect(userStruct!.exported).toBe(true);

    const fields = userStruct!.languageFeatures.fields as Array<{
      name: string;
      type: string;
      exported: boolean;
      tags: Record<string, string>;
    }>;
    expect(fields).toHaveLength(4);

    expect(fields[0]).toEqual({
      name: "ID",
      type: "int64",
      exported: true,
      tags: { json: "id", db: "id" },
    });
    expect(fields[1]).toEqual({
      name: "Name",
      type: "string",
      exported: true,
      tags: { json: "name", db: "name" },
    });
    expect(fields[2]).toEqual({
      name: "Email",
      type: "string",
      exported: true,
      tags: { json: "email", db: "email" },
    });
    expect(fields[3]).toEqual({
      name: "IsActive",
      type: "bool",
      exported: true,
      tags: { json: "is_active", db: "is_active" },
    });
  });

  test("extracts method receiver type and pointer flag", async () => {
    const source = await Bun.file("tests/fixtures/go/complex.go").text();
    const result = await parse("complex.go", source, language);
    if (!result.ok) throw new Error(result.error);

    const methods = result.parsed.symbols.filter((s) => s.kind === "method");
    expect(methods.length).toBeGreaterThanOrEqual(2);

    const serialize = methods.find((m) => m.name === "Serialize");
    expect(serialize).toBeDefined();
    expect(serialize!.languageFeatures.receiver).toEqual({
      type: "User",
      pointer: true,
    });
    expect(serialize!.exported).toBe(true);

    const validate = methods.find((m) => m.name === "Validate");
    expect(validate).toBeDefined();
    expect(validate!.languageFeatures.receiver).toEqual({
      type: "User",
      pointer: true,
    });
  });

  test("extracts interface members", async () => {
    const source = await Bun.file("tests/fixtures/go/complex.go").text();
    const result = await parse("complex.go", source, language);
    if (!result.ok) throw new Error(result.error);

    const serializer = result.parsed.symbols.find(
      (s) => s.kind === "interface" && s.name === "Serializer",
    );
    expect(serializer).toBeDefined();
    expect(serializer!.exported).toBe(true);
    expect(serializer!.languageFeatures.structural).toBe(true);

    const members = serializer!.languageFeatures.members as Array<{
      name: string;
      type: string;
    }>;
    expect(members).toHaveLength(2);
    expect(members[0].name).toBe("Serialize");
    expect(members[1].name).toBe("Deserialize");
  });

  test("extracts iota const block as enum", async () => {
    const source = await Bun.file("tests/fixtures/go/complex.go").text();
    const result = await parse("complex.go", source, language);
    if (!result.ok) throw new Error(result.error);

    const enumSym = result.parsed.symbols.find((s) => s.kind === "enum");
    expect(enumSym).toBeDefined();
    expect(enumSym!.name).toBe("Color");
    expect(enumSym!.exported).toBe(true);

    const features = enumSym!.languageFeatures;
    expect(features.kind).toBe("iota");
    expect(features.iotaBlock).toBe("Color");

    const members = features.members as Array<{ name: string }>;
    expect(members).toHaveLength(4);
    expect(members.map((m) => m.name)).toEqual([
      "Red",
      "Green",
      "Blue",
      "Yellow",
    ]);
  });

  test("extracts function with pointer return", async () => {
    const source = await Bun.file("tests/fixtures/go/complex.go").text();
    const result = await parse("complex.go", source, language);
    if (!result.ok) throw new Error(result.error);

    const newUser = result.parsed.symbols.find(
      (s) => s.name === "NewUser",
    );
    expect(newUser).toBeDefined();
    expect(newUser!.kind).toBe("function");
    expect(newUser!.exported).toBe(true);
    expect(newUser!.returns).toEqual(["*User"]);
  });
});

describe("Go parser — broken.go", () => {
  test("returns parse error", async () => {
    const source = await Bun.file("tests/fixtures/go/broken.go").text();
    const result = await parse("broken.go", source, language);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeGreaterThan(0);
  });
});

describe("Go import classification", () => {
  const projectRoot = "tests/fixtures/go";

  test("module-prefixed path is internal", () => {
    expect(
      classifyImport("example.com/testproject/pkg/utils", projectRoot),
    ).toBe("internal");
  });

  test("module path exact match is internal", () => {
    expect(
      classifyImport("example.com/testproject", projectRoot),
    ).toBe("internal");
  });

  test("stdlib import is external", () => {
    expect(classifyImport("fmt", projectRoot)).toBe("external");
    expect(classifyImport("errors", projectRoot)).toBe("external");
    expect(classifyImport("net/http", projectRoot)).toBe("external");
  });

  test("third-party import is external", () => {
    expect(
      classifyImport("github.com/other/lib", projectRoot),
    ).toBe("external");
  });

  test("missing go.mod treats all as external", () => {
    expect(classifyImport("example.com/testproject/pkg", "/nonexistent")).toBe(
      "external",
    );
  });
});

describe("Go parser — edge cases", () => {
  test("init function is unexported", async () => {
    const source = `package main\n\nfunc init() {\n\tprintln("init")\n}\n`;
    const result = await parse("init.go", source, language);
    if (!result.ok) throw new Error(result.error);

    expect(result.parsed.symbols).toHaveLength(1);
    expect(result.parsed.symbols[0].name).toBe("init");
    expect(result.parsed.symbols[0].exported).toBe(false);
    expect(result.parsed.symbols[0].languageFeatures.initFunc).toBe(true);
  });

  test("value receiver vs pointer receiver", async () => {
    const source = [
      "package main",
      "",
      "type Foo struct{}",
      "",
      "func (f Foo) Value() {}",
      "func (f *Foo) Pointer() {}",
    ].join("\n");
    const result = await parse("receivers.go", source, language);
    if (!result.ok) throw new Error(result.error);

    const methods = result.parsed.symbols.filter((s) => s.kind === "method");
    expect(methods).toHaveLength(2);

    const valueMeth = methods.find((m) => m.name === "Value")!;
    expect(valueMeth.languageFeatures.receiver).toEqual({
      type: "Foo",
      pointer: false,
    });

    const ptrMeth = methods.find((m) => m.name === "Pointer")!;
    expect(ptrMeth.languageFeatures.receiver).toEqual({
      type: "Foo",
      pointer: true,
    });
  });

  test("file with only imports produces empty symbols", async () => {
    const source = `package main\n\nimport "fmt"\n`;
    const result = await parse("imports-only.go", source, language);
    if (!result.ok) throw new Error(result.error);
    expect(result.parsed.symbols).toHaveLength(0);
    expect(result.parsed.imports).toEqual(["fmt"]);
  });
});
