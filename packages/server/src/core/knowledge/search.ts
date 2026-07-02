import { getKnowledgeBasePath, loadPolicyChunks } from "./store";
import type { PolicySearchResult } from "./types";

export interface SearchPolicyKnowledgeOptions {
  outputDir?: string;
  sourceId?: string;
  limit?: number;
}

export function searchPolicyKnowledge(
  query: string,
  options: SearchPolicyKnowledgeOptions = {},
): PolicySearchResult[] {
  const outputDir = getKnowledgeBasePath(options.outputDir);
  const chunks = loadPolicyChunks(outputDir);
  const terms = tokenize(query);
  const limit = Math.min(Math.max(options.limit || 5, 1), 10);

  if (terms.length === 0) {
    return [];
  }

  return chunks
    .filter((chunk) => !options.sourceId || chunk.sourceId === options.sourceId)
    .map((chunk) => ({ ...chunk, score: scoreChunk(chunk.title, chunk.chunk, terms) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function tokenize(value: string): string[] {
  const normalized = value.toLowerCase();
  const terms = new Set<string>();

  for (const word of normalized.match(/[a-z0-9]+/g) || []) {
    if (word.length > 1) {
      terms.add(word);
    }
  }

  for (const sequence of normalized.match(/[\u4e00-\u9fa5]{2,}/g) || []) {
    if (sequence.length <= 4) {
      terms.add(sequence);
    }
    for (let index = 0; index < sequence.length - 1; index++) {
      terms.add(sequence.slice(index, index + 2));
    }
  }

  return [...terms];
}

function scoreChunk(title: string, chunk: string, terms: string[]): number {
  const lowerTitle = title.toLowerCase();
  const lowerChunk = chunk.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (lowerTitle.includes(term)) {
      score += 8;
    }

    const occurrences = lowerChunk.split(term).length - 1;
    if (occurrences > 0) {
      score += Math.min(occurrences, 6);
    }
  }

  return score;
}
