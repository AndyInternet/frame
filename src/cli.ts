#!/usr/bin/env bun

import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import { loadConfig } from "./core/config.ts";
import {
  formatApiSurface,
  formatDeps,
  formatFileDetail,
  formatHelp,
  formatInitResult,
  formatSearchResults,
  formatSkeleton,
} from "./core/formatter.ts";
import { generate, loadFrame, update, writePurposes } from "./core/frame.ts";
import { init } from "./core/init.ts";
import { forceUnlock } from "./core/lock.ts";
import { findProjectRoot } from "./core/root.ts";
import {
  FileNotInFrameError,
  FrameNotFoundError,
  type PurposePatch,
} from "./core/schema.ts";
import { search } from "./core/search.ts";

// When spawned as an IPC worker subprocess (see workers.ts), skip the CLI
// entirely and run the worker loop. The subprocess is the same compiled
// binary re-entered in worker mode — we bundle `new Worker` in `bun build
// --compile` so this sidesteps the worker-bundling limitation.
if (process.env.__FRAME_WORKER === "1") {
  const { runWorker } = await import("./core/worker-entry.ts");
  await runWorker();
} else {
  await runCli();
}

function collect(val: string, prev: string[]): string[] {
  return [...prev, val];
}

interface GlobalOpts {
  root: string;
  dataPath: string;
  json: boolean;
  concurrency: number;
  extraIgnores: string[];
}

/**
 * Add shared options to a command. Defined on both program and each subcommand
 * so options work before or after the subcommand name.
 */
function addSharedOpts(cmd: Command): Command {
  return cmd
    .option(
      "--root <path>",
      "project root (default: nearest ancestor with .git or .frame, else cwd)",
    )
    .option("--data <path>", "frame file location")
    .option("--json", "return raw JSON output", false)
    .option("--concurrency <n>", "worker count")
    .option(
      "--ignore <glob>",
      "additional ignore pattern (repeatable)",
      collect,
      [] as string[],
    );
}

async function resolveGlobal(cmd: Command): Promise<GlobalOpts> {
  const opts = cmd.optsWithGlobals();
  const root = opts.root ? resolve(opts.root) : findProjectRoot(process.cwd());
  const dataPath = opts.data ?? join(root, ".frame", "frame.json");
  const json = opts.json ?? false;
  const concurrency = opts.concurrency
    ? Number(opts.concurrency)
    : navigator.hardwareConcurrency;
  const flagIgnores: string[] = opts.ignore ?? [];
  const config = await loadConfig(root);
  const extraIgnores = [...config.ignore, ...flagIgnores];
  return { root, dataPath, json, concurrency, extraIgnores };
}

function toFrameOpts(g: GlobalOpts) {
  return {
    root: g.root,
    dataPath: g.dataPath,
    concurrency: g.concurrency,
    extraIgnores: g.extraIgnores,
  };
}

function handleError(err: unknown): never {
  if (err instanceof FrameNotFoundError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  if (err instanceof FileNotInFrameError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `Error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}

async function runCli(): Promise<void> {
  const program = new Command();
  addSharedOpts(program)
    .name("frame")
    .description("Structural frame of your codebase")
    .version("0.1.0");

  // --- generate ---
  const generateCmd = program
    .command("generate")
    .description("Build frame from scratch")
    .option("--force-unlock", "clear stale frame lock");
  addSharedOpts(generateCmd);
  generateCmd.action(async function (this: Command) {
    try {
      const g = await resolveGlobal(this);
      if (this.opts().forceUnlock) {
        await forceUnlock(dirname(g.dataPath));
      }
      const frame = await generate(toFrameOpts(g));
      process.stderr.write(
        `Generated: ${frame.totalFiles} files, ${frame.totalSymbols} symbols\n`,
      );
      if (g.json) {
        process.stdout.write(`${JSON.stringify(frame)}\n`);
      }
    } catch (err) {
      handleError(err);
    }
  });

  // --- init ---
  const initCmd = program
    .command("init")
    .description("Scaffold .frame/ and install Claude Code skills");
  addSharedOpts(initCmd);
  initCmd.action(async function (this: Command) {
    try {
      const g = await resolveGlobal(this);
      const result = await init(g.root);
      process.stdout.write(`${formatInitResult(result)}\n`);
    } catch (err) {
      handleError(err);
    }
  });

  // --- update ---
  const updateCmd = program
    .command("update")
    .description("Re-hash files, invalidate changed purposes")
    .option("--force-unlock", "clear stale frame lock");
  addSharedOpts(updateCmd);
  updateCmd.action(async function (this: Command) {
    try {
      const g = await resolveGlobal(this);
      if (this.opts().forceUnlock) {
        await forceUnlock(dirname(g.dataPath));
      }
      const frame = await update(toFrameOpts(g));
      process.stderr.write(
        `Updated: ${frame.totalFiles} files, ${frame.totalSymbols} symbols\n`,
      );
      if (g.json) {
        process.stdout.write(`${JSON.stringify(frame)}\n`);
      }
    } catch (err) {
      handleError(err);
    }
  });

  // --- read ---
  const readCmd = program
    .command("read")
    .description("List all files with purposes (no symbols)");
  addSharedOpts(readCmd);
  readCmd.action(async function (this: Command) {
    try {
      const g = await resolveGlobal(this);
      const frame = await loadFrame(g.dataPath);
      if (g.json) {
        const skeleton = {
          ...frame,
          files: frame.files.map(({ symbols: _symbols, ...rest }) => rest),
        };
        process.stdout.write(`${JSON.stringify(skeleton)}\n`);
      } else {
        process.stdout.write(`${formatSkeleton(frame)}\n`);
      }
    } catch (err) {
      handleError(err);
    }
  });

  // --- read-file ---
  const readFileCmd = program
    .command("read-file")
    .argument("<path>", "relative path from project root")
    .description("Full symbol detail for one file");
  addSharedOpts(readFileCmd);
  readFileCmd.action(async function (this: Command, filePath: string) {
    try {
      const g = await resolveGlobal(this);
      const frame = await loadFrame(g.dataPath);
      const file = frame.files.find((f) => f.path === filePath);
      if (!file) {
        throw new FileNotInFrameError(filePath);
      }
      if (g.json) {
        process.stdout.write(`${JSON.stringify(file)}\n`);
      } else {
        process.stdout.write(`${formatFileDetail(file)}\n`);
      }
    } catch (err) {
      handleError(err);
    }
  });

  // --- search ---
  const searchCmd = program
    .command("search")
    .argument("<query...>", "search terms")
    .description("Search files and symbols")
    .option("--limit <n>", "max results", "20")
    .option("--files-only", "file-level matches only", false)
    .option("--symbols-only", "symbol-level matches only", false)
    .option("--threshold <n>", "minimum score to include", "1");
  addSharedOpts(searchCmd);
  searchCmd.action(async function (this: Command, queryParts: string[]) {
    try {
      const g = await resolveGlobal(this);
      const frame = await loadFrame(g.dataPath);
      const query = queryParts.join(" ");
      const cmdOpts = this.opts();
      const results = search(frame, query, {
        limit: Number(cmdOpts.limit),
        filesOnly: cmdOpts.filesOnly ?? false,
        symbolsOnly: cmdOpts.symbolsOnly ?? false,
        threshold: Number(cmdOpts.threshold),
      });
      if (g.json) {
        process.stdout.write(`${JSON.stringify(results)}\n`);
      } else {
        process.stdout.write(`${formatSearchResults(results, query)}\n`);
      }
    } catch (err) {
      handleError(err);
    }
  });

  // --- api-surface ---
  const apiSurfaceCmd = program
    .command("api-surface")
    .description("All exported symbols grouped by file");
  addSharedOpts(apiSurfaceCmd);
  apiSurfaceCmd.action(async function (this: Command) {
    try {
      const g = await resolveGlobal(this);
      const frame = await loadFrame(g.dataPath);
      if (g.json) {
        const surface = frame.files.flatMap((f) =>
          f.symbols
            .filter((s) => s.exported)
            .map((s) => ({
              file: f.path,
              name: s.name,
              kind: s.kind,
              parameters: s.parameters,
              returns: s.returns,
            })),
        );
        process.stdout.write(`${JSON.stringify(surface)}\n`);
      } else {
        process.stdout.write(`${formatApiSurface(frame)}\n`);
      }
    } catch (err) {
      handleError(err);
    }
  });

  // --- deps ---
  const depsCmd = program
    .command("deps")
    .argument("<path>", "relative path from project root")
    .description("Import relationships for one file")
    .option("--external", "include external package imports", false);
  addSharedOpts(depsCmd);
  depsCmd.action(async function (this: Command, filePath: string) {
    try {
      const g = await resolveGlobal(this);
      const frame = await loadFrame(g.dataPath);
      const file = frame.files.find((f) => f.path === filePath);
      if (!file) {
        throw new FileNotInFrameError(filePath);
      }
      const reverseDeps = frame.files
        .filter((f) => f.imports.includes(filePath))
        .map((f) => f.path);
      const cmdOpts = this.opts();
      if (g.json) {
        const out: Record<string, unknown> = {
          path: file.path,
          imports: file.imports,
          importedBy: reverseDeps,
        };
        if (cmdOpts.external) {
          out.externalImports = file.externalImports;
        }
        process.stdout.write(`${JSON.stringify(out)}\n`);
      } else {
        process.stdout.write(
          `${formatDeps(file, reverseDeps, cmdOpts.external ?? false)}\n`,
        );
      }
    } catch (err) {
      handleError(err);
    }
  });

  // --- write-purposes ---
  const writePurposesCmd = program
    .command("write-purposes")
    .description("Patch purposes from stdin JSON");
  addSharedOpts(writePurposesCmd);
  writePurposesCmd.action(async function (this: Command) {
    try {
      const g = await resolveGlobal(this);
      const input = await Bun.stdin.text();
      if (!input.trim()) return;
      const patches: PurposePatch[] = JSON.parse(input);
      if (patches.length === 0) return;
      const dataDir = dirname(g.dataPath);
      await writePurposes(dataDir, patches);
    } catch (err) {
      handleError(err);
    }
  });

  // --- help ---
  const helpCmd = program
    .command("help")
    .argument("[command]", "command name")
    .option("--agent", "machine-optimized output", false)
    .description("Show help");
  helpCmd.action(function (this: Command, command: string | undefined) {
    const cmdOpts = this.opts();
    process.stdout.write(`${formatHelp(command, cmdOpts.agent ?? false)}\n`);
  });

  await program.parseAsync();
}
