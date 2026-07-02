import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getGlobalState } from "@/globalState";
import type { CrawlSummary, PolicyChunk, PolicyDocument } from "./types";

const DOCUMENTS_FILE = "documents.jsonl";
const CHUNKS_FILE = "chunks.jsonl";
const MANIFEST_FILE = "manifest.json";

export function getKnowledgeBasePath(outputDir?: string): string {
  if (outputDir) {
    return path.resolve(outputDir);
  }

  if (process.env.KNOWLEDGE_BASE_PATH) {
    return path.resolve(process.env.KNOWLEDGE_BASE_PATH);
  }

  const storagePath = getGlobalState("globalStoragePath") || path.resolve(process.cwd(), "storage");
  return path.join(path.dirname(storagePath), "knowledge-base");
}

export function createStableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function resetKnowledgeBase(outputDir: string): void {
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

export function ensureKnowledgeBase(outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
}

export function writeKnowledgeBase(
  outputDir: string,
  documents: PolicyDocument[],
  chunks: PolicyChunk[],
  summary: CrawlSummary,
): void {
  ensureKnowledgeBase(outputDir);
  writeFileSync(path.join(outputDir, DOCUMENTS_FILE), toJsonl(documents), "utf-8");
  writeFileSync(path.join(outputDir, CHUNKS_FILE), toJsonl(chunks), "utf-8");
  writeFileSync(path.join(outputDir, MANIFEST_FILE), JSON.stringify(summary, null, 2), "utf-8");
}

export function loadPolicyChunks(outputDir = getKnowledgeBasePath()): PolicyChunk[] {
  const chunksPath = path.join(outputDir, CHUNKS_FILE);
  if (!existsSync(chunksPath)) {
    return [];
  }

  return readJsonl<PolicyChunk>(chunksPath);
}

export function loadPolicyDocuments(outputDir = getKnowledgeBasePath()): PolicyDocument[] {
  const documentsPath = path.join(outputDir, DOCUMENTS_FILE);
  if (!existsSync(documentsPath)) {
    return [];
  }

  return readJsonl<PolicyDocument>(documentsPath);
}

export function loadCrawlSummary(outputDir = getKnowledgeBasePath()): CrawlSummary | null {
  const manifestPath = path.join(outputDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(readFileSync(manifestPath, "utf-8")) as CrawlSummary;
}

export function chunkDocument(document: PolicyDocument): PolicyChunk[] {
  const maxLength = 900;
  const overlap = 120;
  const chunks: PolicyChunk[] = [];

  for (let start = 0; start < document.content.length; start += maxLength - overlap) {
    const end = Math.min(start + maxLength, document.content.length);
    const chunk = document.content.slice(start, end).trim();
    if (chunk.length < 80) {
      continue;
    }

    chunks.push({
      id: `${document.id}-${chunks.length + 1}`,
      documentId: document.id,
      sourceId: document.sourceId,
      sourceName: document.sourceName,
      title: document.title,
      url: document.url,
      publishedAt: document.publishedAt,
      crawledAt: document.crawledAt,
      chunk,
      charStart: start,
      charEnd: end,
    });

    if (end >= document.content.length) {
      break;
    }
  }

  return chunks;
}

function toJsonl<T>(items: T[]): string {
  return `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;
}

function readJsonl<T>(filePath: string): T[] {
  return readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}
