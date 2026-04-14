import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCK_FILENAME = "frame.lock";
const DEFAULT_TIMEOUT_MS = 10000;
const RETRY_INTERVAL_MS = 100;

export interface LockHandle {
  release(): Promise<void>;
}

function lockPath(dataDir: string): string {
  return join(dataDir, LOCK_FILENAME);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquireLock(
  dataDir: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<LockHandle> {
  const lp = lockPath(dataDir);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    // Try exclusive create
    try {
      writeFileSync(lp, String(process.pid), { flag: "wx" });
      // Lock acquired
      return {
        async release() {
          try {
            unlinkSync(lp);
          } catch {
            // already removed — fine
          }
        },
      };
    } catch {
      // File exists — check if stale
    }

    // Lock file exists — read PID and check liveness
    let existingPid: number;
    try {
      const content = readFileSync(lp, "utf-8").trim();
      existingPid = Number.parseInt(content, 10);
    } catch {
      // File disappeared between check and read — retry immediately
      continue;
    }

    if (Number.isNaN(existingPid) || !isPidAlive(existingPid)) {
      // Stale lock — overwrite
      try {
        unlinkSync(lp);
      } catch {
        // gone already
      }
      try {
        writeFileSync(lp, String(process.pid), { flag: "wx" });
        return {
          async release() {
            try {
              unlinkSync(lp);
            } catch {
              // already removed
            }
          },
        };
      } catch {
        // Someone else grabbed it between unlink and write — retry
      }
    }

    // Lock held by live process — check timeout
    if (Date.now() >= deadline) {
      throw new Error(
        `frame.json is locked by PID ${existingPid}. Run frame update --force-unlock to clear stale lock`,
      );
    }

    await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
  }
}

export async function forceUnlock(dataDir: string): Promise<void> {
  const lp = lockPath(dataDir);
  if (existsSync(lp)) {
    unlinkSync(lp);
  }
}
