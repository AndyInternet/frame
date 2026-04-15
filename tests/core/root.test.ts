import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectRoot } from "../../src/core/root.ts";

let tempDir: string;

beforeEach(async () => {
  // realpath resolves macOS /var → /private/var so path comparisons match.
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "root-test-")));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("findProjectRoot", () => {
  test("returns ancestor with .git directory", async () => {
    await mkdir(join(tempDir, ".git"), { recursive: true });
    await mkdir(join(tempDir, "src", "utils"), { recursive: true });

    const result = findProjectRoot(join(tempDir, "src", "utils"));

    expect(result).toBe(tempDir);
  });

  test("returns ancestor with .git file (worktree case)", async () => {
    await writeFile(join(tempDir, ".git"), "gitdir: /elsewhere\n");
    await mkdir(join(tempDir, "src"), { recursive: true });

    const result = findProjectRoot(join(tempDir, "src"));

    expect(result).toBe(tempDir);
  });

  test("returns ancestor with .frame directory", async () => {
    await mkdir(join(tempDir, ".frame"), { recursive: true });
    await mkdir(join(tempDir, "deep", "nested"), { recursive: true });

    const result = findProjectRoot(join(tempDir, "deep", "nested"));

    expect(result).toBe(tempDir);
  });

  test("returns start when no marker found anywhere on path", async () => {
    await mkdir(join(tempDir, "isolated"), { recursive: true });

    const result = findProjectRoot(join(tempDir, "isolated"));

    expect(result).toBe(join(tempDir, "isolated"));
  });

  test("closest marker wins when both .git and .frame exist on path", async () => {
    // Outer .git, inner .frame. cwd is below both. Closest (.frame) wins.
    await mkdir(join(tempDir, ".git"), { recursive: true });
    await mkdir(join(tempDir, "sub", ".frame"), { recursive: true });
    await mkdir(join(tempDir, "sub", "deep"), { recursive: true });

    const result = findProjectRoot(join(tempDir, "sub", "deep"));

    expect(result).toBe(join(tempDir, "sub"));
  });

  test("returns start itself if marker is in start directory", async () => {
    await mkdir(join(tempDir, ".git"), { recursive: true });

    const result = findProjectRoot(tempDir);

    expect(result).toBe(tempDir);
  });
});
