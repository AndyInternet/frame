import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Walk up from `start` looking for a `.git` or `.frame` entry (file or directory).
 * Returns the first ancestor (including `start` itself) that contains either marker,
 * or `start` if no marker is found anywhere up the chain.
 *
 * Both markers are treated as equally valid; whichever is closer to `start` wins.
 */
export function findProjectRoot(start: string): string {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, ".git")) || existsSync(join(dir, ".frame"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // Reached filesystem root with no marker found.
      return start;
    }
    dir = parent;
  }
}
