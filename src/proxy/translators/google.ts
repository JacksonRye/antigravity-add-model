/**
 * Google AI Studio Translator.
 *
 * Google AI Studio speaks Gemini format natively, so request/response
 * translation is a passthrough. The main addition is SSE streaming chunk
 * parsing and proper endpoint URL handling.
 */

import log from 'electron-log';

// ─── Types ────────────────────────────────────────────────────────────────

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thought?: boolean;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
}

interface GeminiContent {
  parts?: GeminiPart[];
  role?: string;
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
  index?: number;
  safetyRatings?: unknown[];
}

interface GeminiStreamChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: unknown;
  modelVersion?: string;
}

interface GeminiRequestBody {
  model?: string;
  modelId?: string;
  contents?: GeminiContent[];
  systemInstruction?: { parts: { text?: string }[] };
  tools?: unknown[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
  };
}

// ─── Request Translation (Passthrough) ────────────────────────────────────

/**
 * Google AI Studio uses the same Gemini format — just pass through.
 * The caller handles URL routing (streamGenerateContent vs generateContent).
 */
export function mapGeminiToGoogle(geminiBody: GeminiRequestBody, modelName: string): GeminiRequestBody {
  // Ensure the external model name is set
  const body: GeminiRequestBody = { ...geminiBody };
  if (modelName && !body.model) {
    body.model = modelName;
  }
  delete (body as any).stream;
  return body;
}

// ─── Response Translation (Passthrough) ───────────────────────────────────

/**
 * Google AI Studio returns Gemini-format responses directly.
 * Just pass through — the proxy wraps it in the Cloud Code envelope.
 */
export function mapGoogleToGemini(googleRes: unknown, _modelName: string): unknown {
  // Google AI Studio response is already in Gemini format
  // Wrapped by caller in { response, traceId, metadata }
  return googleRes;
}

// ─── Streaming Chunk Translation ──────────────────────────────────────────

/**
 * Parse a Google AI Studio SSE streaming chunk into a Gemini candidate.
 *
 * Google AI Studio streams JSON chunks like:
 *   {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"},...}]}
 *
 * Each chunk contains complete candidate objects (not deltas).
 */
export function mapGoogleChunkToGemini(chunk: unknown, _modelName: string): GeminiCandidate | null {
  if (!chunk || typeof chunk !== 'object') return null;

  const data = chunk as GeminiStreamChunk;

  // Extract first candidate
  if (!data.candidates || data.candidates.length === 0) return null;

  const candidate = data.candidates[0];

  // Check if there's actual content to emit
  const parts = candidate.content?.parts;
  if (!parts || parts.length === 0) {
    // Might be a final chunk with just finishReason
    if (candidate.finishReason) {
      return {
        content: { parts: [], role: 'model' },
        finishReason: candidate.finishReason,
        index: candidate.index ?? 0,
      };
    }
    return null;
  }

  return {
    content: candidate.content,
    finishReason: candidate.finishReason || 'OTHER',
    index: candidate.index ?? 0,
    safetyRatings: candidate.safetyRatings,
  };
}

// ─── URL Helpers ──────────────────────────────────────────────────────────

/**
 * Constructs the correct Google AI Studio endpoint URL based on streaming mode.
 *
 * Google AI Studio uses different endpoints:
 *   - Non-streaming: :generateContent
 *   - Streaming:     :streamGenerateContent
 *
 * If the user's URL already contains one of these endpoints, it's kept as-is.
 */
export function getGoogleApiUrl(baseUrl: string, modelName: string, isStream: boolean, apiKey?: string): string {
  let url = baseUrl;

  if (!url.includes(":generateContent") && !url.includes(":streamGenerateContent")) {
    url = url.replace(/\/$/, "");
    const modelPathPattern = /\/models\/([^\/]+)$/;
    const modelMatch = modelPathPattern.exec(url);

    if (modelMatch) {
      const method = isStream ? ":streamGenerateContent?alt=sse" : ":generateContent";
      url += method;
    } else if (modelName) {
      const method = isStream ? ":streamGenerateContent?alt=sse" : ":generateContent";
      url += `/models/${modelName}${method}`;
    } else {
      log.warn("[GoogleTranslator] Could not determine model name for URL construction");
    }
  }

  if (apiKey && apiKey !== "none" && !url.includes("key=")) {
    const separator = url.includes("?") ? "&" : "?";
    url += `${separator}key=${apiKey}`;
  }

  return url;
}
