import { hashString } from "../../core/hash.ts";
import type { ParsedFile, RawSymbol } from "../../core/schema.ts";

/** Hash entire file: concatenation of all symbol astTexts */
export function hashFile(parsed: ParsedFile): string {
  return hashString(parsed.astText);
}

/** Hash single symbol via its astText */
export function hashSymbol(symbol: RawSymbol): string {
  return hashString(symbol.astText);
}
