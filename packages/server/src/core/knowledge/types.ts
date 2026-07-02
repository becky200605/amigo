export interface PolicySourceConfig {
  id: string;
  name: string;
  startUrls: string[];
  allowedHosts: string[];
  includeKeywords: string[];
  maxPages: number;
  maxDepth: number;
}

export interface CrawlOptions {
  outputDir?: string;
  sourceIds?: string[];
  maxPagesPerSource?: number;
  reset?: boolean;
  dryRun?: boolean;
}

export interface CrawlSummary {
  outputDir: string;
  startedAt: string;
  finishedAt: string;
  sources: Array<{
    id: string;
    name: string;
    fetched: number;
    saved: number;
    skipped: number;
    failed: number;
  }>;
  documents: number;
  chunks: number;
}

export interface PolicyDocument {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  publishedAt?: string;
  crawledAt: string;
  content: string;
}

export interface PolicyChunk {
  id: string;
  documentId: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  publishedAt?: string;
  crawledAt: string;
  chunk: string;
  charStart: number;
  charEnd: number;
}

export interface PolicySearchResult extends PolicyChunk {
  score: number;
}
