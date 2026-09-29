import { defineCollection } from '@zodal/core';
import { createInMemoryProvider } from '@zodal/store';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createPersistence, persistenceOperations } from '../src/zodal';

type Design = { id: string; title: string };
const schema = z.object({ id: z.string(), title: z.string() });
const make = (items: Design[]) =>
  createPersistence<Design>({
    provider: createInMemoryProvider<Design>(items),
    app: 'demo',
    kind: 'design',
    version: 1,
    schema,
    now: () => new Date(0),
  });

describe('zodal facade', () => {
  it('exports all, then imports into another store with prefix-rename on conflict', async () => {
    const mine = make([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
    const theirs = make([{ id: 'a', title: 'A' }, { id: 'b', title: 'B changed' }, { id: 'c', title: 'C' }]);
    const file = JSON.stringify(await theirs.exportAll());

    const pending = await mine.planImport(file);
    expect(pending.plan.conflicts.map((c) => c.key)).toEqual(['b']);
    const report = await mine.applyImport(pending);
    expect(report).toMatchObject({ added: ['c'], identical: ['a'], renamed: [{ from: 'b', to: 'imported-b' }], failed: [] });

    const again = await mine.applyImport(await mine.planImport(file));
    expect(again.added).toEqual([]);
    expect(again.renamed).toEqual([{ from: 'b', to: 'imported-2-b' }]);
    expect((await mine.exportAll()).data.items['imported-b'].title).toBe('B changed');
  });

  it('shares an item by link and reads it back validated', async () => {
    const p = make([{ id: 'a', title: 'Hello' }]);
    const link = await p.shareLink('a', 'https://x.test/app/?d=a');
    expect(link.tier).toBe('portable');
    expect(await p.readLink(link.url)).toEqual({ id: 'a', title: 'Hello' });
    expect(await p.readLink('https://x.test/app/')).toBeNull();
    const stripped = await p.shareLink('a', 'https://x.test/app/?d=a&x=1', { stripKeys: ['d'] });
    expect(new URL(stripped.url).search).toBe('?x=1');
  });

  it('exposes stable operation names for defineCollection', () => {
    const ops = persistenceOperations();
    expect(ops.map((o) => o.name)).toContain('holdall.shareLink');
    // must be assignable to zodal's mutable OperationDefinition[]
    const def = defineCollection(z.object({ id: z.string() }), { operations: ops });
    expect(def).toBeTruthy();
  });
});

describe('zodal facade safety', () => {
  it('rejects items whose file key disagrees with their id, instead of overwriting another item', async () => {
    const p = make([{ id: 'b', title: 'precious' }]);
    const file = { app: 'demo', kind: 'design:collection', version: 1, data: { items: { a: { id: 'b', title: 'evil' } } } };
    const pending = await p.planImport(file);
    expect(pending.plan.added).toEqual([]);
    expect(pending.rejected.map((r) => r.key)).toEqual(['a']);
    await p.applyImport(pending);
    expect((await p.exportAll()).data.items.b.title).toBe('precious');
  });

  it('reads every page of a paginating provider', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, title: String(i) }));
    const p = createPersistence<Design>({ provider: createInMemoryProvider<Design>(many), app: 'demo', kind: 'design', version: 1, pageSize: 5 });
    expect(Object.keys((await p.exportAll()).data.items)).toHaveLength(12);
  });
});
