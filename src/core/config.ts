/**
 * Configuration for the Frame CLI tool.
 * Handles loading and managing `.frame/config.json` files.
 */
import { join } from "node:path";

export interface FrameConfig {
  ignore: string[];
}

const DEFAULT_IGNORE: readonly string[] = [
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
];

export function defaultConfig(): FrameConfig {
  return { ignore: [...DEFAULT_IGNORE] };
}

export async function loadConfig(root: string): Promise<FrameConfig> {
  const path = join(root, ".frame", "config.json");
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { ignore: [] };
  }
  const raw = await file.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in .frame/config.json: ${msg}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ignore: [] };
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.ignore === undefined) {
    return { ignore: [] };
  }
  if (!Array.isArray(obj.ignore)) {
    throw new Error(
      "Invalid .frame/config.json: `ignore` must be an array of glob strings",
    );
  }
  for (const entry of obj.ignore) {
    if (typeof entry !== "string") {
      throw new Error(
        "Invalid .frame/config.json: every `ignore` entry must be a string glob",
      );
    }
  }
  return { ignore: obj.ignore as string[] };
}
