import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { acquireLock } from "./lock.ts";
import { getPluginForFile } from "./registry.ts";
import {
  FRAME_VERSION,
  type FileEntry,
  FrameNotFoundError,
  type FrameRoot,
  type PurposePatch,
  type WorkerResponse,
} from "./schema.ts";
import { walkProject } from "./walker.ts";
import { processFiles } from "./workers.ts";

export interface FrameOptions {
  root: string;
  dataPath: string;
  concurrency: number;
  extraIgnores: string[];
}

export function computeStats(
  files: FileEntry[],
): Pick<
  FrameRoot,
  | "totalFiles"
  | "totalSymbols"
  | "needsGeneration"
  | "parseErrors"
  | "languageComposition"
> {
  let totalSymbols = 0;
  let needsGeneration = 0;
  let parseErrors = 0;
  const languageComposition: Record<string, number> = {};

  for (const file of files) {
    totalSymbols += file.symbols.length;
    languageComposition[file.language] =
      (languageComposition[file.language] ?? 0) + 1;

    if (file.parseError !== null) {
      parseErrors++;
      continue;
    }

    if (file.purpose === null) {
      needsGeneration++;
    }
    for (const sym of file.symbols) {
      if (sym.purpose === null) {
        needsGeneration++;
      }
    }
  }

  return {
    totalFiles: files.length,
    totalSymbols,
    needsGeneration,
    parseErrors,
    languageComposition,
  };
}

export async function loadFrame(dataPath: string): Promise<FrameRoot> {
  const file = Bun.file(dataPath);
  if (!(await file.exists())) {
    throw new FrameNotFoundError();
  }
  return JSON.parse(await file.text()) as FrameRoot;
}

function buildFileEntry(resp: WorkerResponse): FileEntry {
  if (resp.parseError || !resp.result) {
    return {
      path: resp.filePath,
      language: resp.pluginId,
      pluginVersion: resp.pluginVersion,
      hash: "",
      purpose: null,
      parseError: resp.parseError ?? "Unknown error",
      exports: [],
      imports: [],
      externalImports: [],
      symbols: [],
    };
  }

  const r = resp.result;
  return {
    path: resp.filePath,
    language: resp.pluginId,
    pluginVersion: resp.pluginVersion,
    hash: r.fileHash,
    purpose: null,
    parseError: null,
    exports: r.exports,
    imports: r.imports,
    externalImports: r.externalImports,
    symbols: r.symbols.map((s) => ({ ...s, purpose: null })),
  };
}

function ensureFrameDir(dataPath: string): void {
  const dir = dirname(dataPath);
  mkdirSync(dir, { recursive: true });
  const gitignorePath = join(dir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, "*");
  }
}

function atomicWrite(dataPath: string, data: FrameRoot): void {
  const tmpPath = `${dataPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, dataPath);
}

export async function generate(opts: FrameOptions): Promise<FrameRoot> {
  const allPaths = await walkProject({
    root: opts.root,
    extraIgnores: opts.extraIgnores,
  });

  const supported = allPaths.filter((p) => getPluginForFile(p) !== null);

  const fileInputs: Array<{ path: string; source: string; pluginId: string }> =
    [];
  for (const relPath of supported) {
    const source = await Bun.file(join(opts.root, relPath)).text();
    const plugin = getPluginForFile(relPath);
    if (!plugin) continue;
    fileInputs.push({ path: relPath, source, pluginId: plugin.id });
  }

  const responses = await processFiles(fileInputs, {
    concurrency: opts.concurrency,
    projectRoot: opts.root,
    onProgress: () => {},
    onError: () => {},
  });

  const files = responses.map(buildFileEntry);
  const now = new Date().toISOString();
  const stats = computeStats(files);

  const frame: FrameRoot = {
    version: FRAME_VERSION,
    generatedAt: now,
    updatedAt: now,
    projectRoot: opts.root,
    ...stats,
    files,
  };

  ensureFrameDir(opts.dataPath);
  atomicWrite(opts.dataPath, frame);

  return frame;
}

export async function update(opts: FrameOptions): Promise<FrameRoot> {
  const existing = await loadFrame(opts.dataPath);

  const allPaths = await walkProject({
    root: opts.root,
    extraIgnores: opts.extraIgnores,
  });
  const supported = allPaths.filter((p) => getPluginForFile(p) !== null);

  const existingMap = new Map<string, FileEntry>();
  for (const f of existing.files) {
    existingMap.set(f.path, f);
  }

  const fileInputs: Array<{ path: string; source: string; pluginId: string }> =
    [];
  for (const relPath of supported) {
    const source = await Bun.file(join(opts.root, relPath)).text();
    const plugin = getPluginForFile(relPath);
    if (!plugin) continue;
    fileInputs.push({ path: relPath, source, pluginId: plugin.id });
  }

  const responses = await processFiles(fileInputs, {
    concurrency: opts.concurrency,
    projectRoot: opts.root,
    onProgress: () => {},
    onError: () => {},
  });

  const files: FileEntry[] = responses.map((resp) => {
    const newEntry = buildFileEntry(resp);
    const oldEntry = existingMap.get(resp.filePath);

    if (!oldEntry) return newEntry;
    if (oldEntry.pluginVersion !== newEntry.pluginVersion) return newEntry;
    if (oldEntry.hash !== newEntry.hash) return newEntry;

    // Same hash + same plugin version → preserve all purposes
    newEntry.purpose = oldEntry.purpose;
    for (const sym of newEntry.symbols) {
      const oldSym = oldEntry.symbols.find((s) => s.name === sym.name);
      if (oldSym) {
        sym.purpose = oldSym.purpose;
      }
    }
    return newEntry;
  });

  const stats = computeStats(files);
  const now = new Date().toISOString();

  const frame: FrameRoot = {
    version: FRAME_VERSION,
    generatedAt: existing.generatedAt,
    updatedAt: now,
    projectRoot: opts.root,
    ...stats,
    files,
  };

  ensureFrameDir(opts.dataPath);
  atomicWrite(opts.dataPath, frame);

  return frame;
}

export async function writePurposes(
  dataDir: string,
  patches: PurposePatch[],
): Promise<void> {
  const lock = await acquireLock(dataDir);
  try {
    const dataPath = join(dataDir, "frame.json");
    const frame = await loadFrame(dataPath);

    for (const patch of patches) {
      const file = frame.files.find((f) => f.path === patch.path);
      if (!file) continue;

      if (patch.symbolName) {
        const sym = file.symbols.find((s) => s.name === patch.symbolName);
        if (!sym) continue;
        sym.purpose = patch.purpose;
      } else {
        file.purpose = patch.purpose;
      }
    }

    const stats = computeStats(frame.files);
    frame.needsGeneration = stats.needsGeneration;

    atomicWrite(dataPath, frame);
  } finally {
    await lock.release();
  }
}
