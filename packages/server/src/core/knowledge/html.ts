import type { PolicyDocument, PolicySourceConfig } from "./types";

interface ExtractedLink {
  text: string;
  url: string;
}

const BLOCK_TAGS = /<(p|br|div|li|tr|h[1-6]|section|article|table|ul|ol)\b[^>]*>/gi;
const SKIP_URL_PATTERN =
  /\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|mp4|mp3|zip|rar|7z|doc|docx|xls|xlsx|ppt|pptx)$/i;

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripTags(html: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
        .replace(BLOCK_TAGS, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function pickFirstMatch(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      return stripTags(match[1]);
    }
  }
  return undefined;
}

function pickMainContent(html: string): string {
  const candidates: string[] = [];
  const selectorPatterns = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
    /<div\b[^>]*(?:class|id)=["'][^"']*(?:TRS_Editor|article|content|detail|main|text|zwgk|Custom_UnionStyle)["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<section\b[^>]*(?:class|id)=["'][^"']*(?:article|content|detail|main|text)["'][^>]*>([\s\S]*?)<\/section>/gi,
  ];

  for (const pattern of selectorPatterns) {
    let match = pattern.exec(html);
    while (match?.[1]) {
      const text = stripTags(match[1]);
      if (text.length > 80) {
        candidates.push(text);
      }
      match = pattern.exec(html);
    }
  }

  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] || html;
  candidates.push(stripTags(body));

  return candidates.sort((a, b) => b.length - a.length)[0] || "";
}

export function extractLinks(html: string, currentUrl: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match = linkPattern.exec(html);

  while (match) {
    const rawHref = decodeHtmlEntities(match[1] || "").trim();
    const text = stripTags(match[2] || "");
    match = linkPattern.exec(html);

    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) {
      continue;
    }

    try {
      const url = new URL(rawHref, currentUrl);
      url.hash = "";
      const normalizedUrl = url.toString();
      if (!SKIP_URL_PATTERN.test(url.pathname) && !seen.has(normalizedUrl)) {
        seen.add(normalizedUrl);
        links.push({ text, url: normalizedUrl });
      }
    } catch {}
  }

  return links;
}

export function extractPolicyDocument(
  html: string,
  url: string,
  source: PolicySourceConfig,
  crawledAt: string,
): Omit<PolicyDocument, "id"> | null {
  const title =
    pickFirstMatch(html, [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i, /<title\b[^>]*>([\s\S]*?)<\/title>/i]) ||
    url;
  const publishedAt = pickFirstMatch(html, [
    /(?:发布时间|发布日期|时间|日期)[：:\s]*<\/?[^>]*>\s*([0-9]{4}[-年./][0-9]{1,2}[-月./][0-9]{1,2})/i,
    /([0-9]{4}[-年./][0-9]{1,2}[-月./][0-9]{1,2})/,
  ]);
  const content = pickMainContent(html);
  const textForRelevance = `${title} ${content}`;

  if (content.length < 120 || !containsKeyword(textForRelevance, source.includeKeywords)) {
    return null;
  }

  return {
    sourceId: source.id,
    sourceName: source.name,
    title: normalizeWhitespace(title.replace(/\s*[-_]\s*武汉市武昌区人民政府\s*$/g, "")),
    url,
    publishedAt,
    crawledAt,
    content,
  };
}

export function containsKeyword(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

export function isAllowedUrl(url: string, source: PolicySourceConfig): boolean {
  try {
    const parsed = new URL(url);
    return source.allowedHosts.includes(parsed.host) && !SKIP_URL_PATTERN.test(parsed.pathname);
  } catch {
    return false;
  }
}
