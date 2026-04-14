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

/** Load a grammar by filename key (e.g. "tree-sitter-typescript.wasm") */
export async function loadLanguage(
  grammarWasmFile: string,
): Promise<Parser.Language> {
  const embedded = grammarRegistry[grammarWasmFile];
  if (!embedded) {
    throw new Error(`Unknown grammar: ${grammarWasmFile}`);
  }
  return Parser.Language.load(embedded);
}
