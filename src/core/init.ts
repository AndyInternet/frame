import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultConfig } from "./config.ts";

// Embed canonical skill files into the compiled binary. Same pattern as
// src/core/wasm-loader.ts — these resolve to file paths at runtime.
import frameContextSkill from "../../.claude/skills/frame-context.md" with {
  type: "file",
};
import framePopulateSkill from "../../.claude/skills/frame-populate.md" with {
  type: "file",
};

export interface InitOutcome {
  /** Path relative to project root. */
  path: string;
  status: "created" | "skipped";
}

export interface InitResult {
  /** Absolute path to the project root that was initialized. */
  root: string;
  /** Per-file outcomes in stable order. */
  outcomes: InitOutcome[];
}

/**
 * Scaffold .frame/ and install Claude Code skills in `root`.
 *
 * Idempotent — each file is exists-checked and reported as `created` or
 * `skipped`. Directory creates use `recursive: true` and don't appear in
 * the outcomes list; only tracked files (the .gitignore and two skills) do.
 */
export async function init(root: string): Promise<InitResult> {
  const outcomes: InitOutcome[] = [];

  // 1. .frame/.gitignore
  await mkdir(join(root, ".frame"), { recursive: true });
  outcomes.push(await writeIfMissing(root, ".frame/.gitignore", "*\n"));

  // 2. .frame/config.json
  outcomes.push(
    await writeIfMissing(
      root,
      ".frame/config.json",
      `${JSON.stringify(defaultConfig(), null, 2)}\n`,
    ),
  );

  // 3. Skill files
  await mkdir(join(root, ".claude", "skills"), { recursive: true });
  const contextContent = await Bun.file(frameContextSkill).text();
  const populateContent = await Bun.file(framePopulateSkill).text();
  outcomes.push(
    await writeIfMissing(
      root,
      ".claude/skills/frame-context.md",
      contextContent,
    ),
  );
  outcomes.push(
    await writeIfMissing(
      root,
      ".claude/skills/frame-populate.md",
      populateContent,
    ),
  );

  return { root, outcomes };
}

async function writeIfMissing(
  root: string,
  relPath: string,
  content: string,
): Promise<InitOutcome> {
  const fullPath = join(root, relPath);
  if (existsSync(fullPath)) {
    return { path: relPath, status: "skipped" };
  }
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
  return { path: relPath, status: "created" };
}
