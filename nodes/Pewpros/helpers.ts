import { IDataObject, IHttpRequestMethods } from 'n8n-workflow';

/** Split a comma-separated id string into an array of numbers/strings. */
export function toIdArray(raw: string): Array<number | string> {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/** Split a comma/space separated string into a trimmed list of strings. */
export function toStringList(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Drop empty values from a collection so they are not sent. */
export function compact(input: IDataObject): IDataObject {
  const out: IDataObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== '') {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Read a node parameter for the current item. Wraps `getNodeParameter(name, i,
 * fallback)` so request builders stay pure and can be unit-tested.
 */
export type ParamGetter = (name: string, fallback?: unknown) => unknown;

export interface RequestSpec {
  method: IHttpRequestMethods;
  path: string;
  body?: IDataObject;
  qs?: IDataObject;
  /**
   * Turn the response into output items. Without it the response envelope is
   * returned as one item.
   */
  toItems?: (response: unknown) => IDataObject[];
}

/** Read a parameter as a trimmed string. */
export function str(get: ParamGetter, name: string): string {
  const value = get(name);
  return value === undefined || value === null ? '' : String(value).trim();
}

/**
 * Read an id that goes into a URL path. It must be a positive integer, so a
 * slug or stray text cannot change the path or reach a route that would choke
 * on it.
 */
export function pathId(get: ParamGetter, name: string, label: string): string {
  const value = str(get, name);
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error(`Pewpros: ${label} must be a positive whole number (got "${value}").`);
  }
  return value;
}

/**
 * Convert numeric-looking strings for the given keys to numbers, so the API
 * receives JSON integers. Some endpoints reject `"5"` where they expect `5`.
 */
export function toInts(input: IDataObject, keys: string[]): IDataObject {
  const out: IDataObject = { ...input };
  for (const key of keys) {
    const value = out[key];
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
      out[key] = Number(value.trim());
    }
  }
  return out;
}

/** Reduce an n8n dateTime value to `YYYY-MM-DD`. */
export function toDate(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!text) {
    return '';
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (!match) {
    throw new Error(`Pewpros: "${text}" is not a date (expected YYYY-MM-DD).`);
  }
  return match[1];
}

/**
 * Normalise a date-time for the API, which needs an explicit offset
 * (`DateTime.from_iso8601`). A value that already has `Z` or `±hh:mm` passes
 * through unchanged. A value without one (what the n8n date picker produces) is
 * read in the n8n server's local time zone and sent as UTC.
 */
export function toDateTime(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!text) {
    return '';
  }
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    return text;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Pewpros: "${text}" is not a date-time (expected ISO 8601).`);
  }
  return parsed.toISOString();
}

/** Read a fixedCollection's rows (`{ [group]: [...] }`) as an array. */
export function collectionRows(value: unknown, group: string): IDataObject[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const rows = (value as IDataObject)[group];
  return Array.isArray(rows) ? (rows as IDataObject[]) : [];
}
