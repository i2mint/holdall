import { describe, expect, it } from 'vitest';
import {
  decodePayload,
  encodePayload,
  fromBase64Url,
  getUrlParam,
  isHoldallError,
  linkTier,
  makeShareLink,
  readShareLink,
  stripUrlParams,
  toBase64Url,
} from '../src';

const big = { items: Array.from({ length: 40 }, (_, i) => ({ id: `item-${i}`, label: 'same label', n: i })) };

describe('link codec', () => {
  it('base64url round-trips all byte values', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = toBase64Url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(text)).toEqual(bytes);
  });

  it('auto picks j1 for tiny values and z1 for repetitive ones', () => {
    expect(encodePayload({ a: 1 })).toMatch(/^j1\./);
    expect(encodePayload(big)).toMatch(/^z1\./);
    expect(encodePayload(big).length).toBeLessThan(encodePayload(big, { codec: 'j1' }).length / 3);
  });

  it('round-trips unicode', () => {
    const v = { t: 'héllo — 日本 🎉', n: [1, 2.5, null] };
    for (const codec of ['z1', 'j1'] as const) expect(decodePayload(encodePayload(v, { codec }))).toEqual(v);
  });

  it('reports damaged and unknown payloads with codes', () => {
    const p = encodePayload(big);
    const codeOf = (s: string) => {
      try {
        decodePayload(s);
      } catch (e) {
        return isHoldallError(e) ? e.code : 'other';
      }
      return 'ok';
    };
    expect(codeOf(p.slice(0, p.length / 2))).toBe('bad-payload');
    expect(codeOf('x9.abc')).toBe('unknown-codec');
    expect(codeOf('j1.!!')).toBe('bad-payload');
  });

  it('tiers links by length', () => {
    expect(linkTier(100)).toBe('portable');
    expect(linkTier(3000)).toBe('chat');
    expect(linkTier(6000)).toBe('email');
    expect(linkTier(9000)).toBe('too-long');
    expect(linkTier(900, { portable: 500, chat: 800, email: 1000 })).toBe('email');
  });
});

describe('share links in URLs', () => {
  it('puts the payload in the fragment and keeps other params', () => {
    const link = makeShareLink({ a: 1 }, 'https://x.test/app/?d=local#p=panel');
    const url = new URL(link.url);
    expect(url.searchParams.get('d')).toBe('local');
    expect(getUrlParam(url, 'p')).toBe('panel');
    expect(readShareLink(link.url)).toEqual({ a: 1 });
    expect(link.tier).toBe('portable');
  });

  it('can use the query string and a custom key', () => {
    const link = makeShareLink({ a: 1 }, 'https://x.test/', { key: 'state', part: 'search' });
    expect(new URL(link.url).searchParams.get('state')).toMatch(/^j1\./);
    expect(readShareLink(link.url, { key: 'state', part: 'search' })).toEqual({ a: 1 });
  });

  it('returns null when there is no payload, and strips payloads', () => {
    expect(readShareLink('https://x.test/#p=1')).toBeNull();
    const link = makeShareLink({ a: 1 }, 'https://x.test/#p=1');
    expect(stripUrlParams(link.url, ['s'])).toBe('https://x.test/#p=1');
  });
});

describe('link safety and hash routers', () => {
  it('refuses payloads that inflate past the cap', () => {
    const bomb = encodePayload({ s: 'a'.repeat(200_000) }, { codec: 'z1' });
    expect(bomb.length).toBeLessThan(2000);
    expect(() => decodePayload(bomb, { maxBytes: 10_000 })).toThrow(/expands past/);
    expect((decodePayload(bomb) as { s: string }).s).toHaveLength(200_000);
  });

  it('keeps a hash-router path and reads params after its "?"', () => {
    const link = makeShareLink({ a: 1 }, 'https://x.test/#/editor?tab=2');
    expect(new URL(link.url).hash).toMatch(/^#\/editor\?tab=2&s=j1\./);
    expect(readShareLink(link.url)).toEqual({ a: 1 });
    expect(stripUrlParams(link.url, ['s'])).toBe('https://x.test/#/editor?tab=2');
    expect(stripUrlParams('https://x.test/#/editor?s=1', ['s'])).toBe('https://x.test/#/editor');
  });
});
