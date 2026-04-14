import type {
  FileEntry,
  FrameRoot,
  SearchOptions,
  SearchResult,
} from "./schema.ts";

/**
 * Tokenize query into lowercase terms, filtering empties.
 */
function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Score a single file entry against query terms (file-level only).
 */
function scoreFile(file: FileEntry, terms: string[]): number {
  let score = 0;
  const pathLower = file.path.toLowerCase();

  for (const term of terms) {
    if (pathLower.includes(term)) {
      score += 5;
    }
  }

  if (file.purpose !== null) {
    const purposeLower = file.purpose.toLowerCase();
    const matchedTerms = terms.filter((t) => purposeLower.includes(t));
    if (matchedTerms.length === terms.length) {
      score += 3;
    } else {
      score += matchedTerms.length * 1;
    }
  }

  return score;
}

/**
 * Score a symbol against query terms. Returns base score before export multiplier.
 */
function scoreSymbol(
  file: FileEntry,
  symbolIndex: number,
  terms: string[],
): number {
  const sym = file.symbols[symbolIndex];
  let score = 0;
  const nameLower = sym.name.toLowerCase();
  const pathLower = file.path.toLowerCase();

  for (const term of terms) {
    if (nameLower === term) {
      score += 10;
    }
    if (pathLower.includes(term)) {
      score += 5;
    }
  }

  if (sym.purpose !== null) {
    const purposeLower = sym.purpose.toLowerCase();
    const matchedTerms = terms.filter((t) => purposeLower.includes(t));
    if (matchedTerms.length === terms.length) {
      score += 3;
    } else {
      score += matchedTerms.length * 1;
    }
  }

  return score;
}

/**
 * Search frame files and symbols against a query string.
 * Returns results sorted by score descending, capped at opts.limit,
 * filtered by opts.threshold.
 */
export function search(
  frame: FrameRoot,
  query: string,
  opts: SearchOptions,
): SearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const results: SearchResult[] = [];

  for (const file of frame.files) {
    // File-level scoring
    if (!opts.symbolsOnly) {
      const fileScore = scoreFile(file, terms);
      if (fileScore > 0) {
        results.push({
          score: fileScore,
          filePath: file.path,
          filePurpose: file.purpose,
        });
      }
    }

    // Symbol-level scoring
    if (!opts.filesOnly) {
      for (let i = 0; i < file.symbols.length; i++) {
        const sym = file.symbols[i];
        let symScore = scoreSymbol(file, i, terms);

        if (sym.exported) {
          symScore *= 1.5;
        }

        if (symScore > 0) {
          results.push({
            score: symScore,
            filePath: file.path,
            filePurpose: file.purpose,
            symbol: {
              name: sym.name,
              kind: sym.kind,
              purpose: sym.purpose,
              exported: sym.exported,
            },
          });
        }
      }
    }
  }

  // Filter by threshold, sort descending, cap at limit
  return results
    .filter((r) => r.score >= opts.threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit);
}
