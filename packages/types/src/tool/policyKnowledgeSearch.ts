import { z } from "zod";

export const PolicyKnowledgeSearchSchema = z.object({
  name: z.literal("policyKnowledgeSearch"),
  params: z
    .object({
      query: z.string().describe("用户的政策、办事指南、社区服务等问题"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("返回的溯源片段数量，默认 5，最多 10"),
      source: z
        .string()
        .optional()
        .describe("可选的数据源过滤，例如 wuchang-human-social、wuchang-grassroots、hubei-daily"),
    })
    .describe("政策知识库检索参数"),
  result: z
    .object({
      query: z.string(),
      total: z.number(),
      results: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          url: z.string(),
          sourceId: z.string(),
          sourceName: z.string(),
          publishedAt: z.string().optional(),
          crawledAt: z.string(),
          chunk: z.string(),
          score: z.number(),
        }),
      ),
    })
    .describe("带来源链接的政策知识库检索结果"),
});
