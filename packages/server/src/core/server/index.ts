import { mkdirSync } from "node:fs";
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
import { setGlobalState } from "@/globalState";
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
  private storagePath: string;
  private _toolRegistry?: ToolRegistry;
  private _messageRegistry?: MessageRegistry;

  constructor(options: AmigoServerOptions) {
    this.port = options.config.port;
    this.storagePath = options.config.storagePath;
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
    mkdirSync(this.storagePath, { recursive: true });
    Bun.serve({
      fetch: async (req: Request, server: Bun.Server) => {
        const url = new URL(req.url);

        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        if (req.method === "OPTIONS") {
          return new Response(null, { headers: corsHeaders });
        }

        if (url.pathname === "/api/transcribe" && req.method === "POST") {
          try {
            const body = (await req.json()) as { audio: string; format: string };
            const { audio, format } = body;

            if (!audio || !format) {
              return new Response(
                JSON.stringify({ error: "Missing required fields: audio, format" }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json", ...corsHeaders },
                },
              );
            }

            const text = await transcribeAudio(audio, format);
            return new Response(JSON.stringify({ text }), {
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error("[Server] Transcription request failed:", error);
            return new Response(JSON.stringify({ error: err.message || "Transcription failed" }), {
              status: 500,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
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
          let parsedMessage: WebSocketMessage<USER_SEND_MESSAGE_NAME> | undefined;

          try {
            parsedMessage = JSON.parse(message) as WebSocketMessage<USER_SEND_MESSAGE_NAME>;

            const taskId =
              parsedMessage.type === "createTask"
                ? uuidV4()
                : (parsedMessage.data as { taskId?: string }).taskId?.trim() || uuidV4();

            if (parsedMessage.type === "loadTask") {
              const conversation = conversationRepository.load(taskId);

              if (!conversation) {
                this.sendError(ws, `Task ${taskId} does not exist`, undefined, "TASK_NOT_FOUND");
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

              const resolver = getResolver(parsedMessage.type, conversation);
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

            const resolver = getResolver(parsedMessage.type, conversation);
            await resolver.process(parsedMessage.data);
          } catch (error) {
            logger.error("Failed to process WebSocket message", error);
            const err = error instanceof Error ? error : new Error(String(error));
            const isMissingModelApiKey = err.message.includes("MODEL_API_KEY");
            const message = isMissingModelApiKey
              ? "MODEL_API_KEY is not configured. Create packages/server/.env and set MODEL_API_KEY, then restart the server."
              : `Server failed to process message: ${err.message}`;
            const details = parsedMessage
              ? `messageType=${parsedMessage.type}`
              : "Failed before the WebSocket message could be parsed.";

            this.sendError(ws, message, details);
          }
        },

        open: async (ws: ServerWebSocket) => {
          ws.send(
            JSON.stringify({
              type: "connected",
              data: {
                message: "Connected",
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
          if (!conversationId) {
            return;
          }

          broadcaster.removeConnection(conversationId, ws);

          const conversation = conversationRepository.get(conversationId);
          const isLastConnection = broadcaster.getConnectionCount(conversationId) === 0;
          const notInterruptableStatusList: ConversationStatus[] = [
            "completed",
            "waiting_tool_confirmation",
            "idle",
            "error",
            "aborted",
          ];
          const isActiveStatus = !notInterruptableStatusList.includes(
            conversation?.status as ConversationStatus,
          );

          if (isLastConnection && isActiveStatus && conversation) {
            taskOrchestrator.interrupt(conversation);
          }
        },

        drain: () => {},
      },
    });
  }

  private sendError(ws: ServerWebSocket, message: string, details?: string, code?: string): void {
    ws.send(
      JSON.stringify({
        type: "error",
        data: {
          message,
          details,
          code,
          updateTime: Date.now(),
        },
      }),
    );
  }
}

export default AmigoServer;
