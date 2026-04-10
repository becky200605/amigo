import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/utils/toast";

export type VoiceRecorderStatus = "idle" | "recording" | "transcribing";

const MAX_RECORDING_SECONDS = 60;

function deriveTranscribeUrl(wsUrl: string): string {
  const httpUrl = wsUrl.replace(/^ws(s?):\/\//, "http$1://");
  return `${httpUrl}/api/transcribe`;
}

export interface UseVoiceRecorderOptions {
  wsUrl?: string;
}

export function useVoiceRecorder(options?: UseVoiceRecorderOptions) {
  const { wsUrl = "ws://localhost:10013" } = options || {};

  const [status, setStatus] = useState<VoiceRecorderStatus>("idle");
  const [recordingDuration, setRecordingDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const transcribeUrl = deriveTranscribeUrl(wsUrl);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  // 将 Blob 转为 base64
  const blobToBase64 = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, []);

  // base64 编码后发给服务端，服务端构造 Data URL 调 Qwen ASR
  const sendForTranscription = useCallback(
    async (audioBlob: Blob): Promise<string> => {
      const base64Audio = await blobToBase64(audioBlob);
      const mimeType = audioBlob.type;
      let format = "webm";
      if (mimeType.includes("ogg")) format = "ogg";
      else if (mimeType.includes("mp4") || mimeType.includes("m4a")) format = "m4a";
      else if (mimeType.includes("wav")) format = "wav";

      const response = await fetch(transcribeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64Audio, format }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error || `Transcription failed: ${response.status}`);
      }

      const data = (await response.json()) as { text: string };
      return data.text;
    },
    [blobToBase64, transcribeUrl],
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
            ? "audio/ogg;codecs=opus"
            : "audio/mp4";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(100);
      setStatus("recording");
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      maxTimerRef.current = setTimeout(() => {
        toast.warning(`录音已达到最大时长 ${MAX_RECORDING_SECONDS} 秒`);
        stopRecording();
      }, MAX_RECORDING_SECONDS * 1000);
    } catch (error: any) {
      console.error("[VoiceRecorder] 获取麦克风权限失败:", error);
      if (error.name === "NotAllowedError") {
        toast.error("麦克风权限被拒绝，请在浏览器设置中允许访问麦克风");
      } else if (error.name === "NotFoundError") {
        toast.error("未检测到麦克风设备");
      } else {
        toast.error("无法启动录音: " + error.message);
      }
      setStatus("idle");
    }
  }, []);

  const stopRecording = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      const mediaRecorder = mediaRecorderRef.current;
      if (!mediaRecorder || mediaRecorder.state === "inactive") {
        setStatus("idle");
        resolve("");
        return;
      }

      clearTimers();

      mediaRecorder.onstop = async () => {
        cleanupStream();

        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType,
        });
        audioChunksRef.current = [];

        if (audioBlob.size < 1000) {
          toast.warning("录音时间太短，请重试");
          setStatus("idle");
          setRecordingDuration(0);
          resolve("");
          return;
        }

        setStatus("transcribing");

        try {
          const text = await sendForTranscription(audioBlob);
          setStatus("idle");
          setRecordingDuration(0);
          resolve(text);
        } catch (error: any) {
          console.error("[VoiceRecorder] 转录失败:", error);
          toast.error("语音转录失败: " + error.message);
          setStatus("idle");
          setRecordingDuration(0);
          reject(error);
        }
      };

      mediaRecorder.stop();
    });
  }, [clearTimers, cleanupStream, sendForTranscription]);

  const cancelRecording = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    clearTimers();
    cleanupStream();
    audioChunksRef.current = [];
    setStatus("idle");
    setRecordingDuration(0);
  }, [clearTimers, cleanupStream]);

  useEffect(() => {
    return () => {
      cancelRecording();
    };
  }, [cancelRecording]);

  const formattedDuration = `${String(Math.floor(recordingDuration / 60)).padStart(2, "0")}:${String(recordingDuration % 60).padStart(2, "0")}`;

  return {
    status,
    recordingDuration,
    formattedDuration,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
