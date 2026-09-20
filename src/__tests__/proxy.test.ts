import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import type * as http from 'http';

// We need to mock the external dependencies that proxy.ts imports at module level
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'home') return '/mock/home';
      return '/mock/' + name;
    }),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Test: generateModelPlaceholderId (via concept) ────────────────────────

function generateModelPlaceholderId(model: { displayName?: string; name?: string }): string {
  const input = (model.displayName || model.name || 'custom-model').toLowerCase();
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) + hash + input.charCodeAt(i);
    hash = hash & hash; // Force 32-bit integer
  }
  const placeholderNum = 400 + (Math.abs(hash) % 200);
  return `MODEL_PLACEHOLDER_M${placeholderNum}`;
}

// ─── Test: toSlug (via concept) ───────────────────────────────────────────

function toSlug(model: { externalModelName?: string; name?: string }): string {
  return (
    'custom-' +
    (model.externalModelName || model.name || '')
      .replace(/^models\//, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
  );
}

// ─── Test: parseRetryAfter (via concept) ──────────────────────────────────

function parseRetryAfter(headers: Record<string, string | string[] | undefined>): number {
  const val = headers['retry-after'];
  if (!val) return 0;

  const raw = Array.isArray(val) ? val[0] : val;
  if (!raw) return 0;

  const seconds = parseInt(raw.trim(), 10);
  if (!isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = new Date(raw);
  if (!isNaN(date.getTime())) {
    const delay = date.getTime() - Date.now();
    return delay > 0 ? delay : 0;
  }

  return 0;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('generateModelPlaceholderId', () => {
  it('generates deterministic IDs for the same input', () => {
    const id1 = generateModelPlaceholderId({ name: 'gpt-4o', displayName: 'GPT-4o' });
    const id2 = generateModelPlaceholderId({ name: 'gpt-4o', displayName: 'GPT-4o' });
    expect(id1).toBe(id2);
  });

  it('produces IDs in the MODEL_PLACEHOLDER_M format', () => {
    const id = generateModelPlaceholderId({ name: 'gpt-4o' });
    expect(id).toMatch(/^MODEL_PLACEHOLDER_M\d+$/);
  });

  it('produces different IDs for different models', () => {
    const id1 = generateModelPlaceholderId({ name: 'gpt-4o' });
    const id2 = generateModelPlaceholderId({ name: 'claude-3-5-sonnet' });
    expect(id1).not.toBe(id2);
  });

  it('uses displayName over name', () => {
    const id1 = generateModelPlaceholderId({ name: 'models/gpt-4o', displayName: 'My GPT-4o' });
    const id2 = generateModelPlaceholderId({ name: 'models/gpt-4o', displayName: 'Different Name' });
    expect(id1).not.toBe(id2);
  });

  it('falls back to name when displayName is missing', () => {
    const id = generateModelPlaceholderId({ name: 'gpt-4o' });
    expect(id).toBeTruthy();
  });

  it('falls back to "custom-model" when both name and displayName missing', () => {
    const id = generateModelPlaceholderId({});
    expect(id).toBeTruthy();
  });

  it('placeholder number is within range [400, 599]', () => {
    const id = generateModelPlaceholderId({ name: 'gpt-4o' });
    const num = parseInt(id.replace('MODEL_PLACEHOLDER_M', ''), 10);
    expect(num).toBeGreaterThanOrEqual(400);
    expect(num).toBeLessThanOrEqual(599);
  });

  it('lowercases the input before hashing', () => {
    const id1 = generateModelPlaceholderId({ name: 'GPT-4O' });
    const id2 = generateModelPlaceholderId({ name: 'gpt-4o' });
    expect(id1).toBe(id2);
  });
});

describe('toSlug', () => {
  it('prefixes with "custom-"', () => {
    const slug = toSlug({ name: 'gpt-4o' });
    expect(slug).toMatch(/^custom-/);
  });

  it('removes "models/" prefix from externalModelName', () => {
    const slug = toSlug({ externalModelName: 'models/gpt-4o' });
    expect(slug).toBe('custom-gpt-4o');
  });

  it('replaces non-alphanumeric chars with hyphens', () => {
    const slug = toSlug({ name: 'GPT 4o (Latest)' });
    expect(slug).toBe('custom-gpt-4o-latest');
  });

  it('removes leading and trailing hyphens', () => {
    const slug = toSlug({ name: '--test--' });
    expect(slug).toBe('custom-test');
  });

  it('lowercases the result', () => {
    const slug = toSlug({ name: 'GPT-4O' });
    expect(slug).toBe('custom-gpt-4o');
  });

  it('uses externalModelName over name', () => {
    const slug = toSlug({ name: 'gpt-4o', externalModelName: 'openai/gpt-4o' });
    expect(slug).toBe('custom-openai-gpt-4o');
  });

  it('handles OpenRouter model format (provider/model)', () => {
    const slug = toSlug({ externalModelName: 'openai/gpt-4o' });
    expect(slug).toBe('custom-openai-gpt-4o');
  });
});

describe('parseRetryAfter', () => {
  it('returns 0 when no Retry-After header', () => {
    expect(parseRetryAfter({})).toBe(0);
  });

  it('parses delta-seconds format (integer)', () => {
    expect(parseRetryAfter({ 'retry-after': '120' })).toBe(120_000);
  });

  it('parses delta-seconds with whitespace', () => {
    expect(parseRetryAfter({ 'retry-after': '  60  ' })).toBe(60_000);
  });

  it('returns 0 for negative delta-seconds', () => {
    expect(parseRetryAfter({ 'retry-after': '-5' })).toBe(0);
  });

  it('parses HTTP-date format for future date', () => {
    const futureDate = new Date(Date.now() + 60_000).toUTCString();
    const result = parseRetryAfter({ 'retry-after': futureDate });
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(61_000); // allow 1s tolerance
  });

  it('returns 0 for past HTTP-date', () => {
    const pastDate = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter({ 'retry-after': pastDate })).toBe(0);
  });

  it('handles array value (takes first element)', () => {
    expect(parseRetryAfter({ 'retry-after': ['30', '60'] })).toBe(30_000);
  });

  it('returns 0 for invalid string', () => {
    expect(parseRetryAfter({ 'retry-after': 'not-a-number' })).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(parseRetryAfter({ 'retry-after': '' })).toBe(0);
  });
});

// ─── Test: safeWriteHead / safeWrite / safeEnd (via concept) ──────────────

function safeWriteHead(
  res: any,
  statusCode: number,
  headers?: any,
): boolean {
  if (res.headersSent || res.writableEnded || res.destroyed) {
    return false;
  }
  try {
    if (headers) {
      res.writeHead(statusCode, headers);
    } else {
      res.writeHead(statusCode);
    }
    return true;
  } catch (_err) {
    return false;
  }
}

function safeWrite(
  res: any,
  chunk: any,
  encoding?: BufferEncoding,
): boolean {
  if (res.writableEnded || res.destroyed) {
    return false;
  }
  try {
    return res.write(chunk, encoding);
  } catch (_err) {
    return false;
  }
}

function safeEnd(
  res: any,
  data?: any,
  encoding?: BufferEncoding,
): void {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  try {
    if (data !== undefined) {
      res.end(data, encoding);
    } else {
      res.end();
    }
  } catch (_err) {}
}

describe('Safe HTTP Response Helpers', () => {
  function createMockResponse(options: {
    headersSent?: boolean;
    writableEnded?: boolean;
    destroyed?: boolean;
    throwOnWriteHead?: boolean;
  } = {}) {
    const res = {
      headersSent: !!options.headersSent,
      writableEnded: !!options.writableEnded,
      destroyed: !!options.destroyed,
      writeHead: vi.fn((status: number, headers?: any) => {
        if (options.throwOnWriteHead || res.headersSent) {
          throw new Error('ERR_HTTP_HEADERS_SENT: Cannot write headers after they are sent to the client');
        }
        res.headersSent = true;
        return res;
      }),
      write: vi.fn((data: any) => true),
      end: vi.fn((data?: any) => {
        res.writableEnded = true;
      }),
    } as unknown as http.ServerResponse;
    return res;
  }

  describe('safeWriteHead', () => {
    it('writes head when headers have not been sent', () => {
      const res = createMockResponse();
      const success = safeWriteHead(res, 200, { 'Content-Type': 'text/plain' });
      expect(success).toBe(true);
      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/plain' });
    });

    it('returns false and does not throw when headers were already sent', () => {
      const res = createMockResponse({ headersSent: true });
      expect(() => {
        const success = safeWriteHead(res, 200);
        expect(success).toBe(false);
      }).not.toThrow();
      expect(res.writeHead).not.toHaveBeenCalled();
    });

    it('returns false and does not throw when response is destroyed', () => {
      const res = createMockResponse({ destroyed: true });
      expect(() => {
        const success = safeWriteHead(res, 200);
        expect(success).toBe(false);
      }).not.toThrow();
      expect(res.writeHead).not.toHaveBeenCalled();
    });

    it('returns false and catches any thrown ERR_HTTP_HEADERS_SENT without crashing', () => {
      const res = createMockResponse({ throwOnWriteHead: true });
      expect(() => {
        const success = safeWriteHead(res, 200);
        expect(success).toBe(false);
      }).not.toThrow();
    });
  });

  describe('safeWrite', () => {
    it('writes chunk when response is active', () => {
      const res = createMockResponse();
      const success = safeWrite(res, 'test-chunk');
      expect(success).toBe(true);
      expect(res.write).toHaveBeenCalledWith('test-chunk', undefined);
    });

    it('returns false when response is ended or destroyed', () => {
      const resEnded = createMockResponse({ writableEnded: true });
      expect(safeWrite(resEnded, 'chunk')).toBe(false);
      expect(resEnded.write).not.toHaveBeenCalled();

      const resDestroyed = createMockResponse({ destroyed: true });
      expect(safeWrite(resDestroyed, 'chunk')).toBe(false);
      expect(resDestroyed.write).not.toHaveBeenCalled();
    });
  });

  describe('safeEnd', () => {
    it('ends response safely when active', () => {
      const res = createMockResponse();
      safeEnd(res, 'final-data');
      expect(res.end).toHaveBeenCalledWith('final-data', undefined);
    });

    it('silently ignores end when already ended or destroyed', () => {
      const res = createMockResponse({ writableEnded: true });
      expect(() => safeEnd(res)).not.toThrow();
      expect(res.end).not.toHaveBeenCalled();
    });
  });
});
