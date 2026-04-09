import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type {
  ConversationStatus,
  USER_SEND_MESSAGE_NAME,
  WebSocketMessage,
} from "@amigo-llm/types";
import Bun, { type ServerWebSocket } from "bun";
import { v4 as uuidV4 } from "uuid";
import { broadcaster, conversationRepository, taskOrchestrator } from "@/core/conversation";
import { getResolver } from "@/core/messageResolver";
import { transcribeAudio } from "@/core/transcribe";
import { getGlobalState, setGlobalState } from "@/globalState";
import { getSessionHistories } from "@/utils/getSessions";
import { logger } from "@/utils/logger";
import type { ServerConfig } from "../config";
import type { MessageRegistry, ToolRegistry } from "../registry";

export interface AmigoServerOptions {
  config: ServerConfig;
  toolRegistry?: ToolRegistry;
  messageRegistry?: MessageRegistry;
}

class AmigoServer {
  private port: number;
  private _toolRegistry?: ToolRegistry;
  private _messageRegistry?: MessageRegistry;

  constructor(options: AmigoServerOptions) {
    this.port = options.config.port;
    setGlobalState("globalStoragePath", options.config.storagePath);
    this._toolRegistry = options.toolRegistry;
    this._messageRegistry = options.messageRegistry;

    if (options.toolRegistry) {
      setGlobalState("registryTools", options.toolRegistry.getAll());
    }
    if (options.messageRegistry) {
      setGlobalState("registryMessages", options.messageRegistry.getAll());
    }
  }

  get toolRegistry(): ToolRegistry | undefined {
    return this._toolRegistry;
  }

  get messageRegistry(): MessageRegistry | undefined {
    return this._messageRegistry;
  }

  init() {
    const port = this.port;

    Bun.serve({
      fetch: async (req: any, server: any) => {
        const url = new URL(req.url);

        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        if (req.method === "OPTIONS") {
          return new Response(null, { headers: corsHeaders });
        }

        // 音频上传：接收 multipart/form-data，保存到本地，返回公网 URL
        if (url.pathname === "/api/upload-audio" && req.method === "POST") {
          try {
            const storagePath = getGlobalState("globalStoragePath");
            const audioDir = path.join(storagePath, "audio-temp");
            if (!existsSync(audioDir)) mkdirSync(audioDir, { recursive: true });

            const formData = await req.formData();
            const file = formData.get("file") as File | null;
            if (!file) {
              return new Response(JSON.stringify({ error: "Missing file field" }), {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              });
            }

            const ext = file.name.split(".").pop() || "webm";
            const filename = `${uuidV4()}.${ext}`;
            const filePath = path.join(audioDir, filename);
            await Bun.write(filePath, await file.arrayBuffer());

            const publicBase = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
            const audioUrl = `${publicBase}/audio-temp/${filename}`;

            logger.info(`[Server] 音频已上传: ${audioUrl}`);
            return new Response(JSON.stringify({ url: audioUrl }), {
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          } catch (error: any) {
            logger.error("[Server] 音频上传失败:", error);
            return new Response(JSON.stringify({ error: error.message || "Upload failed" }), {
              status: 500,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }
        }

        // 静态文件服务：提供已上传的音频文件
        if (url.pathname.startsWith("/audio-temp/") && req.method === "GET") {
          const storagePath = getGlobalState("globalStoragePath");
          const filename = path.basename(url.pathname);
          const filePath = path.join(storagePath, "audio-temp", filename);
          const bunFile = Bun.file(filePath);
          if (!(await bunFile.exists())) {
            return new Response("Not found", { status: 404 });
          }
          return new Response(bunFile, { headers: corsHeaders });
        }

        // 转录：接收公网 URL，调用 Qwen ASR
        if (url.pathname === "/api/transcribe" && req.method === "POST") {
          try {
            const body = (await req.json()) as { url: string };
            const { url: audioUrl } = body;

            if (!audioUrl) {
              return new Response(JSON.stringify({ error: "Missing required field: url" }), {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              });
            }

            const text = await transcribeAudio(audioUrl);
            return new Response(JSON.stringify({ text }), {
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          } catch (error: any) {
            logger.error("[Server] 转录请求处理失败:", error);
            return new Response(
              JSON.stringify({ error: error.message || "Transcription failed" }),
              {
                status: 500,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              },
            );
          }
        }

        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not found", { status: 404 });
      },
      port: this.port,
      websocket: {
        message: async (ws: ServerWebSocket, message: string) => {
          try {
            const parsedMessage = JSON.parse(message) as WebSocketMessage<USER_SEND_MESSAGE_NAME>;

            let taskId: string;
            if (parsedMessage.type === "createTask") {
              taskId = uuidV4();
            } else {
              taskId = (parsedMessage.data as any).taskId?.trim() || uuidV4();
            }

            if (parsedMessage.type === "loadTask") {
              const conversation = conversationRepository.load(taskId);

              if (!conversation) {
                logger.warn(`[Server] 任务不存在: ${taskId}`);
                ws.send(
                  JSON.stringify({
                    type: "error",
                    data: {
                      message: `任务 ${taskId} 不存在`,
                      code: "TASK_NOT_FOUND",
                      updateTime: Date.now(),
                    },
                  } as WebSocketMessage<"error">),
                );
                return;
              }

              if (!broadcaster.hasConnection(taskId, ws)) {
                broadcaster.addConnection(taskId, ws);
              }

              broadcaster.broadcast(taskId, {
                type: "ack",
                data: {
                  taskId,
                  targetMessage: parsedMessage,
                  status: conversation.status === "streaming" ? "failed" : "acked",
                },
              });

              const resolver = getResolver(
                parsedMessage.type as USER_SEND_MESSAGE_NAME,
                conversation,
              );
              await resolver.process(parsedMessage.data);
              return;
            }

            const conversation = conversationRepository.getOrLoad(taskId);

            if (!broadcaster.hasConnection(taskId, ws)) {
              broadcaster.addConnection(taskId, ws);
            }

            broadcaster.broadcast(taskId, {
              type: "ack",
              data: {
                taskId,
                targetMessage: parsedMessage,
                status: conversation.status === "streaming" ? "failed" : "acked",
              },
            });

            const resolver = getResolver(
              parsedMessage.type as USER_SEND_MESSAGE_NAME,
              conversation,
            );
            await resolver.process(parsedMessage.data);
          } catch (error) {
            logger.error("处理消息时出错:", error);
          }
        },

        open: async (ws: ServerWebSocket) => {
          ws.send(
            JSON.stringify({
              type: "connected",
              data: {
                message: "连接建立",
                updateTime: Date.now(),
              },
            } as WebSocketMessage<"connected">),
          );

          ws.send(
            JSON.stringify({
              type: "sessionHistories",
              data: {
                sessionHistories: await getSessionHistories(),
              },
            } as WebSocketMessage<"sessionHistories">),
          );
        },

        close: (ws: ServerWebSocket) => {
          const conversationId = broadcaster.findConversationIdByWs(ws);
          if (conversationId) {
            broadcaster.removeConnection(conversationId, ws);

            const conversation = conversationRepository.get(conversationId);
            const isLastConnection = broadcaster.getConnectionCount(conversationId) === 0;
            const NotInterruptableStatusList: ConversationStatus[] = [
              "completed",
              "waiting_tool_confirmation",
              "idle",
              "error",
              "aborted",
            ];
            const isActiveStatus = !NotInterruptableStatusList.includes(
              conversation?.status as ConversationStatus,
            );

            if (isLastConnection && isActiveStatus && conversation) {
              taskOrchestrator.interrupt(conversation);
            }
          }
        },

        drain: () => {},
      },
    });
  }
}

export default AmigoServer;
