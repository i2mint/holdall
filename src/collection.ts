/**
 * Whole-collection export files: one envelope whose data is `{items: {key: value}}`.
 * Parsing validates item by item, so one bad record is reported, not fatal.
 */
import { type Envelope, type EnvelopeSpec, isEnvelope, migrate, validate, wrap } from './envelope';
import { HoldallError } from './errors';
import { type Entry, toEntries, type Keyed } from './merge';

/** The `kind` of a collection envelope, derived from the item kind. */
export const collectionKind = (itemKind: string) => `${itemKind}:collection`;

export interface CollectionData<V> {
  items: Record<string, V>;
}

export function exportCollection<V>(
  items: Keyed<V>,
  spec: Pick<EnvelopeSpec, 'app' | 'kind' | 'version'>,
  { now }: { now?: () => Date } = {},
): Envelope<CollectionData<V>> {
  return wrap({ items: Object.fromEntries(toEntries(items)) }, { ...spec, kind: collectionKind(spec.kind) }, { now });
}

export interface ParsedCollection<V> {
  items: Entry<V>[];
  rejected: { key: string; error: HoldallError }[];
  /** `collection` for an export file, `item` for a single saved item. */
  source: 'collection' | 'item';
}

/**
 * Read a collection export, or a single-item envelope (needs `keyOf`).
 * Accepts the raw JSON text or an already-parsed value.
 */
export function parseCollection<V>(
  raw: unknown,
  spec: EnvelopeSpec<V>,
  { keyOf }: { keyOf?: (value: V) => string } = {},
): ParsedCollection<V> {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch (e) {
      throw new HoldallError('bad-payload', 'This file is not valid JSON.', e);
    }
  }
  if (!isEnvelope(value)) {
    throw new HoldallError('not-an-envelope', 'This file was not exported by a holdall-aware app.');
  }
  if (value.app !== spec.app) throw new HoldallError('wrong-app', `This file was saved by "${value.app}", not "${spec.app}".`, value.app);
  if (value.version > spec.version) {
    throw new HoldallError('too-new', `This file comes from a newer version (schema ${value.version}). Reload to update the app.`, value.version);
  }
  const readItem = (v: unknown): V => validate(migrate(v, value.version, spec.version, spec.migrations), spec.schema);

  if (value.kind === spec.kind) {
    if (!keyOf) throw new HoldallError('wrong-kind', 'This is a single item; pass `keyOf` to import it into a collection.');
    const item = readItem(value.data);
    return { items: [[keyOf(item), item]], rejected: [], source: 'item' };
  }
  if (value.kind !== collectionKind(spec.kind)) {
    throw new HoldallError('wrong-kind', `This file holds "${value.kind}", not "${collectionKind(spec.kind)}".`, value.kind);
  }
  const data = value.data as Partial<CollectionData<unknown>> | null;
  if (!data || typeof data.items !== 'object' || data.items === null) {
    throw new HoldallError('invalid', 'This collection file has no `items` object.');
  }
  const out: ParsedCollection<V> = { items: [], rejected: [], source: 'collection' };
  for (const [key, item] of Object.entries(data.items)) {
    try {
      out.items.push([key, readItem(item)]);
    } catch (e) {
      if (!(e instanceof HoldallError)) throw e;
      out.rejected.push({ key, error: e });
    }
  }
  return out;
}
