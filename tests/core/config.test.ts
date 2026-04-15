import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, loadConfig } from "../../src/core/config.ts";

describe("defaultConfig", () => {
  test("returns the prepopulated ignore list", () => {
    const config = defaultConfig();
    expect(config.ignore).toEqual([
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
    ]);
  });
});

let tempDir: string;

async function writeConfigFile(content: string): Promise<void> {
  await mkdir(join(tempDir, ".frame"), { recursive: true });
  await writeFile(join(tempDir, ".frame/config.json"), content);
}

describe("loadConfig", () => {
  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), "config-test-")));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("missing .frame/config.json returns empty ignore list", async () => {
    const config = await loadConfig(tempDir);
    expect(config.ignore).toEqual([]);
  });

  test("valid config with ignore array is returned verbatim", async () => {
    await writeConfigFile('{"ignore": ["foo/**", "bar.ts"]}');
    const config = await loadConfig(tempDir);
    expect(config.ignore).toEqual(["foo/**", "bar.ts"]);
  });

  test("valid JSON with no ignore field returns empty ignore list", async () => {
    await writeConfigFile("{}");
    const config = await loadConfig(tempDir);
    expect(config.ignore).toEqual([]);
  });

  test("unknown top-level fields are ignored silently", async () => {
    await writeConfigFile(
      '{"ignore": ["x/**"], "futureField": "whatever", "nested": {"a": 1}}',
    );
    const config = await loadConfig(tempDir);
    expect(config.ignore).toEqual(["x/**"]);
  });
});

describe("loadConfig error cases", () => {
  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), "config-test-")));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("malformed JSON throws with a message naming the file", async () => {
    await writeConfigFile("{not json");
    await expect(loadConfig(tempDir)).rejects.toThrow(
      /\.frame\/config\.json/,
    );
  });

  test("ignore field that is not an array throws", async () => {
    await writeConfigFile('{"ignore": "foo/**"}');
    await expect(loadConfig(tempDir)).rejects.toThrow(/ignore.*array/);
  });

  test("ignore array containing a non-string element throws", async () => {
    await writeConfigFile('{"ignore": ["valid/**", 42]}');
    await expect(loadConfig(tempDir)).rejects.toThrow(/ignore.*string/);
  });
});
