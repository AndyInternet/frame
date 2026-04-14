import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walkProject } from "../../src/core/walker.ts";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "walker-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** Helper: create file and any intermediate directories */
async function touch(relativePath: string): Promise<void> {
  const full = join(tempDir, relativePath);
  const dir = full.substring(0, full.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(full, "");
}

describe("walkProject (non-git)", () => {
  test("walks temp directory and returns relative paths", async () => {
    await touch("src/index.ts");
    await touch("src/utils/helper.ts");
    await touch("README.md");

    const result = await walkProject({ root: tempDir, extraIgnores: [] });

    expect(result).toEqual(["README.md", "src/index.ts", "src/utils/helper.ts"]);
  });

  test("excludes .frame/ directories", async () => {
    await touch("src/main.ts");
    await touch(".frame/frame.json");
    await touch(".frame/frame.lock");

    const result = await walkProject({ root: tempDir, extraIgnores: [] });

    expect(result).toEqual(["src/main.ts"]);
    expect(result.every((p) => !p.startsWith(".frame/"))).toBe(true);
  });

  test("excludes node_modules/ directories in non-git mode", async () => {
    await touch("app.ts");
    await touch("node_modules/pkg/index.js");

    const result = await walkProject({ root: tempDir, extraIgnores: [] });

    expect(result).toEqual(["app.ts"]);
  });

  test("extra ignore patterns filter correctly", async () => {
    await touch("src/app.ts");
    await touch("src/app.test.ts");
    await touch("src/utils.ts");
    await touch("src/utils.test.ts");

    const result = await walkProject({
      root: tempDir,
      extraIgnores: ["*.test.ts"],
    });

    expect(result).toEqual(["src/app.ts", "src/utils.ts"]);
  });

  test("multiple extra ignore patterns", async () => {
    await touch("src/main.ts");
    await touch("src/main.test.ts");
    await touch("docs/guide.md");
    await touch("config.json");

    const result = await walkProject({
      root: tempDir,
      extraIgnores: ["*.test.ts", "*.md"],
    });

    expect(result).toEqual(["config.json", "src/main.ts"]);
  });

  test("empty directory returns empty array", async () => {
    const result = await walkProject({ root: tempDir, extraIgnores: [] });
    expect(result).toEqual([]);
  });

  test("results are sorted alphabetically", async () => {
    await touch("z.ts");
    await touch("a.ts");
    await touch("m/b.ts");
    await touch("m/a.ts");

    const result = await walkProject({ root: tempDir, extraIgnores: [] });

    const sorted = [...result].sort();
    expect(result).toEqual(sorted);
  });
});

describe("walkProject (git mode)", () => {
  test("uses git ls-files when .git exists", async () => {
    // Init a git repo in temp dir
    const init = Bun.spawn(["git", "init"], {
      cwd: tempDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await init.exited;

    await touch("tracked.ts");
    await touch("untracked.ts");

    // Stage one file
    const add = Bun.spawn(["git", "add", "tracked.ts"], {
      cwd: tempDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await add.exited;

    const result = await walkProject({ root: tempDir, extraIgnores: [] });

    // git ls-files --cached --others --exclude-standard returns both
    expect(result).toContain("tracked.ts");
    expect(result).toContain("untracked.ts");
  });

  test("git mode still excludes .frame/ and extra ignores", async () => {
    const init = Bun.spawn(["git", "init"], {
      cwd: tempDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await init.exited;

    await touch("src/main.ts");
    await touch("src/main.test.ts");
    await touch(".frame/frame.json");

    const add = Bun.spawn(["git", "add", "."], {
      cwd: tempDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await add.exited;

    const result = await walkProject({
      root: tempDir,
      extraIgnores: ["*.test.ts"],
    });

    expect(result).toEqual(["src/main.ts"]);
  });
});

describe("walkProject with fixtures", () => {
  test("walking fixtures/typescript returns .ts files", async () => {
    // Copy fixture structure into temp dir (non-git mode)
    await touch("broken.ts");
    await touch("complex.ts");
    await touch("simple.ts");

    const result = await walkProject({ root: tempDir, extraIgnores: [] });

    expect(result).toEqual(["broken.ts", "complex.ts", "simple.ts"]);
  });
});
