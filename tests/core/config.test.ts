import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../../src/core/config.ts";

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
