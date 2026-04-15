import { afterAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../src/cli.ts");
const FIXTURE = resolve(import.meta.dir, "../fixtures/sample-project");
const FRAME_DIR = join(FIXTURE, ".frame");

async function run(
  args: string[],
  opts?: { stdin?: string; cwd?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: opts?.cwd ?? FIXTURE,
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts?.stdin !== undefined ? "pipe" : "ignore",
  });

  if (opts?.stdin !== undefined && proc.stdin) {
    proc.stdin.write(opts.stdin);
    proc.stdin.end();
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

afterAll(async () => {
  if (existsSync(FRAME_DIR)) {
    await rm(FRAME_DIR, { recursive: true, force: true });
  }
});

describe("CLI integration", () => {
  // --- generate ---
  it("frame generate creates .frame/frame.json", async () => {
    const { stderr, exitCode } = await run([
      "generate",
      "--root",
      FIXTURE,
    ]);
    expect(exitCode).toBe(0);
    expect(existsSync(join(FRAME_DIR, "frame.json"))).toBe(true);
    expect(stderr).toContain("Generated:");
    expect(stderr).toContain("files");

    // Verify frame.json is valid JSON with correct file count
    const data = JSON.parse(
      await Bun.file(join(FRAME_DIR, "frame.json")).text(),
    );
    expect(data.files.length).toBeGreaterThanOrEqual(3);
    expect(data.version).toBe("1.0.0");
  }, 30_000);

  // --- read (text) ---
  it("frame read outputs skeleton text", async () => {
    const { stdout, exitCode } = await run(["read", "--root", FIXTURE]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("src/index.ts");
    expect(stdout).toContain("src/utils.ts");
    expect(stdout).toContain("src/types.ts");
  });

  // --- read (json) ---
  it("frame read --json outputs valid JSON", async () => {
    const { stdout, exitCode } = await run([
      "read",
      "--root",
      FIXTURE,
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.files).toBeDefined();
    expect(data.files.length).toBeGreaterThanOrEqual(3);
    // Skeleton mode: no symbols key on files
    for (const file of data.files) {
      expect(file.symbols).toBeUndefined();
    }
  });

  // --- read-file ---
  it("frame read-file shows symbols for a file", async () => {
    const { stdout, exitCode } = await run([
      "read-file",
      "src/index.ts",
      "--root",
      FIXTURE,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("src/index.ts");
    expect(stdout).toContain("greet");
  });

  // --- read-file not found ---
  it("frame read-file nonexistent exits 1", async () => {
    const { stderr, exitCode } = await run([
      "read-file",
      "nonexistent.ts",
      "--root",
      FIXTURE,
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("File not in frame");
  });

  // --- search ---
  it("frame search returns results", async () => {
    const { stdout, exitCode } = await run([
      "search",
      "function",
      "--root",
      FIXTURE,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("search:");
  });

  // --- search no results ---
  it("frame search with no matches returns empty", async () => {
    const { stdout, exitCode } = await run([
      "search",
      "zzz_nonexistent_zzz",
      "--root",
      FIXTURE,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("0 results");
  });

  // --- api-surface ---
  it("frame api-surface lists exported symbols", async () => {
    const { stdout, exitCode } = await run([
      "api-surface",
      "--root",
      FIXTURE,
    ]);
    expect(exitCode).toBe(0);
    // At least some exports should appear
    expect(stdout.length).toBeGreaterThan(0);
  });

  // --- deps ---
  it("frame deps shows imports and reverse deps", async () => {
    const { stdout, exitCode } = await run([
      "deps",
      "src/index.ts",
      "--root",
      FIXTURE,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("src/index.ts");
  });

  // --- no frame → exit 1 ---
  it("frame read with no frame exits 1", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "frame-empty-"));
    try {
      const { stderr, exitCode } = await run(["read", "--root", emptyDir], {
        cwd: emptyDir,
      });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("No frame found");
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  // --- help ---
  it("frame help contains COMMANDS", async () => {
    const { stdout, exitCode } = await run(["help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("COMMANDS");
  });

  // --- help --agent ---
  it("frame help --agent contains TOOL: frame", async () => {
    const { stdout, exitCode } = await run(["help", "--agent"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("TOOL: frame");
  });

  // --- help search ---
  it("frame help search contains AGENT HINT", async () => {
    const { stdout, exitCode } = await run(["help", "search"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("AGENT HINT");
  });

  // --- update ---
  it("frame update preserves structure", async () => {
    const { stderr, exitCode } = await run([
      "update",
      "--root",
      FIXTURE,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Updated:");
    expect(stderr).toContain("files");

    const data = JSON.parse(
      await Bun.file(join(FRAME_DIR, "frame.json")).text(),
    );
    expect(data.files.length).toBeGreaterThanOrEqual(3);
  }, 30_000);

  // --- write-purposes ---
  it("frame write-purposes patches purpose", async () => {
    // Read current frame to get a real file path
    const data = JSON.parse(
      await Bun.file(join(FRAME_DIR, "frame.json")).text(),
    );
    const firstFile = data.files[0].path;
    const patches = [{ path: firstFile, purpose: "test purpose" }];

    const { exitCode } = await run(
      ["write-purposes", "--root", FIXTURE],
      { stdin: JSON.stringify(patches) },
    );
    expect(exitCode).toBe(0);

    // Verify purpose was written
    const updated = JSON.parse(
      await Bun.file(join(FRAME_DIR, "frame.json")).text(),
    );
    const patched = updated.files.find(
      (f: { path: string }) => f.path === firstFile,
    );
    expect(patched.purpose).toBe("test purpose");
  });

  // --- write-purposes empty stdin ---
  it("frame write-purposes with empty stdin is no-op", async () => {
    const { exitCode } = await run(
      ["write-purposes", "--root", FIXTURE],
      { stdin: "" },
    );
    expect(exitCode).toBe(0);
  });

  // --- auto-detect root from subdirectory ---
  it("auto-detects project root when run from a subdirectory of a fixture with .frame", async () => {
    // Pre-condition: the previous "frame generate" test created FRAME_DIR.
    // From a nested cwd with no --root, frame should walk up and find FIXTURE.
    const subdir = join(FIXTURE, "src");
    const { stdout, exitCode } = await run(["read"], { cwd: subdir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("src/index.ts");
  });

  // --- --json as global option before subcommand ---
  it("frame --json read works with global option before subcommand", async () => {
    const { stdout, exitCode } = await run([
      "--json",
      "read",
      "--root",
      FIXTURE,
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.files).toBeDefined();
    // Skeleton: no symbols
    for (const file of data.files) {
      expect(file.symbols).toBeUndefined();
    }
  });
});
