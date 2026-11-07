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

function targetString(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  if (value instanceof URL) {
    return value.href;
  }
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { href?: unknown }).href === 'string'
  ) {
    return (value as { href: string }).href;
  }
  return undefined;
}

/**
 * Guard for a credential's `authenticate`. Resolves the URL the request will
 * actually go to (`url`, or the legacy `uri` the HTTP Request node sends,
 * resolved against `baseURL` the way axios does, protocol-relative included)
 * and refuses to attach the secret unless that target is https (loopback
 * excepted) AND has the same origin as the credential's own Base URL. A user
 * who may use a shared credential therefore cannot send it to another host.
 */
export function assertSecureRequestTarget(
  requestOptions: Pick<IHttpRequestOptions, 'url' | 'baseURL'> & { uri?: unknown },
  credentialBaseUrl: string | undefined,
): void {
  if (!credentialBaseUrl) {
    throw new Error('Pewpros: the credential has no Base URL; refusing to attach credentials.');
  }
  assertSecureBaseUrl(credentialBaseUrl);
  const allowedOrigin = new URL(credentialBaseUrl).origin;

  const baseURL = requestOptions.baseURL;
  const base =
    typeof baseURL === 'string' && baseURL !== '' && !baseURL.startsWith('=')
      ? baseURL
      : credentialBaseUrl;
  const raw = targetString(requestOptions.url) ?? targetString(requestOptions.uri);

  let target: URL;
  try {
    target = raw ? new URL(raw, base) : new URL(base);
  } catch {
    throw new Error('Pewpros: cannot determine the request URL; refusing to attach credentials.');
  }

  assertSecureBaseUrl(target.href);
  if (target.origin !== allowedOrigin) {
    throw new Error(
      `Pewpros: refusing to send credentials to "${target.origin}"; ` +
        `this credential only signs requests to its Base URL (${allowedOrigin}).`,
    );
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
  // RequireCapability answers with this exact text; the plain admin-role gate
  // answers "Forbidden" on the same routes, so only name a permission here.
  const capabilityDenial = serverDetail === 'Your role does not have access';
  const match = ROUTE_PERMISSIONS.find(
    (entry) => path === entry.prefix || path.startsWith(`${entry.prefix}/`),
  );
  if (match && capabilityDenial) {
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
        const messages = (obj.errors as IDataObject[])
          .map((entry) => (entry && typeof entry.message === 'string' ? entry.message : ''))
          .filter(Boolean);
        if (messages.length > 0 && messages.length === obj.errors.length) {
          return messages.join('; ');
        }
      }
      if (obj.errors) {
        return JSON.stringify(obj.errors);
      }
    }
    return undefined;
  }
}
