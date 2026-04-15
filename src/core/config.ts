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
