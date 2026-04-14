import type { WorkerRequest, WorkerResponse } from "./schema.ts";

export interface PoolOptions {
  concurrency: number;
  projectRoot: string;
  onProgress: (current: number, total: number, filePath: string) => void;
  onError: (filePath: string, error: string) => void;
}

export async function processFiles(
  files: Array<{ path: string; source: string; pluginId: string }>,
  opts: PoolOptions,
): Promise<WorkerResponse[]> {
  if (files.length === 0) return [];

  const workerCount = Math.min(opts.concurrency, files.length);
  const workers: Worker[] = Array.from(
    { length: Math.max(1, workerCount) },
    () => new Worker(new URL("./worker-entry.ts", import.meta.url).href),
  );

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
        reject(err);
      };

      worker.postMessage(req);
    }

    for (const worker of workers) {
      dispatch(worker);
    }
  });
}
