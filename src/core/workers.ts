import { rawHash } from "./hash.ts";
import { getPluginById } from "./registry.ts";
import type { WorkerRequest, WorkerResponse } from "./schema.ts";
import { initParser, loadLanguage } from "./wasm-loader.ts";

export interface PoolOptions {
  concurrency: number;
  projectRoot: string;
  onProgress: (current: number, total: number, filePath: string) => void;
  onError: (filePath: string, error: string) => void;
}

/** Process a single file in the main thread (same logic as worker-entry.ts) */
async function processInProcess(req: WorkerRequest): Promise<WorkerResponse> {
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
  const lang = await loadLanguage(plugin.grammarWasmFile);
  const result = await plugin.parse(req.filePath, req.source, lang);

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

/** Try to spawn workers; returns null if workers are not available (e.g. compiled binary) */
function tryCreateWorkers(count: number): Worker[] | null {
  try {
    const workers = Array.from(
      { length: count },
      () => new Worker(new URL("./worker-entry.ts", import.meta.url)),
    );
    return workers;
  } catch {
    return null;
  }
}

/** Process files via worker threads */
async function processWithWorkers(
  files: Array<{ path: string; source: string; pluginId: string }>,
  workers: Worker[],
  opts: PoolOptions,
): Promise<WorkerResponse[]> {
  const results: WorkerResponse[] = new Array(files.length);
  let nextIndex = 0;
  let completed = 0;
  const total = files.length;

  return new Promise<WorkerResponse[]>((resolve, reject) => {
    function dispatch(worker: Worker) {
      if (nextIndex >= files.length) return;
      const idx = nextIndex++;
      const file = files[idx];
      const req: WorkerRequest = {
        filePath: file.path,
        source: file.source,
        pluginId: file.pluginId,
        projectRoot: opts.projectRoot,
      };

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const resp = event.data;
        results[idx] = resp;
        completed++;

        if (resp.parseError) {
          opts.onError(resp.filePath, resp.parseError);
        }
        opts.onProgress(completed, total, resp.filePath);

        if (completed === total) {
          for (const w of workers) w.terminate();
          resolve(results);
        } else {
          dispatch(worker);
        }
      };

      worker.onerror = (err) => {
        for (const w of workers) w.terminate();
        const msg =
          err instanceof ErrorEvent
            ? err.message || String(err.error)
            : String(err);
        reject(new Error(`Worker error: ${msg}`));
      };

      worker.postMessage(req);
    }

    for (const worker of workers) {
      dispatch(worker);
    }
  });
}

/** Process files in main thread sequentially */
async function processInMainThread(
  files: Array<{ path: string; source: string; pluginId: string }>,
  opts: PoolOptions,
): Promise<WorkerResponse[]> {
  const results: WorkerResponse[] = [];
  const total = files.length;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const req: WorkerRequest = {
      filePath: file.path,
      source: file.source,
      pluginId: file.pluginId,
      projectRoot: opts.projectRoot,
    };

    const resp = await processInProcess(req);
    results.push(resp);

    if (resp.parseError) {
      opts.onError(resp.filePath, resp.parseError);
    }
    opts.onProgress(i + 1, total, resp.filePath);
  }

  return results;
}

export async function processFiles(
  files: Array<{ path: string; source: string; pluginId: string }>,
  opts: PoolOptions,
): Promise<WorkerResponse[]> {
  if (files.length === 0) return [];

  const workerCount = Math.max(1, Math.min(opts.concurrency, files.length));
  const workers = tryCreateWorkers(workerCount);

  if (workers) {
    try {
      return await processWithWorkers(files, workers, opts);
    } catch {
      // Workers failed at runtime (e.g. compiled binary) — fall back to main thread
    }
  }

  return processInMainThread(files, opts);
}
