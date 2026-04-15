import { join } from "node:path";

/**
 * Configuration for the Frame CLI tool.
 * Handles loading and managing `.frame/config.json` files.
 */

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
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    return { ignore: [] };
  }
  const obj = parsed as Record<string, unknown>;
  const ignore = obj.ignore === undefined ? [] : (obj.ignore as string[]);
  return { ignore };
}
