import type { PolicySourceConfig } from "./types";

const WUCHANG_DISCOVERY_URLS = [
  "https://www.wuchang.gov.cn/",
  "https://www.wuchang.gov.cn/zwgk_37/fdzdgknr/bmlx/",
];

export const DEFAULT_POLICY_SOURCES: PolicySourceConfig[] = [
  {
    id: "wuchang-human-social",
    name: "武昌区政府人社与社会保障栏目",
    startUrls: [
      "https://www.wuchang.gov.cn/zwgk_37/fdzdgknr/shgysy/shjz/",
      "https://www.wuchang.gov.cn/zwgk_37/fdzdgknr/shgysy/jy/",
      ...WUCHANG_DISCOVERY_URLS,
    ],
    allowedHosts: ["www.wuchang.gov.cn", "wuchang.gov.cn"],
    includeKeywords: [
      "人社",
      "社会保障",
      "社会保险",
      "社保",
      "医保",
      "养老",
      "老年",
      "高龄",
      "补贴",
      "救助",
      "低保",
      "特困",
      "退休",
      "就业",
      "办事指南",
    ],
    maxPages: 120,
    maxDepth: 4,
  },
  {
    id: "wuchang-grassroots",
    name: "武昌区基层政务公开专栏",
    startUrls: WUCHANG_DISCOVERY_URLS,
    allowedHosts: ["www.wuchang.gov.cn", "wuchang.gov.cn"],
    includeKeywords: [
      "基层政务公开",
      "事项标准目录",
      "法定主动公开内容",
      "社会保障",
      "养老",
      "救助",
      "就业",
      "医疗保障",
      "惠民",
      "补贴",
      "办事指南",
    ],
    maxPages: 120,
    maxDepth: 4,
  },
  {
    id: "hubei-daily",
    name: "湖北日报新闻客户端",
    startUrls: ["https://news.hubeidaily.net/"],
    allowedHosts: ["news.hubeidaily.net"],
    includeKeywords: [
      "武汉",
      "武昌",
      "社区",
      "养老",
      "老年",
      "民生",
      "政策",
      "社保",
      "医保",
      "就业",
      "救助",
    ],
    maxPages: 80,
    maxDepth: 3,
  },
];

export function getPolicySources(sourceIds?: string[]): PolicySourceConfig[] {
  if (!sourceIds || sourceIds.length === 0) {
    return DEFAULT_POLICY_SOURCES;
  }

  const ids = new Set(sourceIds);
  return DEFAULT_POLICY_SOURCES.filter((source) => ids.has(source.id));
}
