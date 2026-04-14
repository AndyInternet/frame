import type Parser from "web-tree-sitter";

// --- Symbol Kinds ---
export type CoreSymbolKind =
  | "function"
  | "method"
  | "interface"
  | "type"
  | "constant"
  | "variable";
export type SymbolKind = CoreSymbolKind | (string & {});

// --- Parameter ---
export interface Parameter {
  name: string;
  type: string;
}

// --- Symbol (stored in frame.json) ---
export interface FrameSymbol {
  name: string;
  kind: SymbolKind;
  hash: string;
  exported: boolean;
  purpose: string | null;
  parameters?: Parameter[];
  returns?: string[];
  genericParams?: string[];
  languageFeatures: Record<string, unknown>;
}

// --- File Entry (stored in frame.json) ---
export interface FileEntry {
  path: string;
  language: string;
  pluginVersion: string;
  hash: string;
  purpose: string | null;
  parseError: string | null;
  exports: string[];
  imports: string[];
  externalImports: string[];
  symbols: FrameSymbol[];
}

// --- Frame Root (frame.json top-level) ---
export interface FrameRoot {
  version: string;
  generatedAt: string;
  updatedAt: string;
  projectRoot: string;
  totalFiles: number;
  totalSymbols: number;
  needsGeneration: number;
  parseErrors: number;
  languageComposition: Record<string, number>;
  files: FileEntry[];
}

// --- Plugin Types ---
export interface RawSymbol {
  name: string;
  kind: SymbolKind;
  exported: boolean;
  parameters?: Parameter[];
  returns?: string[];
  genericParams?: string[];
  languageFeatures: Record<string, unknown>;
  /** Serialized AST subtree text for hashing (plugin controls what's included) */
  astText: string;
}

export interface ParsedFile {
  filePath: string;
  symbols: RawSymbol[];
  imports: string[];
  /** Full AST text for file-level hashing (plugin strips comments/whitespace) */
  astText: string;
}

export type ParseResult =
  | { ok: true; parsed: ParsedFile }
  | { ok: false; error: string };

export interface LanguagePlugin {
  id: string;
  version: string;
  fileExtensions: string[];
  symbolKinds: SymbolKind[];
  grammarWasmFile: string;
  parse(
    filePath: string,
    source: string,
    language: Parser.Language,
  ): Promise<ParseResult>;
  hashFile(parsed: ParsedFile): string;
  hashSymbol(symbol: RawSymbol): string;
  classifyImport(
    importPath: string,
    projectRoot: string,
  ): "internal" | "external";
  purposePrompt: { symbol: string; file: string };
}

// --- Worker Messages ---
export interface WorkerRequest {
  filePath: string;
  source: string;
  pluginId: string;
  projectRoot: string;
}

export interface WorkerFileResult {
  fileHash: string;
  symbols: Omit<FrameSymbol, "purpose">[];
  imports: string[];
  externalImports: string[];
  exports: string[];
}

export interface WorkerResponse {
  filePath: string;
  pluginId: string;
  pluginVersion: string;
  result?: WorkerFileResult;
  parseError?: string;
}

// --- Search ---
export interface SearchResult {
  score: number;
  filePath: string;
  filePurpose: string | null;
  symbol?: {
    name: string;
    kind: SymbolKind;
    purpose: string | null;
    exported: boolean;
  };
}

export interface SearchOptions {
  limit: number;
  filesOnly: boolean;
  symbolsOnly: boolean;
  threshold: number;
}

// --- Purpose Patching (for write-purposes command) ---
export interface PurposePatch {
  path: string;
  symbolName?: string;
  purpose: string;
}

// --- Error Types ---
export class FrameNotFoundError extends Error {
  constructor() {
    super("No frame found. Run: frame generate");
    this.name = "FrameNotFoundError";
  }
}
export class FileNotInFrameError extends Error {
  constructor(public path: string) {
    super(
      `File not in frame: ${path}. Check path is relative to project root and file has a supported language extension`,
    );
    this.name = "FileNotInFrameError";
  }
}

// --- Constants ---
export const FRAME_VERSION = "1.0.0";
