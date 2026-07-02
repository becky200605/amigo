import { Database, ExternalLink, FileText, Loader2, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface KnowledgeSource {
  id: string;
  name: string;
  startUrls: string[];
  allowedHosts: string[];
}

interface KnowledgeDocument {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  publishedAt?: string;
  crawledAt: string;
}

interface KnowledgeSummary {
  startedAt: string;
  finishedAt: string;
  documents: number;
  chunks: number;
  sources: Array<{
    id: string;
    name: string;
    fetched: number;
    saved: number;
    skipped: number;
    failed: number;
  }>;
}

interface KnowledgeBaseResponse {
  summary: KnowledgeSummary | null;
  sources: KnowledgeSource[];
  documents: KnowledgeDocument[];
}

interface KnowledgeBasePanelProps {
  open: boolean;
  onClose: () => void;
}

const getApiBaseUrl = () => {
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return `http://${window.location.hostname}:10013`;
  }

  return window.location.origin;
};

const formatDate = (value?: string) => {
  if (!value) return "未标注";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

const KnowledgeBasePanel = ({ open, onClose }: KnowledgeBasePanelProps) => {
  const [data, setData] = useState<KnowledgeBaseResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKnowledgeBase = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${getApiBaseUrl()}/api/knowledge-base`);
      if (!response.ok) {
        throw new Error(`知识库读取失败：${response.status}`);
      }
      const payload = (await response.json()) as KnowledgeBaseResponse;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "知识库读取失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !data && !isLoading) {
      void fetchKnowledgeBase();
    }
  }, [data, fetchKnowledgeBase, isLoading, open]);

  const sourceStats = useMemo(() => {
    const stats = new Map<string, KnowledgeSummary["sources"][number]>();
    data?.summary?.sources.forEach((source) => {
      stats.set(source.id, source);
    });
    return stats;
  }, [data]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex justify-start bg-black/20" onClick={onClose}>
      <section
        className="h-full w-full max-w-[520px] bg-[#fffaf2] border-r border-red-200 shadow-2xl flex flex-col"
        aria-label="知识库"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="h-16 px-5 border-b border-red-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
              <Database size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-gray-900">政策知识库</h2>
              <p className="text-xs text-gray-500 truncate">
                {data?.summary
                  ? `${data.summary.documents} 条政策，${data.summary.chunks} 个片段`
                  : "查看爬虫收录的政策和网站"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void fetchKnowledgeBase()}
              className="w-8 h-8 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition-colors"
              title="刷新"
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition-colors"
              title="关闭"
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading && !data ? (
            <div className="h-40 flex items-center justify-center text-sm text-gray-500 gap-2">
              <Loader2 size={17} className="animate-spin" />
              正在读取知识库
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <div className="space-y-5">
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[13px] font-semibold text-gray-900">来源网站</h3>
                  {data?.summary?.finishedAt && (
                    <span className="text-[11px] text-gray-500">
                      更新于 {formatDate(data.summary.finishedAt)}
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  {data?.sources.map((source) => {
                    const stats = sourceStats.get(source.id);
                    return (
                      <div
                        key={source.id}
                        className="rounded-lg border border-red-100 bg-white/80 px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">
                              {source.name}
                            </div>
                            <div className="text-[11px] text-gray-500 mt-0.5 truncate">
                              {source.allowedHosts.join("、")}
                            </div>
                          </div>
                          {stats && (
                            <span className="text-[11px] text-red-600 bg-red-50 rounded px-2 py-1 shrink-0">
                              收录 {stats.saved}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 space-y-1">
                          {source.startUrls.slice(0, 3).map((url) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 text-[12px] text-blue-700 hover:text-blue-900 min-w-0"
                            >
                              <ExternalLink size={12} className="shrink-0" />
                              <span className="truncate">{url}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section>
                <h3 className="text-[13px] font-semibold text-gray-900 mb-2">已收录政策</h3>
                <div className="space-y-2">
                  {data?.documents.map((document) => (
                    <a
                      key={document.id}
                      href={document.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg border border-gray-200 bg-white/90 px-3 py-3 hover:border-red-200 hover:bg-red-50/40 transition-colors"
                    >
                      <div className="flex items-start gap-2.5">
                        <FileText size={16} className="text-red-500 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-900 leading-5">
                            {document.title}
                          </div>
                          <div className="mt-1 text-[11px] text-gray-500 flex flex-wrap gap-x-2 gap-y-1">
                            <span>{document.sourceName}</span>
                            <span>发布日期：{formatDate(document.publishedAt)}</span>
                          </div>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default KnowledgeBasePanel;
