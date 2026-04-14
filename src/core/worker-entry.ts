import { getPluginById } from "./registry.ts";
import type { WorkerRequest, WorkerResponse } from "./schema.ts";
import { initParser, loadLanguage } from "./wasm-loader.ts";

declare const self: Worker;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  const plugin = getPluginById(req.pluginId);
  if (!plugin) {
    self.postMessage({
      filePath: req.filePath,
      pluginId: req.pluginId,
      pluginVersion: "unknown",
      parseError: `Unknown plugin: ${req.pluginId}`,
    } satisfies WorkerResponse);
    return;
  }

  await initParser();
  const lang = await loadLanguage(plugin.grammarWasmFile);
  const result = await plugin.parse(req.filePath, req.source, lang);

  if (!result.ok) {
    self.postMessage({
      filePath: req.filePath,
      pluginId: req.pluginId,
      pluginVersion: plugin.version,
      parseError: result.error,
    } satisfies WorkerResponse);
    return;
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

  self.postMessage({
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
  } satisfies WorkerResponse);
};
