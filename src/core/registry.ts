import { extname } from "node:path";
import { goPlugin } from "../plugins/go/index.ts";
import { typescriptPlugin } from "../plugins/typescript/index.ts";
import type { LanguagePlugin } from "./schema.ts";

const plugins: LanguagePlugin[] = [typescriptPlugin, goPlugin];

const pluginMap = new Map<string, LanguagePlugin>();
for (const p of plugins) {
  pluginMap.set(p.id, p);
}

const extMap = new Map<string, LanguagePlugin>();
for (const p of plugins) {
  for (const ext of p.fileExtensions) {
    extMap.set(ext, p);
  }
}

export function getPluginForFile(filePath: string): LanguagePlugin | null {
  return extMap.get(extname(filePath)) ?? null;
}

export function getPluginById(id: string): LanguagePlugin | null {
  return pluginMap.get(id) ?? null;
}

export function getAllPlugins(): LanguagePlugin[] {
  return plugins;
}
