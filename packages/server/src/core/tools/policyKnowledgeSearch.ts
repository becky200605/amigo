import { searchPolicyKnowledge } from "@/core/knowledge/search";
import { loadCrawlSummary } from "@/core/knowledge/store";
import { createTool } from "./base";

export const PolicyKnowledgeSearch = createTool({
  name: "policyKnowledgeSearch",
  description: "检索本地政策知识库，返回可溯源的政策、办事指南、社区服务和相关新闻片段。",
  whenToUse:
    "当用户询问养老、高龄津贴、低保、社保、医保、就业、社区服务、政府政策、办事指南等问题时，必须优先使用此工具。" +
    "回答时只能基于检索结果中的内容组织结论；每条关键结论都要附来源标题和 URL。若没有检索结果，应明确说明知识库未找到可靠依据，不要编造政策。",
  useExamples: [
    `<policyKnowledgeSearch>
  <query>武昌区高龄津贴怎么办理</query>
  <limit>5</limit>
</policyKnowledgeSearch>`,
    `<policyKnowledgeSearch>
  <query>就业困难人员社保补贴</query>
  <source>wuchang-human-social</source>
</policyKnowledgeSearch>`,
  ],
  params: [
    {
      name: "query",
      optional: false,
      description: "用户的政策、民生服务或办事指南问题",
    },
    {
      name: "limit",
      optional: true,
      description: "返回的片段数量，默认 5，最多 10",
    },
    {
      name: "source",
      optional: true,
      description: "可选数据源过滤：wuchang-human-social、wuchang-grassroots、hubei-daily",
    },
  ],

  async invoke({ params }) {
    const limit = Number(params.limit || 5);
    const results = searchPolicyKnowledge(params.query, {
      limit,
      sourceId: params.source,
    });
    const summary = loadCrawlSummary();

    if (results.length === 0) {
      return {
        message:
          "政策知识库未检索到可用依据。请告知用户当前知识库没有找到可靠来源，必要时建议换一种关键词或更新爬虫数据。",
        toolResult: {
          query: params.query,
          total: summary?.documents || 0,
          results: [],
        },
      };
    }

    const formatted = results
      .map(
        (result, index) =>
          `${index + 1}. ${result.title}\n来源：${result.sourceName}\n链接：${result.url}\n发布日期：${result.publishedAt || "未标明"}\n摘录：${result.chunk}`,
      )
      .join("\n\n");

    return {
      message: `政策知识库命中 ${results.length} 条片段。回答用户时必须引用以下来源标题和链接：\n\n${formatted}`,
      toolResult: {
        query: params.query,
        total: summary?.documents || results.length,
        results,
      },
    };
  },
});
