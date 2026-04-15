import { rawHash } from "./hash.ts";
import { getPluginById } from "./registry.ts";
import type { WorkerRequest, WorkerResponse } from "./schema.ts";
import { getParser, initParser } from "./wasm-loader.ts";

/**
 * Worker subprocess entry. Activated from cli.ts when __FRAME_WORKER=1.
 *
 * We use child-process IPC (Bun.spawn + process.send/on("message")) instead
 * of Web Workers because `bun build --compile` doesn't bundle worker scripts
 * referenced via `new URL(..., import.meta.url)` — the subprocess is the
 * same compiled binary, re-entered in worker mode.
 */
export async function runWorker(): Promise<void> {
  process.on("message", async (req: WorkerRequest) => {
    const resp = await handleRequest(req);
    process.send!(resp);
  });

  // Keep the event loop alive even before the first message arrives.
  process.stdin.resume();
}

// Allow this file to be run directly as a subprocess in dev mode
// (`bun src/core/worker-entry.ts`). In compiled mode, cli.ts handles
// the worker dispatch via the __FRAME_WORKER env var instead.
if (import.meta.main) {
  await runWorker();
}

async function handleRequest(req: WorkerRequest): Promise<WorkerResponse> {
  const plugin = getPluginById(req.pluginId);
  if (!plugin) {
    return {
      filePath: req.filePath,
      pluginId: req.pluginId,
      pluginVersion: "unknown",
      parseError: `Unknown plugin: ${req.pluginId}`,
      rawHash: rawHash(req.source),
    };
  }

  await initParser();
  const parser = await getParser(plugin.grammarWasmFile);
  const result = await plugin.parse(req.filePath, req.source, parser);

  if (!result.ok) {
    return {
      filePath: req.filePath,
      pluginId: req.pluginId,
      pluginVersion: plugin.version,
      parseError: result.error,
      rawHash: rawHash(req.source),
    };
  }

  const parsed = result.parsed;
  const symbols = parsed.symbols.map((sym) => ({
    name: sym.name,
    kind: sym.kind,
    hash: plugin.hashSymbol(sym),
    exported: sym.exported,
    parameters: sym.parameters,
    returns: sym.returns,
    genericParams: sym.genericParams,
    languageFeatures: sym.languageFeatures,
  }));
  const imports = parsed.imports.filter(
    (i) => plugin.classifyImport(i, req.projectRoot) === "internal",
  );
  const externalImports = parsed.imports.filter(
    (i) => plugin.classifyImport(i, req.projectRoot) === "external",
  );
  const exports = symbols.filter((s) => s.exported).map((s) => s.name);

  return {
    filePath: req.filePath,
    pluginId: req.pluginId,
    pluginVersion: plugin.version,
    result: {
      fileHash: plugin.hashFile(parsed),
      symbols,
      imports,
      externalImports,
      exports,
    },
  };
}
