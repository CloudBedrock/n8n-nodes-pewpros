import { IDataObject, IHttpRequestMethods } from 'n8n-workflow';

export interface PewprosHttpConfig {
  baseUrl: string;
  apiToken: string;
  timeout?: number;
}

export interface PewprosRequestOptions {
  body?: IDataObject;
  qs?: IDataObject;
}

/**
 * Thin HTTP client for the Pewpros REST API. One generic request method that
 * injects the Bearer token, serialises query/body, and surfaces server-side
 * error messages. Zero runtime dependencies.
 */
export class PewprosHttp {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly timeout: number;

  constructor(config: PewprosHttpConfig) {
    // Trim a trailing slash so path concatenation is predictable.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiToken = config.apiToken;
    this.timeout = config.timeout ?? 30000;
  }

  async request<T = IDataObject>(
    method: IHttpRequestMethods,
    path: string,
    options: PewprosRequestOptions = {},
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    if (options.qs && Object.keys(options.qs).length > 0) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.qs)) {
        if (value === undefined || value === null || value === '') {
          continue;
        }
        if (Array.isArray(value)) {
          // Arrays are sent as repeated `key[]=` params (Phoenix convention).
          for (const item of value) {
            params.append(`${key}[]`, String(item));
          }
        } else {
          params.append(key, String(value));
        }
      }
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body:
          method !== 'GET' && method !== 'HEAD' && options.body
            ? JSON.stringify(options.body)
            : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const parsed = this.parseBody(text);

      if (!response.ok) {
        const detail = this.extractError(parsed) ?? text ?? response.statusText;
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }

      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private parseBody(text: string): unknown {
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private extractError(parsed: unknown): string | undefined {
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as IDataObject;
      if (typeof obj.message === 'string') {
        return obj.message;
      }
      if (typeof obj.error === 'string') {
        return obj.error;
      }
      if (obj.errors) {
        return JSON.stringify(obj.errors);
      }
    }
    return undefined;
  }
}
