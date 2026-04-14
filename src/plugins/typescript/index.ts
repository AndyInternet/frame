import type Parser from "web-tree-sitter";
import type {
  LanguagePlugin,
  ParseResult,
  ParsedFile,
  RawSymbol,
} from "../../core/schema.ts";

export const typescriptPlugin: LanguagePlugin = {
  id: "typescript",
  version: "0.1.0",
  fileExtensions: [".ts", ".tsx"],
  grammarWasmFile: "tree-sitter-typescript.wasm",
  symbolKinds: [
    "function",
    "method",
    "class",
    "interface",
    "type",
    "enum",
    "constant",
    "variable",
  ],

  parse(
    _filePath: string,
    _source: string,
    _language: Parser.Language,
  ): Promise<ParseResult> {
    throw new Error("not implemented");
  },

  hashFile(_parsed: ParsedFile): string {
    throw new Error("not implemented");
  },

  hashSymbol(_symbol: RawSymbol): string {
    throw new Error("not implemented");
  },

  classifyImport(
    _importPath: string,
    _projectRoot: string,
  ): "internal" | "external" {
    throw new Error("not implemented");
  },

  purposePrompt: {
    symbol: "not implemented",
    file: "not implemented",
  },
};
