import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { collectionKind, exportCollection, isHoldallError, parseCollection, wrap } from '../src';

const spec = { app: 'demo', kind: 'note', version: 1, schema: z.object({ id: z.string(), text: z.string() }) };

describe('collection files', () => {
  it('exports and parses back, reporting bad items instead of failing', () => {
    const env = exportCollection({ a: { id: 'a', text: 'x' } }, spec);
    expect(env.kind).toBe(collectionKind('note'));
    const text = JSON.stringify({ ...env, data: { items: { ...env.data.items, bad: { id: 'bad' } } } });
    const parsed = parseCollection(text, spec);
    expect(parsed.items).toEqual([['a', { id: 'a', text: 'x' }]]);
    expect(parsed.rejected.map((r) => [r.key, r.error.code])).toEqual([['bad', 'invalid']]);
  });

  it('accepts a single-item envelope when given keyOf', () => {
    const one = wrap({ id: 'z', text: 'y' }, spec);
    expect(parseCollection(one, spec, { keyOf: (v) => v.id }).items).toEqual([['z', { id: 'z', text: 'y' }]]);
  });

  it('rejects files that are not ours', () => {
    const code = (raw: unknown) => {
      try {
        parseCollection(raw, spec);
      } catch (e) {
        return isHoldallError(e) ? e.code : 'other';
      }
    };
    expect(code('not json')).toBe('bad-payload');
    expect(code({ sessions: [] })).toBe('not-an-envelope');
    expect(code({ app: 'x', kind: 'note:collection', version: 1, data: {} })).toBe('wrong-app');
    expect(code({ app: 'demo', kind: 'note:collection', version: 2, data: {} })).toBe('too-new');
    expect(code({ app: 'demo', kind: 'note:collection', version: 1, data: { items: [{ id: 'a', text: 'x' }] } })).toBe('invalid');
  });
});
