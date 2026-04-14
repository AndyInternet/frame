import type Parser from "web-tree-sitter";
import type {
  LanguagePlugin,
  ParsedFile,
  RawSymbol,
} from "../../core/schema.ts";
import {
  hashFile as computeFileHash,
  hashSymbol as computeSymbolHash,
} from "./hashing.ts";
import { parse as parseFile } from "./parser.ts";
import { purposePrompt } from "./prompts.ts";

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
    filePath: string,
    source: string,
    language: Parser.Language,
  ): Promise<import("../../core/schema.ts").ParseResult> {
    return parseFile(filePath, source, language);
  },

  hashFile(parsed: ParsedFile): string {
    return computeFileHash(parsed);
  },

  hashSymbol(symbol: RawSymbol): string {
    return computeSymbolHash(symbol);
  },

  classifyImport(
    importPath: string,
    _projectRoot: string,
  ): "internal" | "external" {
    if (
      importPath.startsWith(".") ||
      importPath.startsWith("/") ||
      importPath.startsWith("@/")
    ) {
      return "internal";
    }
    return "external";
  },

  purposePrompt,
};
