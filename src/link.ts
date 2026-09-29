/**
 * Share links: a value encoded into a URL, compressed, versioned and measured.
 *
 * Payload grammar: `<codec>.<base64url>` where codec is `z1` (raw DEFLATE of
 * UTF-8 JSON, via fflate) or `j1` (UTF-8 JSON, uncompressed). `auto` picks the
 * shorter, because DEFLATE grows very small payloads.
 *
 * Payloads go in the URL fragment by default: the fragment is never sent to a
 * server, never logged, and stripped from the Referer header.
 */
import { deflateSync, Inflate, strFromU8, strToU8 } from 'fflate';
import { HoldallError } from './errors';

export type Codec = 'z1' | 'j1';

// ---- base64url (RFC 4648 §5, no padding) ----

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new HoldallError('bad-payload', 'The link payload has characters base64url does not use.');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- payload codec ----

export interface EncodeOptions {
  /** `auto` (default) picks whichever of `z1`/`j1` is shorter. */
  codec?: Codec | 'auto';
}

export function encodePayload(value: unknown, { codec = 'auto' }: EncodeOptions = {}): string {
  const bytes = strToU8(JSON.stringify(value));
  const j1 = () => 'j1.' + toBase64Url(bytes);
  const z1 = () => 'z1.' + toBase64Url(deflateSync(bytes, { level: 9 }));
  if (codec === 'j1') return j1();
  if (codec === 'z1') return z1();
  const [a, b] = [z1(), j1()];
  return a.length <= b.length ? a : b;
}

/** Links come from strangers: never inflate more than this (a 2 KB link can expand to gigabytes). */
export const DEFAULT_MAX_DECODED_BYTES = 8 * 1024 * 1024;

function inflateCapped(bytes: Uint8Array, maxBytes: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > maxBytes) throw new HoldallError('bad-payload', `The link payload expands past ${maxBytes} bytes; refusing to decode it.`);
    chunks.push(chunk);
  });
  inflater.push(bytes, true);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function decodePayload(payload: string, { maxBytes = DEFAULT_MAX_DECODED_BYTES }: { maxBytes?: number } = {}): unknown {
  const dot = payload.indexOf('.');
  const codec = dot < 0 ? '' : payload.slice(0, dot);
  const body = payload.slice(dot + 1);
  let bytes: Uint8Array;
  if (codec === 'j1') bytes = fromBase64Url(body);
  else if (codec === 'z1') {
    try {
      bytes = inflateCapped(fromBase64Url(body), maxBytes);
    } catch (e) {
      if (e instanceof HoldallError) throw e;
      throw new HoldallError('bad-payload', 'The link payload is damaged (it does not decompress). Was the link cut short?', e);
    }
  } else throw new HoldallError('unknown-codec', `Unknown link codec "${codec}". This link may come from a newer version.`, codec);
  try {
    return JSON.parse(strFromU8(bytes));
  } catch (e) {
    throw new HoldallError('bad-payload', 'The link payload is damaged (it is not valid JSON). Was the link cut short?', e);
  }
}

// ---- length budget ----

/**
 * Where a link of a given length can safely travel. Defaults come from
 * docs/research/01: ~2,000 chars is safe everywhere (Discord, old Outlook),
 * ~4,000 survives chat (Slack splits longer bot messages), ~8,000 survives
 * modern email clients and CDNs. Above that, offer a file instead.
 */
export type LinkTier = 'portable' | 'chat' | 'email' | 'too-long';

export interface LinkBudget {
  portable: number;
  chat: number;
  email: number;
}

export const DEFAULT_LINK_BUDGET: LinkBudget = { portable: 2000, chat: 4000, email: 8000 };

export function linkTier(link: string | number, budget: LinkBudget = DEFAULT_LINK_BUDGET): LinkTier {
  const n = typeof link === 'number' ? link : link.length;
  if (n <= budget.portable) return 'portable';
  if (n <= budget.chat) return 'chat';
  if (n <= budget.email) return 'email';
  return 'too-long';
}

// ---- URL fragment / query params ----

export type UrlPart = 'hash' | 'search';

/**
 * The fragment may hold a hash-router path (`#/editor?x=1`): params are then
 * what follows its `?`, and the path is kept on write.
 */
function splitHash(url: URL): { route: string; query: string } {
  const hash = url.hash.replace(/^#/, '');
  if (!hash.startsWith('/')) return { route: '', query: hash };
  const q = hash.indexOf('?');
  return q < 0 ? { route: hash, query: '' } : { route: hash.slice(0, q), query: hash.slice(q + 1) };
}

function paramsOf(url: URL, part: UrlPart): URLSearchParams {
  return new URLSearchParams(part === 'hash' ? splitHash(url).query : url.search);
}

function withParams(url: URL, part: UrlPart, params: URLSearchParams): URL {
  const out = new URL(url.href);
  const text = params.toString();
  if (part === 'search') out.search = text ? '?' + text : '';
  else {
    const { route } = splitHash(url);
    const hash = route ? (text ? `${route}?${text}` : route) : text;
    out.hash = hash ? '#' + hash : '';
  }
  return out;
}

/** Return a copy of `url` with `key=value` set in its fragment (default) or query. Other params are kept. */
export function setUrlParam(url: string | URL, key: string, value: string, { part = 'hash' as UrlPart } = {}): string {
  const u = new URL(String(url));
  const params = paramsOf(u, part);
  params.set(key, value);
  return withParams(u, part, params).href;
}

export function getUrlParam(url: string | URL, key: string, { part = 'hash' as UrlPart } = {}): string | null {
  return paramsOf(new URL(String(url)), part).get(key);
}

/** Remove params, e.g. before building an outgoing link that must not carry the user's data. */
export function stripUrlParams(url: string | URL, keys: string[], { part = 'hash' as UrlPart } = {}): string {
  const u = new URL(String(url));
  const params = paramsOf(u, part);
  for (const k of keys) params.delete(k);
  return withParams(u, part, params).href;
}

// ---- the one-call API ----

export interface ShareLinkOptions extends EncodeOptions {
  /** Param name. Default `s`. Keep it distinct from params that hold local ids. */
  key?: string;
  part?: UrlPart;
  budget?: LinkBudget;
}

export interface ShareLink {
  url: string;
  length: number;
  tier: LinkTier;
}

/** Encode `value` into `baseUrl`. Always returns the link; check `tier` before offering "Copy link". */
export function makeShareLink(value: unknown, baseUrl: string | URL, opts: ShareLinkOptions = {}): ShareLink {
  const { key = 's', part = 'hash', budget = DEFAULT_LINK_BUDGET, codec } = opts;
  const url = setUrlParam(baseUrl, key, encodePayload(value, { codec }), { part });
  return { url, length: url.length, tier: linkTier(url, budget) };
}

/** Decode the value carried by a link, or `null` when the link carries none. Throws on a damaged payload. */
export function readShareLink(
  url: string | URL,
  { key = 's', part = 'hash' as UrlPart, maxBytes }: { key?: string; part?: UrlPart; maxBytes?: number } = {},
): unknown | null {
  const payload = getUrlParam(url, key, { part });
  return payload === null ? null : decodePayload(payload, { maxBytes });
}
