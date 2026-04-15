import Parser from "web-tree-sitter";

// Static imports for bun build --compile embedding
import goGrammar from "../../grammars/tree-sitter-go.wasm" with {
  type: "file",
};
import tsGrammar from "../../grammars/tree-sitter-typescript.wasm" with {
  type: "file",
};
import treeSitterWasm from "../../grammars/tree-sitter.wasm" with {
  type: "file",
};

const grammarRegistry: Record<string, string> = {
  "tree-sitter-typescript.wasm": tsGrammar,
  "tree-sitter-go.wasm": goGrammar,
};

let initialized = false;

/** Call once per process/worker. Loads web-tree-sitter WASM runtime. */
export async function initParser(): Promise<void> {
  if (initialized) return;
  const wasmBinary = await Bun.file(treeSitterWasm).arrayBuffer();
  await Parser.init({ wasmBinary });
  initialized = true;
}

const languageCache = new Map<string, Parser.Language>();

/** Load a grammar by filename key (e.g. "tree-sitter-typescript.wasm") */
export async function loadLanguage(
  grammarWasmFile: string,
): Promise<Parser.Language> {
  const cached = languageCache.get(grammarWasmFile);
  if (cached) return cached;
  const embedded = grammarRegistry[grammarWasmFile];
  if (!embedded) {
    throw new Error(`Unknown grammar: ${grammarWasmFile}`);
  }
  const lang = await Parser.Language.load(embedded);
  languageCache.set(grammarWasmFile, lang);
  return lang;
}

// One Parser instance per grammar, reused across every parse in this process.
// Allocating `new Parser()` per file leaks a WASM function-table entry each
// time; the table overflows after ~3,700 parses, causing the runtime to trap
// with "Out of bounds call_indirect". Reusing a long-lived Parser avoids this.
const parserCache = new Map<string, Parser>();

/** Get a Parser pre-configured for the given grammar. Owned by the module. */
export async function getParser(grammarWasmFile: string): Promise<Parser> {
  const cached = parserCache.get(grammarWasmFile);
  if (cached) return cached;
  const lang = await loadLanguage(grammarWasmFile);
  const parser = new Parser();
  parser.setLanguage(lang);
  parserCache.set(grammarWasmFile, parser);
  return parser;
}
