import { createHmac, timingSafeEqual } from 'node:crypto';

/** Deliveries signed more than this many seconds from now are refused. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** How many recent event ids the trigger remembers for duplicate detection. */
export const SEEN_EVENT_IDS_MAX = 1000;

export type SignatureResult = 'ok' | 'malformed' | 'stale' | 'mismatch';

export interface ParsedSignature {
  t: number;
  v1: string[];
}

/**
 * Parses `Pewpros-Signature: t=<unix>,v1=<hex>[,v1=<hex>...]`. Several `v1`
 * values are allowed so the signing secret can be rotated without downtime.
 * Exactly one `t` is required.
 */
export function parseSignatureHeader(header: string | undefined | null): ParsedSignature | null {
  if (!header || typeof header !== 'string') {
    return null;
  }

  let t: number | undefined;
  let timestampCount = 0;
  const v1: string[] = [];

  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key === 't') {
      timestampCount += 1;
      if (!/^\d+$/.test(value)) {
        return null;
      }
      t = Number(value);
    } else if (key === 'v1') {
      if (!/^[0-9a-fA-F]+$/.test(value)) {
        return null;
      }
      v1.push(value.toLowerCase());
    }
  }

  if (timestampCount !== 1 || t === undefined || v1.length === 0) {
    return null;
  }
  return { t, v1 };
}

/**
 * Verifies a Pewpros delivery: `v1 = HMAC_SHA256(secret, "<t>.<rawBody>")`,
 * computed over the exact received bytes, with `t` no further than
 * `toleranceSeconds` from `nowSeconds` in either direction.
 */
export function verifySignature(
  secret: string,
  header: string | undefined | null,
  rawBody: string,
  nowSeconds: number,
  toleranceSeconds: number = SIGNATURE_TOLERANCE_SECONDS,
): SignatureResult {
  const parsed = parseSignatureHeader(header);
  if (!parsed) {
    return 'malformed';
  }

  if (Math.abs(nowSeconds - parsed.t) > toleranceSeconds) {
    return 'stale';
  }

  const expected = Buffer.from(
    createHmac('sha256', secret).update(`${parsed.t}.${rawBody}`).digest('hex'),
    'utf8',
  );

  for (const candidate of parsed.v1) {
    const provided = Buffer.from(candidate, 'utf8');
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return 'ok';
    }
  }
  return 'mismatch';
}

export interface SeenEventState {
  seenEventIds?: string[];
}

/**
 * Records `id` in a bounded FIFO list. Returns true when the id is new, false
 * when it was already seen (a retried or replayed delivery).
 */
export function rememberEventId(
  state: SeenEventState,
  id: string,
  max: number = SEEN_EVENT_IDS_MAX,
): boolean {
  const seen = Array.isArray(state.seenEventIds) ? state.seenEventIds : [];
  if (seen.includes(id)) {
    return false;
  }
  seen.push(id);
  if (seen.length > max) {
    seen.splice(0, seen.length - max);
  }
  state.seenEventIds = seen;
  return true;
}
