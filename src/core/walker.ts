import { readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";

export interface WalkOptions {
  root: string;
  extraIgnores: string[];
}

/**
 * Returns relative paths from root for all non-ignored files.
 * Uses git ls-files when .git exists, recursive readdir fallback otherwise.
 */
export async function walkProject(opts: WalkOptions): Promise<string[]> {
  const { root, extraIgnores } = opts;

  const isGit = await detectGit(root);
  const paths = isGit ? await gitWalk(root) : await fsWalk(root);

  const filtered = paths.filter((p) => {
    if (p.startsWith(".frame/") || p.startsWith(".frame\\")) return false;
    for (const pattern of extraIgnores) {
      const glob = new Bun.Glob(pattern);
      if (glob.match(p) || glob.match(basename(p))) return false;
    }
    return true;
  });

  return filtered.sort();
}

async function detectGit(root: string): Promise<boolean> {
  // .git can be file (worktree) or directory
  try {
    await stat(join(root, ".git"));
    return true;
  } catch {
    // fallback: git rev-parse --git-dir
    try {
      const proc = Bun.spawn(["git", "rev-parse", "--git-dir"], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      return exitCode === 0;
    } catch {
      return false;
    }
  }
}

async function gitWalk(root: string): Promise<string[]> {
  const proc = Bun.spawn(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const text = await new Response(proc.stdout).text();
  await proc.exited;

  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function fsWalk(root: string): Promise<string[]> {
  const results: string[] = [];
  await walkDir(root, root, results);
  return results;
}

const SKIP_DIRS = new Set([".git", "node_modules", ".frame"]);

async function walkDir(
  base: string,
  dir: string,
  results: string[],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkDir(base, fullPath, results);
    } else {
      const rel = relative(base, fullPath).replace(/\\/g, "/");
      results.push(rel);
    }
  }
}
