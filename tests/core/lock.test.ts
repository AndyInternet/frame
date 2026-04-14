import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { acquireLock, forceUnlock } from "../../src/core/lock";

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  // Clean up lock file if present
  const lockFile = join(tempDir, "frame.lock");
  try {
    if (existsSync(lockFile)) {
      const { unlinkSync } = require("node:fs");
      unlinkSync(lockFile);
    }
    const { rmdirSync } = require("node:fs");
    rmdirSync(tempDir);
  } catch {
    // best effort cleanup
  }
});

describe("lock", () => {
  test("acquire and release cycle: lock acquired, file created, release deletes file", async () => {
    const lockFile = join(tempDir, "frame.lock");
    const handle = await acquireLock(tempDir);

    // Lock file should exist with current PID
    expect(existsSync(lockFile)).toBe(true);
    const content = readFileSync(lockFile, "utf-8").trim();
    expect(content).toBe(String(process.pid));

    // Release should delete the file
    await handle.release();
    expect(existsSync(lockFile)).toBe(false);
  });

  test("double acquire from same process: second call detects own PID as alive and times out", async () => {
    const handle = await acquireLock(tempDir);

    try {
      // Second acquire should timeout — our own PID is alive
      await expect(acquireLock(tempDir, 300)).rejects.toThrow(
        /frame\.json is locked by PID/,
      );
    } finally {
      await handle.release();
    }
  });

  test("forceUnlock clears lock file", async () => {
    const lockFile = join(tempDir, "frame.lock");
    const handle = await acquireLock(tempDir);
    expect(existsSync(lockFile)).toBe(true);

    await forceUnlock(tempDir);
    expect(existsSync(lockFile)).toBe(false);

    // release after force-unlock shouldn't throw
    await handle.release();
  });

  test("forceUnlock on non-existent lock doesn't throw", async () => {
    // No lock file exists — should not throw
    await forceUnlock(tempDir);
  });

  test("stale PID detection: fake PID gets overwritten and lock acquired", async () => {
    const lockFile = join(tempDir, "frame.lock");
    // Write a fake PID that (almost certainly) doesn't exist
    writeFileSync(lockFile, "99999999");

    const handle = await acquireLock(tempDir);

    // Should have acquired — file now has our PID
    expect(existsSync(lockFile)).toBe(true);
    const content = readFileSync(lockFile, "utf-8").trim();
    expect(content).toBe(String(process.pid));

    await handle.release();
  });
});
