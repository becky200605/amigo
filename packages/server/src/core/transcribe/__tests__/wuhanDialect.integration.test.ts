import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { transcribeAudio } from "../index";

dotenv.config({ path: path.resolve(import.meta.dir, "../../../../.env") });

interface WuhanDialectCase {
  name?: string;
  audioPath: string;
  expectedText: string;
  format?: string;
  minCharAccuracy?: number;
  minWordAccuracy?: number;
  maxLatencyMs?: number;
}

interface RecognitionMetrics {
  actualText: string;
  latencyMs: number;
  charAccuracy: number;
  wordAccuracy: number;
  charDistance: number;
  wordDistance: number;
}

const casesFile = process.env.WUHAN_ASR_CASES;
const defaultMinCharAccuracy = Number(process.env.WUHAN_ASR_MIN_CHAR_ACCURACY ?? 0.85);
const defaultMinWordAccuracy = Number(process.env.WUHAN_ASR_MIN_WORD_ACCURACY ?? 0.75);
const defaultMaxLatencyMs = Number(process.env.WUHAN_ASR_MAX_LATENCY_MS ?? 30_000);

const cases = casesFile ? loadCases(casesFile) : [];
const describeIfCases = cases.length > 0 ? describe : describe.skip;

describeIfCases("武汉话 ASR 集成测试", () => {
  for (const [index, testCase] of cases.entries()) {
    const caseName = testCase.name || `case-${index + 1}`;

    test(
      `${caseName}: 识别准确率和耗时达标`,
      async () => {
        const metrics = await transcribeCase(testCase, casesFile as string);

        console.info(
          JSON.stringify(
            {
              caseName,
              latencyMs: metrics.latencyMs,
              charAccuracy: Number(metrics.charAccuracy.toFixed(4)),
              wordAccuracy: Number(metrics.wordAccuracy.toFixed(4)),
              expectedText: testCase.expectedText,
              actualText: metrics.actualText,
            },
            null,
            2,
          ),
        );

        expect(metrics.charAccuracy).toBeGreaterThanOrEqual(
          testCase.minCharAccuracy ?? defaultMinCharAccuracy,
        );
        expect(metrics.wordAccuracy).toBeGreaterThanOrEqual(
          testCase.minWordAccuracy ?? defaultMinWordAccuracy,
        );
        expect(metrics.latencyMs).toBeLessThanOrEqual(
          testCase.maxLatencyMs ?? defaultMaxLatencyMs,
        );
      },
      (testCase.maxLatencyMs ?? defaultMaxLatencyMs) + 10_000,
    );
  }
});

function loadCases(filePath: string): WuhanDialectCase[] {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`WUHAN_ASR_CASES does not exist: ${resolvedPath}`);
  }

  const parsed = JSON.parse(readFileSync(resolvedPath, "utf-8")) as WuhanDialectCase[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("WUHAN_ASR_CASES must be a non-empty JSON array");
  }

  for (const [index, item] of parsed.entries()) {
    if (!item.audioPath || !item.expectedText) {
      throw new Error(`Case ${index + 1} must include audioPath and expectedText`);
    }
  }

  return parsed;
}

async function transcribeCase(
  testCase: WuhanDialectCase,
  caseFilePath: string,
): Promise<RecognitionMetrics> {
  const audioPath = resolveAudioPath(testCase.audioPath, caseFilePath);
  const format = testCase.format || path.extname(audioPath).replace(".", "").toLowerCase();
  const base64Audio = readFileSync(audioPath).toString("base64");

  const startedAt = performance.now();
  const actualText = await transcribeAudio(base64Audio, format);
  const latencyMs = Math.round(performance.now() - startedAt);

  return {
    actualText,
    latencyMs,
    ...compareRecognition(testCase.expectedText, actualText),
  };
}

function resolveAudioPath(audioPath: string, caseFilePath: string): string {
  if (path.isAbsolute(audioPath)) {
    return audioPath;
  }

  const caseDir = path.dirname(path.resolve(process.cwd(), caseFilePath));
  return path.resolve(caseDir, audioPath);
}

function compareRecognition(expected: string, actual: string) {
  const expectedChars = [...normalizeForCompare(expected)];
  const actualChars = [...normalizeForCompare(actual)];
  const charDistance = levenshteinDistance(expectedChars, actualChars);
  const charAccuracy = accuracyFromDistance(charDistance, expectedChars.length);

  const expectedWords = segmentWords(expected);
  const actualWords = segmentWords(actual);
  const wordDistance = levenshteinDistance(expectedWords, actualWords);
  const wordAccuracy = accuracyFromDistance(wordDistance, expectedWords.length);

  return {
    charAccuracy,
    wordAccuracy,
    charDistance,
    wordDistance,
  };
}

function normalizeForCompare(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

function segmentWords(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]/gu, " ");
  const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
  const words = [...segmenter.segment(normalized)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment.trim())
    .filter(Boolean);

  return words.length > 0 ? words : [...normalizeForCompare(text)];
}

function levenshteinDistance<T>(expected: T[], actual: T[]): number {
  const previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  const current = Array.from({ length: actual.length + 1 }, () => 0);

  for (let i = 1; i <= expected.length; i++) {
    current[0] = i;

    for (let j = 1; j <= actual.length; j++) {
      const substitutionCost = Object.is(expected[i - 1], actual[j - 1]) ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost,
      );
    }

    for (let j = 0; j < previous.length; j++) {
      previous[j] = current[j];
    }
  }

  return previous[actual.length];
}

function accuracyFromDistance(distance: number, expectedLength: number): number {
  if (expectedLength === 0) {
    return distance === 0 ? 1 : 0;
  }

  return Math.max(0, 1 - distance / expectedLength);
}
