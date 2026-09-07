export type PostifysConfig = {
  apiKey: string;
  serverUrl: string;
};

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
  return { apiKey, serverUrl };
};

type RequestOptions = {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
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

  async request<T = Record<string, unknown>>(options: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 60_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.buildUrl(options.path, options.query), {
        method: options.method || (options.body !== undefined ? 'POST' : 'GET'),
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
        throw new PostifysApiError(message, {
          statusCode: response.status,
          code,
          details: data.details || data,
        });
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
