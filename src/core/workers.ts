import type { Subprocess } from "bun";
import { rawHash } from "./hash.ts";
import { getPluginById } from "./registry.ts";
import type { WorkerRequest, WorkerResponse } from "./schema.ts";
import { getParser, initParser } from "./wasm-loader.ts";

export interface PoolOptions {
  concurrency: number;
  projectRoot: string;
  onProgress: (current: number, total: number, filePath: string) => void;
  onError: (filePath: string, error: string) => void;
}

/** Process a single file in the main thread (fallback when subprocess spawn fails) */
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

type WorkerProc = Subprocess<"ignore", "pipe", "inherit">;

/**
 * Build the command used to spawn a worker subprocess.
 *
 * - Compiled (`bun build --compile`): re-invoke the compiled binary itself;
 *   cli.ts dispatches to the worker loop via the __FRAME_WORKER env var.
 * - Dev: invoke bun on worker-entry.ts directly. We can't reuse
 *   `process.argv[1]` because under `bun test` that points at the test file,
 *   which then re-executes outside the test runner.
 */
function workerCommand(): string[] {
  const isCompiled = import.meta.url.startsWith("/$bunfs/");
  if (isCompiled) {
    return [process.execPath];
  }
  // Resolve the sibling worker-entry.ts relative to this file's location.
  const workerEntryPath = new URL("./worker-entry.ts", import.meta.url)
    .pathname;
  return [process.execPath, workerEntryPath];
}

/**
 * Process files via a pool of subprocess workers.
 *
 * If a worker crashes (e.g. OOM on a pathologically large file), its in-flight
 * file is marked as a parse error and a replacement worker is spawned so the
 * rest of the batch still completes. Returns null only if we can't spawn any
 * workers at all.
 */
async function processWithWorkers(
  files: Array<{ path: string; source: string; pluginId: string }>,
  opts: PoolOptions,
): Promise<WorkerResponse[] | null> {
  const total = files.length;
  const results: WorkerResponse[] = new Array(total);
  let completed = 0;
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(opts.concurrency, total));

  const cmd = workerCommand();

  return new Promise((resolve) => {
    let settled = false;
    const alive = new Set<WorkerProc>();
    // Map worker → index of the file it's currently processing
    const inFlight = new Map<WorkerProc, number>();

    function finish(): void {
      if (settled) return;
      settled = true;
      for (const w of alive) w.kill();
      resolve(results);
    }

    function recordResult(idx: number, resp: WorkerResponse): void {
      results[idx] = resp;
      completed++;
      if (resp.parseError) {
        opts.onError(resp.filePath, resp.parseError);
      }
      opts.onProgress(completed, total, resp.filePath);
      if (completed === total) finish();
    }

    function dispatch(proc: WorkerProc): void {
      if (settled) return;
      if (nextIndex >= total) return;
      const idx = nextIndex++;
      const file = files[idx];
      const req: WorkerRequest = {
        filePath: file.path,
        source: file.source,
        pluginId: file.pluginId,
        projectRoot: opts.projectRoot,
      };
      inFlight.set(proc, idx);
      try {
        proc.send(req);
      } catch {
        // Worker already dead — exit handler will pick it up.
      }
    }

    function spawnOne(): WorkerProc | null {
      try {
        const proc = Bun.spawn(cmd, {
          env: { ...process.env, __FRAME_WORKER: "1" },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "inherit",
          serialization: "json",
          ipc(message) {
            const idx = inFlight.get(proc);
            if (idx === undefined) return;
            inFlight.delete(proc);
            recordResult(idx, message as WorkerResponse);
            dispatch(proc);
          },
        }) as WorkerProc;
        alive.add(proc);
        proc.exited.then(() => {
          alive.delete(proc);
          const idx = inFlight.get(proc);
          if (idx !== undefined) {
            inFlight.delete(proc);
            // Worker died with a file in flight — almost always OOM on a huge
            // or pathological file. Mark that file as unparseable.
            const file = files[idx];
            recordResult(idx, {
              filePath: file.path,
              pluginId: file.pluginId,
              pluginVersion: "unknown",
              parseError: "Worker crashed (likely out of memory)",
              rawHash: rawHash(file.source),
            });
          }
          // Keep the pool at capacity if there's more work to do.
          if (!settled && nextIndex < total && alive.size < workerCount) {
            const replacement = spawnOne();
            if (replacement) dispatch(replacement);
          }
          // If every worker has died and there's still work, we can't make
          // progress — fall through to main-thread fallback.
          if (!settled && alive.size === 0 && completed < total) {
            settled = true;
            resolve(null);
          }
        });
        return proc;
      } catch {
        return null;
      }
    }

    const initial: WorkerProc[] = [];
    for (let i = 0; i < workerCount; i++) {
      const proc = spawnOne();
      if (proc) initial.push(proc);
    }
    if (initial.length === 0) {
      resolve(null);
      return;
    }
    for (const proc of initial) dispatch(proc);
  });
}

/** Process files in main thread sequentially (compat fallback). */
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

  const workerResult = await processWithWorkers(files, opts);
  if (workerResult) return workerResult;

  // Workers couldn't be spawned at all — last-resort fallback.
  return processInMainThread(files, opts);
}
