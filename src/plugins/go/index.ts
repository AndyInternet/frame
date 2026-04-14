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
import {
  classifyImport as classifyGoImport,
  parse as parseFile,
} from "./parser.ts";
import { purposePrompt } from "./prompts.ts";

export const goPlugin: LanguagePlugin = {
  id: "go",
  version: "0.1.0",
  fileExtensions: [".go"],
  grammarWasmFile: "tree-sitter-go.wasm",
  symbolKinds: [
    "function",
    "method",
    "struct",
    "interface",
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
    projectRoot: string,
  ): "internal" | "external" {
    return classifyGoImport(importPath, projectRoot);
  },

  purposePrompt,
};
