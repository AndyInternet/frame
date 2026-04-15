import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { init } from "../../src/core/init.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const FRAME_CONTEXT_SOURCE = join(
  REPO_ROOT,
  ".claude/skills/frame-context.md",
);
const FRAME_POPULATE_SOURCE = join(
  REPO_ROOT,
  ".claude/skills/frame-populate.md",
);

let tempDir: string;

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "init-test-")));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("init", () => {
  test("clean run creates .frame/.gitignore and both skill files", async () => {
    const result = await init(tempDir);

    expect(result.root).toBe(tempDir);
    expect(result.outcomes).toEqual([
      { path: ".frame/.gitignore", status: "created" },
      { path: ".claude/skills/frame-context.md", status: "created" },
      { path: ".claude/skills/frame-populate.md", status: "created" },
    ]);

    expect(existsSync(join(tempDir, ".frame"))).toBe(true);
    expect(existsSync(join(tempDir, ".frame/.gitignore"))).toBe(true);
    expect(existsSync(join(tempDir, ".claude/skills"))).toBe(true);
    expect(existsSync(join(tempDir, ".claude/skills/frame-context.md"))).toBe(
      true,
    );
    expect(existsSync(join(tempDir, ".claude/skills/frame-populate.md"))).toBe(
      true,
    );
  });

  test(".frame/.gitignore content is exactly '*\\n'", async () => {
    await init(tempDir);
    const content = await readFile(
      join(tempDir, ".frame/.gitignore"),
      "utf8",
    );
    expect(content).toBe("*\n");
  });

  test("embedded skill content matches canonical source files", async () => {
    await init(tempDir);

    const installedContext = await readFile(
      join(tempDir, ".claude/skills/frame-context.md"),
      "utf8",
    );
    const installedPopulate = await readFile(
      join(tempDir, ".claude/skills/frame-populate.md"),
      "utf8",
    );
    const sourceContext = await readFile(FRAME_CONTEXT_SOURCE, "utf8");
    const sourcePopulate = await readFile(FRAME_POPULATE_SOURCE, "utf8");

    expect(installedContext).toBe(sourceContext);
    expect(installedPopulate).toBe(sourcePopulate);
  });

  test("re-run on already-initialized directory skips all files", async () => {
    await init(tempDir);
    const result = await init(tempDir);

    expect(result.outcomes).toEqual([
      { path: ".frame/.gitignore", status: "skipped" },
      { path: ".claude/skills/frame-context.md", status: "skipped" },
      { path: ".claude/skills/frame-populate.md", status: "skipped" },
    ]);
  });

  test("partial state creates only missing files", async () => {
    // Pre-create .frame/.gitignore but leave skills missing.
    await mkdir(join(tempDir, ".frame"), { recursive: true });
    await writeFile(join(tempDir, ".frame/.gitignore"), "preexisting\n");

    const result = await init(tempDir);

    expect(result.outcomes).toEqual([
      { path: ".frame/.gitignore", status: "skipped" },
      { path: ".claude/skills/frame-context.md", status: "created" },
      { path: ".claude/skills/frame-populate.md", status: "created" },
    ]);

    // Pre-existing .gitignore content must NOT be overwritten.
    const gi = await readFile(join(tempDir, ".frame/.gitignore"), "utf8");
    expect(gi).toBe("preexisting\n");
  });
});
