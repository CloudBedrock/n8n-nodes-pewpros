import { IDataObject, IHttpRequestMethods, IHttpRequestOptions } from 'n8n-workflow';

/**
 * Refuse to send credentials over cleartext HTTP. The Bearer token would
 * otherwise travel in the clear if a user misconfigured an `http://` base URL.
 * Plain HTTP is allowed only for loopback hosts so local development still works.
 */
export function assertSecureBaseUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Pewpros: invalid Base URL "${baseUrl}". Use a full https:// URL.`);
  }

  const isLoopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLoopback) {
    throw new Error(
      `Pewpros: refusing to send credentials over insecure ${url.protocol}// to "${url.hostname}". ` +
        'Use an https:// Base URL (http:// is permitted only for localhost).',
    );
  }
}

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Guard for a credential's `authenticate`: checks the stored Base URL and the
 * URL the request will actually go to (an absolute `url` wins over `baseURL`,
 * as in axios), so a secret is never attached to a cleartext request, whether
 * from the credential test or an HTTP Request node pointed elsewhere.
 */
export function assertSecureRequestTarget(
  requestOptions: Pick<IHttpRequestOptions, 'url' | 'baseURL'>,
  credentialBaseUrl?: string,
): void {
  if (credentialBaseUrl) {
    assertSecureBaseUrl(credentialBaseUrl);
  }

  const { url, baseURL } = requestOptions;
  if (typeof url === 'string' && ABSOLUTE_URL.test(url)) {
    assertSecureBaseUrl(url);
  } else if (typeof baseURL === 'string' && baseURL !== '' && !baseURL.startsWith('=')) {
    assertSecureBaseUrl(baseURL);
  } else if (!credentialBaseUrl) {
    throw new Error('Pewpros: cannot determine the request URL; refusing to attach credentials.');
  }
}

/**
 * Permissions (pewpros #2566 capabilities) the server checks per route. The
 * 403 body does not name the missing capability, so map it from the path.
 */
const ROUTE_PERMISSIONS: Array<{ prefix: string; key: string; label: string }> = [
  { prefix: '/api/v1/webhooks', key: 'setup.integrations', label: 'Integrations and credentials' },
  {
    prefix: '/api/v1/admin/registrations',
    key: 'classes.registrations',
    label: 'Registrations and rosters',
  },
  { prefix: '/api/v1/admin/events', key: 'classes', label: 'Classes and events' },
  { prefix: '/api/v1/approvals', key: 'workflows', label: 'Workflows' },
];

export function forbiddenMessage(method: string, path: string, serverDetail?: string): string {
  const route = `${method} ${path}`;
  const server = serverDetail ? ` (server: ${serverDetail})` : '';
  const match = ROUTE_PERMISSIONS.find(
    (entry) => path === entry.prefix || path.startsWith(`${entry.prefix}/`),
  );
  if (match) {
    return (
      `HTTP 403: the API token's role lacks the "${match.label}" (${match.key}) permission ` +
      `needed for ${route}. Grant it to the role in Pewpros, or use a token from a role that has it.${server}`
    );
  }
  return `HTTP 403: the API token's role is not allowed to call ${route}. Check the user's role in Pewpros.${server}`;
}

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
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    assertSecureBaseUrl(baseUrl);
    this.baseUrl = baseUrl;
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

      if (response.status === 403) {
        throw new Error(forbiddenMessage(method, path, this.extractError(parsed)));
      }

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
      if (Array.isArray(obj.errors)) {
        const first = obj.errors[0] as IDataObject | undefined;
        if (first && typeof first.message === 'string') {
          return first.message;
        }
      }
      if (obj.errors) {
        return JSON.stringify(obj.errors);
      }
    }
    return undefined;
  }
}
