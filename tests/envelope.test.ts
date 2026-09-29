import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isHoldallError, unwrap, wrap } from '../src';

const spec = {
  app: 'demo',
  kind: 'design',
  version: 3,
  schema: z.object({ id: z.string(), title: z.string(), size: z.number() }),
  migrations: {
    1: (d: any) => ({ ...d, title: d.name }),
    2: (d: any) => ({ id: d.id, title: d.title, size: d.size ?? 10 }),
  },
};

describe('envelope', () => {
  it('round-trips at the current version', () => {
    const env = wrap({ id: 'a', title: 'A', size: 1 }, spec, { now: () => new Date(0) });
    expect(env).toMatchObject({ app: 'demo', kind: 'design', version: 3, savedAt: '1970-01-01T00:00:00.000Z' });
    expect(unwrap(env, spec)).toEqual({ id: 'a', title: 'A', size: 1 });
  });

  it('migrates old data forward', () => {
    const old = { app: 'demo', kind: 'design', version: 1, data: { id: 'a', name: 'Old' } };
    expect(unwrap(old, spec)).toEqual({ id: 'a', title: 'Old', size: 10 });
  });

  it('refuses data newer than the code, other apps, other kinds', () => {
    const code = (raw: unknown) => {
      try {
        unwrap(raw, spec);
      } catch (e) {
        return isHoldallError(e) ? e.code : 'other';
      }
      return 'ok';
    };
    expect(code({ app: 'demo', kind: 'design', version: 4, data: {} })).toBe('too-new');
    expect(code({ app: 'other', kind: 'design', version: 3, data: {} })).toBe('wrong-app');
    expect(code({ app: 'demo', kind: 'font', version: 3, data: {} })).toBe('wrong-kind');
    expect(code({ id: 'a' })).toBe('not-an-envelope');
    expect(code({ app: 'demo', kind: 'design', version: 3, data: { id: 1 } })).toBe('invalid');
    expect(code({ app: 'demo', kind: 'design', version: 0, data: {} })).toBe('missing-migration');
  });

  it('accepts bare legacy data when told its version', () => {
    expect(unwrap({ id: 'a', name: 'Legacy' }, { ...spec, bareVersion: 1 })).toEqual({ id: 'a', title: 'Legacy', size: 10 });
  });
});
