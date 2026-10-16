import { randomUUID } from 'node:crypto';

export type PostifysConfig = {
  apiKey: string;
  serverUrl: string;
  /** Per-attempt request timeout (POSTIFYS_TIMEOUT_MS, default 60000). */
  timeoutMs?: number;
  /** Max retries for retryable failures (POSTIFYS_MAX_RETRIES, default 3). */
  maxRetries?: number;
  /** Base backoff delay (POSTIFYS_RETRY_BASE_MS, default 500). */
  retryBaseMs?: number;
};

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_BASE_MS = 500;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

const envNumber = (name: string, fallback: number, min = 0): number => {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min ? value : fallback;
};

export const newIdempotencyKey = (): string => `mcp_${randomUUID()}`;

export class PostifysApiError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(message: string, opts: { statusCode?: number; code?: string; details?: unknown } = {}) {
    super(message);
    this.name = 'PostifysApiError';
    this.statusCode = opts.statusCode || 0;
    this.code = opts.code || (opts.statusCode ? `HTTP_${opts.statusCode}` : 'POSTIFYS_REQUEST_FAILED');
    this.details = opts.details;
  }
}

const trimTrailingSlash = (value: string) => String(value || '').replace(/\/$/, '');

export const loadConfig = (): PostifysConfig => {
  const apiKey = String(process.env.POSTIFYS_API_KEY || '').trim();
  if (!apiKey) {
    throw new PostifysApiError(
      'POSTIFYS_API_KEY is required. Create a key in Postifys Settings and set it in the MCP server env.',
      { code: 'POSTIFYS_API_KEY_MISSING', statusCode: 401 },
    );
  }
  const serverUrl = trimTrailingSlash(process.env.POSTIFYS_SERVER_URL || 'https://postifys.com');
  return {
    apiKey,
    serverUrl,
    timeoutMs: envNumber('POSTIFYS_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1000),
    maxRetries: Math.floor(envNumber('POSTIFYS_MAX_RETRIES', DEFAULT_MAX_RETRIES, 0)),
    retryBaseMs: envNumber('POSTIFYS_RETRY_BASE_MS', DEFAULT_RETRY_BASE_MS, 0),
  };
};

type RequestOptions = {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Override retry safety. Defaults: idempotent HTTP methods, or POST with an Idempotency-Key header. */
  retry?: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (value: string | null): number | null => {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
};

export class PostifysClient {
  readonly config: PostifysConfig;

  constructor(config: PostifysConfig = loadConfig()) {
    this.config = config;
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(path.startsWith('http') ? path : `${this.config.serverUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /**
   * Request with retry + exponential backoff (jitter, honours Retry-After) for
   * 429 / 5xx / network errors. Non-idempotent requests (POST/PATCH) are only
   * retried when they carry an Idempotency-Key, so a publish is never duplicated.
   */
  async request<T = Record<string, unknown>>(options: RequestOptions): Promise<T> {
    const method = (options.method || (options.body !== undefined ? 'POST' : 'GET')).toUpperCase();
    const headerKeys = Object.keys(options.headers || {}).map((key) => key.toLowerCase());
    const retrySafe = options.retry ?? (IDEMPOTENT_METHODS.has(method) || headerKeys.includes('idempotency-key'));
    const maxRetries = retrySafe ? Math.max(0, this.config.maxRetries ?? DEFAULT_MAX_RETRIES) : 0;
    const baseMs = this.config.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.requestOnce<T>(options, method);
      } catch (error) {
        const apiError = error as PostifysApiError & { retryAfterMs?: number | null };
        const retryable = apiError instanceof PostifysApiError
          && (RETRYABLE_STATUS.has(apiError.statusCode)
            || apiError.code === 'POSTIFYS_NETWORK_ERROR'
            || apiError.code === 'POSTIFYS_TIMEOUT');
        if (!retryable || attempt >= maxRetries) throw error;
        const backoff = baseMs * 2 ** attempt;
        const jitter = Math.random() * baseMs;
        const delay = Math.min(30_000, apiError.retryAfterMs ?? (backoff + jitter));
        await sleep(delay);
      }
    }
  }

  private async requestOnce<T>(options: RequestOptions, method: string): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.buildUrl(options.path, options.query), {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let data: any = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }

      if (!response.ok) {
        const message = data.error || data.message || `Postifys request failed (${response.status}).`;
        const code = data.code
          || (response.status === 402 ? 'BILLING_REQUIRED' : undefined)
          || (response.status === 429 ? 'RATE_LIMITED' : undefined)
          || `HTTP_${response.status}`;
        const apiError = new PostifysApiError(message, {
          statusCode: response.status,
          code,
          details: data.details || data,
        }) as PostifysApiError & { retryAfterMs?: number | null };
        apiError.retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
        throw apiError;
      }

      return data as T;
    } catch (error) {
      if (error instanceof PostifysApiError) throw error;
      if ((error as Error)?.name === 'AbortError') {
        throw new PostifysApiError(`Postifys request timed out after ${timeoutMs}ms.`, {
          code: 'POSTIFYS_TIMEOUT',
        });
      }
      throw new PostifysApiError((error as Error)?.message || 'Postifys request failed.', {
        code: 'POSTIFYS_NETWORK_ERROR',
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export const firstString = (...values: unknown[]): string => {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
};

export const normalizeMediaUrls = (value: string | string[] | undefined | null): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
};

export const toolResult = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

export const toolError = (error: unknown) => {
  if (error instanceof PostifysApiError) {
    return {
      isError: true as const,
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: false,
          error: error.message,
          code: error.code,
          statusCode: error.statusCode || undefined,
          details: error.details,
        }, null, 2),
      }],
    };
  }
  return {
    isError: true as const,
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: false,
        error: (error as Error)?.message || 'Unknown error',
        code: 'POSTIFYS_MCP_ERROR',
      }, null, 2),
    }],
  };
};
