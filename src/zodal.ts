/**
 * The zodal facade: persistence and sharing for a collection held by any
 * zodal `DataProvider` (localStorage, IndexedDB, a folder, HTTP...).
 *
 * An app supplies the provider and its schema; it gets back export/import
 * (with a conflict plan it can show), per-item files and share links, and
 * the zodal operation definitions to put in `defineCollection({operations})`
 * so generated UIs show the buttons. The app still owns the rendering: the
 * conflict dialog, the install card, the toasts.
 */
import type { DataProvider } from '@zodal/store';
import { exportCollection, parseCollection, type ParsedCollection } from './collection';
import { type Envelope, type EnvelopeSpec, unwrap, wrap } from './envelope';
import { makeShareLink, readShareLink, type ShareLink, type ShareLinkOptions } from './link';
import { type ImportPlan, planImport, resolveImport, type ResolveOptions } from './merge';

export interface PersistenceOptions<T> extends EnvelopeSpec<T> {
  provider: DataProvider<T>;
  /** Field holding the unique key. Default `'id'`. */
  idField?: string;
  now?: () => Date;
}

export interface ImportReport {
  added: string[];
  overwritten: string[];
  renamed: { from: string; to: string }[];
  skipped: string[];
  identical: string[];
  rejected: { key: string; message: string }[];
  /** Writes the provider refused (quota, validation): the data is still in the file. */
  failed: { key: string; message: string }[];
}

export interface PendingImport<T> {
  plan: ImportPlan<T>;
  rejected: ParsedCollection<T>['rejected'];
}

export function createPersistence<T extends object>(opts: PersistenceOptions<T>) {
  const { provider, idField = 'id', now, ...spec } = opts;
  const keyOf = (v: T) => String((v as Record<string, unknown>)[idField]);
  const rekey = (v: T, key: string) => ({ ...v, [idField]: key }) as T;

  const all = async () => (await provider.getList({})).data;

  const write = async (value: T) => {
    if (provider.upsert) return provider.upsert(value);
    try {
      await provider.getOne(keyOf(value));
    } catch {
      return provider.create(value);
    }
    return provider.update(keyOf(value), value);
  };

  return {
    spec,

    /** Every item, as one collection envelope (ready for `saveJson`). */
    async exportAll(): Promise<Envelope<{ items: Record<string, T> }>> {
      return exportCollection((await all()).map((v) => [keyOf(v), v] as const), spec, { now });
    },

    async exportOne(id: string): Promise<Envelope<T>> {
      return wrap(await provider.getOne(id), spec, { now });
    },

    /** Dry run: parse a file (text or parsed JSON) and compare it with what is held. Pass `equals` to ignore volatile fields. */
    async planImport(raw: unknown, { equals }: { equals?: (a: T, b: T) => boolean } = {}): Promise<PendingImport<T>> {
      const parsed = parseCollection<T>(raw, spec, { keyOf });
      const held = (await all()).map((v) => [keyOf(v), v] as const);
      return { plan: planImport(held, parsed.items, { equals }), rejected: parsed.rejected };
    },

    /** Apply a plan. Default policy renames conflicting incoming items with a prefix. */
    async applyImport(pending: PendingImport<T>, resolve: Omit<ResolveOptions<T>, 'rekey'> = {}): Promise<ImportReport> {
      const res = resolveImport(pending.plan, { ...resolve, rekey });
      const report: ImportReport = {
        added: [],
        overwritten: [],
        renamed: [],
        skipped: res.skipped,
        identical: res.identical,
        rejected: pending.rejected.map(({ key, error }) => ({ key, message: error.message })),
        failed: [],
      };
      for (const w of res.writes) {
        try {
          await write(w.value);
        } catch (e) {
          report.failed.push({ key: w.key, message: e instanceof Error ? e.message : String(e) });
          continue;
        }
        if (w.action === 'add') report.added.push(w.key);
        else if (w.action === 'overwrite') report.overwritten.push(w.key);
        else report.renamed.push({ from: w.from as string, to: w.key });
      }
      return report;
    },

    /** A link carrying the item itself (not its local id). Check `tier` before offering it. */
    async shareLink(id: string, baseUrl: string | URL, linkOpts?: ShareLinkOptions): Promise<ShareLink> {
      return makeShareLink(wrap(await provider.getOne(id), spec, { now }), baseUrl, linkOpts);
    },

    /** The item a link carries, migrated and validated; `null` if the link carries none. */
    readLink(url: string | URL, linkOpts?: Pick<ShareLinkOptions, 'key' | 'part'>): T | null {
      const raw = readShareLink(url, linkOpts);
      return raw === null ? null : unwrap(raw, spec);
    },
  };
}

export type Persistence<T extends object> = ReturnType<typeof createPersistence<T>>;

/**
 * zodal operation definitions for `defineCollection(schema, {operations})`.
 * Names are stable; wire each to the matching `Persistence` method.
 */
export const persistenceOperations = [
  { name: 'holdall.exportAll', label: 'Export all', scope: 'collection' },
  { name: 'holdall.import', label: 'Import…', scope: 'collection' },
  { name: 'holdall.saveFile', label: 'Save to file', scope: 'item' },
  { name: 'holdall.shareLink', label: 'Copy share link', scope: 'item' },
] as const;
