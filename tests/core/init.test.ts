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
  ".claude/skills/frame-context/SKILL.md",
);
const FRAME_POPULATE_SOURCE = join(
  REPO_ROOT,
  ".claude/skills/frame-populate/SKILL.md",
);

let tempDir: string;

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "init-test-")));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("init", () => {
  test("clean run creates .frame/.gitignore, config.json, and both skill files", async () => {
    const result = await init(tempDir);

    expect(result.root).toBe(tempDir);
    expect(result.outcomes).toEqual([
      { path: ".frame/.gitignore", status: "created" },
      { path: ".frame/config.json", status: "created" },
      { path: ".claude/skills/frame-context/SKILL.md", status: "created" },
      { path: ".claude/skills/frame-populate/SKILL.md", status: "created" },
    ]);

    expect(existsSync(join(tempDir, ".frame"))).toBe(true);
    expect(existsSync(join(tempDir, ".frame/.gitignore"))).toBe(true);
    expect(existsSync(join(tempDir, ".frame/config.json"))).toBe(true);
    expect(existsSync(join(tempDir, ".claude/skills"))).toBe(true);
    expect(existsSync(join(tempDir, ".claude/skills/frame-context/SKILL.md"))).toBe(
      true,
    );
    expect(existsSync(join(tempDir, ".claude/skills/frame-populate/SKILL.md"))).toBe(
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

  test(".frame/config.json content is the default config as pretty-printed JSON", async () => {
    await init(tempDir);
    const content = await readFile(
      join(tempDir, ".frame/config.json"),
      "utf8",
    );
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({
      ignore: [
        "vendor/**",
        "node_modules/**",
        "dist/**",
        "build/**",
        ".next/**",
        "out/**",
        "coverage/**",
        "**/*.generated.*",
        "**/*.gen.*",
        "**/*.pb.go",
        "**/*.min.js",
      ],
    });
    // Pretty-printed with a trailing newline.
    expect(content.endsWith("\n")).toBe(true);
    expect(content).toContain("\n  \"ignore\": [");
  });

  test("embedded skill content matches canonical source files", async () => {
    await init(tempDir);

    const installedContext = await readFile(
      join(tempDir, ".claude/skills/frame-context/SKILL.md"),
      "utf8",
    );
    const installedPopulate = await readFile(
      join(tempDir, ".claude/skills/frame-populate/SKILL.md"),
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
      { path: ".frame/config.json", status: "skipped" },
      { path: ".claude/skills/frame-context/SKILL.md", status: "skipped" },
      { path: ".claude/skills/frame-populate/SKILL.md", status: "skipped" },
    ]);
  });

  test("partial state creates only missing files", async () => {
    // Pre-create .frame/.gitignore but leave skills missing.
    await mkdir(join(tempDir, ".frame"), { recursive: true });
    await writeFile(join(tempDir, ".frame/.gitignore"), "preexisting\n");

    const result = await init(tempDir);

    expect(result.outcomes).toEqual([
      { path: ".frame/.gitignore", status: "skipped" },
      { path: ".frame/config.json", status: "created" },
      { path: ".claude/skills/frame-context/SKILL.md", status: "created" },
      { path: ".claude/skills/frame-populate/SKILL.md", status: "created" },
    ]);

    // Pre-existing .gitignore content must NOT be overwritten.
    const gi = await readFile(join(tempDir, ".frame/.gitignore"), "utf8");
    expect(gi).toBe("preexisting\n");
  });
});
