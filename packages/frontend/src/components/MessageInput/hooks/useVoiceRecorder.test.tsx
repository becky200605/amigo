import "../../../sdk/provider/__tests__/setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useVoiceRecorder } from "./useVoiceRecorder";

class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }

  state: RecordingState = "inactive";
  readonly mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType || "audio/webm";
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    const data = new Blob([new Uint8Array(1_200)], { type: this.mimeType });
    this.ondataavailable?.({ data } as BlobEvent);
    this.onstop?.();
  }
}

class FakeFileReader {
  result: string | ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL() {
    this.result = "data:audio/webm;base64,ZmFrZQ==";
    queueMicrotask(() => this.onloadend?.());
  }
}

describe("useVoiceRecorder", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalFileReader = globalThis.FileReader;
  const originalFetch = globalThis.fetch;
  const originalMediaDevices = Object.getOwnPropertyDescriptor(
    globalThis.navigator,
    "mediaDevices",
  );

  beforeEach(() => {
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => undefined }],
        }),
      },
    });
    globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
    globalThis.FileReader = FakeFileReader as unknown as typeof FileReader;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ text: "自动转录结果" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    globalThis.setTimeout = ((
      callback: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => originalSetTimeout(callback, delay === 60_000 ? 0 : delay, ...args)) as typeof setTimeout;
  });

  afterEach(() => {
    cleanup();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.MediaRecorder = originalMediaRecorder;
    globalThis.FileReader = originalFileReader;
    globalThis.fetch = originalFetch;
    if (originalMediaDevices) {
      Object.defineProperty(globalThis.navigator, "mediaDevices", originalMediaDevices);
    } else {
      Reflect.deleteProperty(globalThis.navigator, "mediaDevices");
    }
  });

  test("publishes the transcription when the maximum duration stops recording", async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.startRecording();
    });

    await waitFor(() => {
      expect(result.current.transcribedText).toBe("自动转录结果");
    });
    expect(result.current.status).toBe("idle");
  });
});
