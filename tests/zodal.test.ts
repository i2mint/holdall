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
    const titles = (await (await mine.exportAll()).data.items['imported-b']).title;
    expect(titles).toBe('B changed');
  });

  it('shares an item by link and reads it back validated', async () => {
    const p = make([{ id: 'a', title: 'Hello' }]);
    const link = await p.shareLink('a', 'https://x.test/app/?d=a');
    expect(link.tier).toBe('portable');
    expect(p.readLink(link.url)).toEqual({ id: 'a', title: 'Hello' });
    expect(p.readLink('https://x.test/app/')).toBeNull();
  });

  it('exposes stable operation names for defineCollection', () => {
    expect(persistenceOperations.map((o) => o.name)).toContain('holdall.shareLink');
  });
});
