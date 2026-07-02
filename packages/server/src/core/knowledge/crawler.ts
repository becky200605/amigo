import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { containsKeyword, extractLinks, extractPolicyDocument, isAllowedUrl } from "./html";
import { getPolicySources } from "./sources";
import {
  chunkDocument,
  createStableId,
  getKnowledgeBasePath,
  resetKnowledgeBase,
  writeKnowledgeBase,
} from "./store";
import type {
  CrawlOptions,
  CrawlSummary,
  PolicyChunk,
  PolicyDocument,
  PolicySourceConfig,
} from "./types";

interface QueueItem {
  url: string;
  depth: number;
}

const USER_AGENT =
  "AmigoPolicyKnowledgeBot/1.0 (+https://www.wuchang.gov.cn/; community policy QA crawler)";

export async function crawlPolicyKnowledge(options: CrawlOptions = {}): Promise<CrawlSummary> {
  const outputDir = getKnowledgeBasePath(options.outputDir);
  const sources = getPolicySources(options.sourceIds);
  const startedAt = new Date().toISOString();
  const documents = new Map<string, PolicyDocument>();
  const allChunks: PolicyChunk[] = [];
  const sourceSummaries: CrawlSummary["sources"] = [];

  if (options.reset) {
    resetKnowledgeBase(outputDir);
  }

  for (const source of sources) {
    const sourceResult = await crawlSource(source, options, documents);
    sourceSummaries.push(sourceResult);
  }

  for (const document of documents.values()) {
    allChunks.push(...chunkDocument(document));
  }

  const summary: CrawlSummary = {
    outputDir,
    startedAt,
    finishedAt: new Date().toISOString(),
    sources: sourceSummaries,
    documents: documents.size,
    chunks: allChunks.length,
  };

  if (!options.dryRun) {
    writeKnowledgeBase(outputDir, [...documents.values()], allChunks, summary);
  }

  return summary;
}

async function crawlSource(
  source: PolicySourceConfig,
  options: CrawlOptions,
  documents: Map<string, PolicyDocument>,
): Promise<CrawlSummary["sources"][number]> {
  const maxPages = options.maxPagesPerSource || source.maxPages;
  const discoveredUrls = await discoverSourceUrls(source);
  const queue: QueueItem[] = [...source.startUrls, ...discoveredUrls].map((url) => ({
    url,
    depth: 0,
  }));
  const visited = new Set<string>();
  const summary = {
    id: source.id,
    name: source.name,
    fetched: 0,
    saved: 0,
    skipped: 0,
    failed: 0,
  };

  while (queue.length > 0 && summary.fetched < maxPages) {
    const item = queue.shift();
    if (!item || visited.has(item.url) || !isAllowedUrl(item.url, source)) {
      continue;
    }

    visited.add(item.url);
    let html = "";

    try {
      html = await fetchHtml(item.url);
      summary.fetched += 1;
    } catch {
      summary.failed += 1;
      continue;
    }

    const crawledAt = new Date().toISOString();
    const extracted = extractPolicyDocument(html, item.url, source, crawledAt);
    if (extracted) {
      const id = createStableId(extracted.url);
      if (!documents.has(id)) {
        documents.set(id, { id, ...extracted });
        summary.saved += 1;
      }
    } else {
      summary.skipped += 1;
    }

    if (item.depth < source.maxDepth) {
      for (const link of extractLinks(html, item.url)) {
        if (shouldVisit(link.url, link.text, source, visited, item.depth)) {
          queue.push({ url: link.url, depth: item.depth + 1 });
        }
      }
    }

    await delay(Number(process.env.KNOWLEDGE_CRAWL_DELAY_MS || 300));
  }

  return summary;
}

async function discoverSourceUrls(source: PolicySourceConfig): Promise<string[]> {
  if (source.id !== "hubei-daily") {
    return [];
  }

  const urls = new Set<string>();
  for (let pageNo = 0; pageNo < 3; pageNo++) {
    try {
      const list = await fetchHubeiDailyList(pageNo);
      for (const item of list) {
        const url = normalizeHubeiDailyUrl(item.pcUrl || item.shareUrl || item.mobileUrl || "");
        const searchable = `${item.title || ""} ${item.summary || ""}`;
        if (url && containsKeyword(searchable, source.includeKeywords)) {
          urls.add(url);
        }
      }
    } catch {}
  }

  return [...urls];
}

interface HubeiDailyContentItem {
  title?: string;
  summary?: string;
  pcUrl?: string;
  mobileUrl?: string;
  shareUrl?: string;
}

async function fetchHubeiDailyList(pageNo: number): Promise<HubeiDailyContentItem[]> {
  const requestTime = Date.now().toString();
  const firstHash = md5(`hbrb-app-amc$${requestTime}`);
  const token = md5(`h5Client-id$${firstHash}$${requestTime}`);
  const body = new URLSearchParams({
    column: "1476",
    deviceId: "h5Client-id",
    focusNo: "5",
    pageNo: pageNo.toString(),
    pageSize: "30",
  });

  const response = await fetch("https://hbrbapi.hubeidaily.net/amc/client/listContentByColumn", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      requestTime,
      token,
      "user-agent": USER_AGENT,
    },
    body,
    signal: AbortSignal.timeout(Number(process.env.KNOWLEDGE_CRAWL_TIMEOUT_MS || 15000)),
  });

  if (!response.ok) {
    throw new Error(`Hubei Daily API failed ${response.status}`);
  }

  const payload = (await response.json()) as {
    suc?: number;
    data?: { contentList?: HubeiDailyContentItem[]; focusList?: HubeiDailyContentItem[] };
  };

  if (payload.suc !== 1 || !payload.data) {
    return [];
  }

  return [...(payload.data.focusList || []), ...(payload.data.contentList || [])];
}

function normalizeHubeiDailyUrl(url: string): string {
  if (!url || url.startsWith("javascript:")) {
    return "";
  }

  try {
    return new URL(url, "https://news.hubeidaily.net/").toString();
  } catch {
    return "";
  }
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9",
    },
    signal: AbortSignal.timeout(Number(process.env.KNOWLEDGE_CRAWL_TIMEOUT_MS || 15000)),
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${url}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.includes("text/html")) {
    throw new Error(`Unsupported content type ${contentType}: ${url}`);
  }

  return response.text();
}

function shouldVisit(
  url: string,
  text: string,
  source: PolicySourceConfig,
  visited: Set<string>,
  currentDepth: number,
): boolean {
  if (visited.has(url) || !isAllowedUrl(url, source)) {
    return false;
  }

  const parsed = new URL(url);
  const searchable = `${decodeURIComponent(parsed.pathname)} ${parsed.search} ${text}`;
  if (source.id === "hubei-daily" && currentDepth === 0 && text.length >= 6) {
    return true;
  }

  return containsKeyword(searchable, source.includeKeywords) || source.startUrls.includes(url);
}
