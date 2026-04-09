import { logger } from "@/utils/logger";

/**
 * 调用 Qwen ASR API (OpenAI compatible 模式) 进行音频转录
 * 接受公网可访问的音频 URL
 * 文档: https://www.alibabacloud.com/help/en/model-studio/qwen-speech-recognition
 */
export async function transcribeAudio(audioUrl: string): Promise<string> {
  const apiKey = process.env.STT_API_KEY || process.env.MODEL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "STT_API_KEY or MODEL_API_KEY environment variable is required for transcription",
    );
  }

  // 国际/新加坡区: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
  // 中国大陆区:   https://dashscope.aliyuncs.com/compatible-mode/v1
  const baseUrl =
    process.env.STT_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  const model = process.env.STT_MODEL_NAME || "qwen3-asr-flash";

  logger.info(`[Transcribe] 开始转录音频, URL: ${audioUrl}, 模型: ${model}`);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: {
                data: audioUrl,
              },
            },
          ],
        },
      ],
      asr_options: {
        enable_itn: false,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`[Transcribe] Qwen ASR API 错误: ${response.status} ${errorText}`);
    throw new Error(`Transcription API error: ${response.status} ${errorText}`);
  }

  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!result.choices?.[0]?.message?.content) {
    logger.error("[Transcribe] 转录结果为空", JSON.stringify(result));
    throw new Error("Transcription returned empty result");
  }

  const transcribedText = result.choices[0].message.content.trim();
  logger.info(`[Transcribe] 转录完成, 文字长度: ${transcribedText.length}`);

  return transcribedText;
}
