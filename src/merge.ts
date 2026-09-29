/**
 * Import planning: compare an incoming set of keyed values with what is held,
 * then turn the plan plus the user's decisions into writes.
 *
 * Two steps on purpose. `planImport` is a dry run a UI can show ("3 new,
 * 5 already here, 2 differ"); `resolveImport` applies a policy (default:
 * keep both, renaming the incoming key with a prefix) plus any per-key
 * decisions the user made. Nothing is ever dropped silently.
 */
import canonicalize from 'canonicalize';

export type Entry<V> = readonly [key: string, value: V];
export type Keyed<V> = Iterable<Entry<V>> | Map<string, V> | Record<string, V>;

export interface Conflict<V> {
  key: string;
  existing: V;
  incoming: V;
}

export interface ImportPlan<V> {
  /** Keys not held yet. */
  added: Entry<V>[];
  /** Keys held with an equal value: importing them changes nothing. */
  identical: string[];
  /** Keys held with a different value: these need a decision. */
  conflicts: Conflict<V>[];
  /** Every key held before the import (used to find a free name when renaming). */
  heldKeys: string[];
}

/** Equality by RFC 8785 canonical JSON: key order and number formatting do not matter. */
export const canonicalEquals = (a: unknown, b: unknown): boolean => canonicalize(a) === canonicalize(b);

export function toEntries<V>(keyed: Keyed<V>): Entry<V>[] {
  if (keyed instanceof Map) return [...keyed.entries()];
  if (Symbol.iterator in Object(keyed)) return [...(keyed as Iterable<Entry<V>>)];
  return Object.entries(keyed as Record<string, V>);
}

export function planImport<V>(
  held: Keyed<V>,
  incoming: Keyed<V>,
  { equals = canonicalEquals }: { equals?: (a: V, b: V) => boolean } = {},
): ImportPlan<V> {
  const heldMap = new Map(toEntries(held));
  const plan: ImportPlan<V> = { added: [], identical: [], conflicts: [], heldKeys: [...heldMap.keys()] };
  for (const [key, value] of toEntries(incoming)) {
    if (!heldMap.has(key)) plan.added.push([key, value]);
    else if (equals(heldMap.get(key) as V, value)) plan.identical.push(key);
    else plan.conflicts.push({ key, existing: heldMap.get(key) as V, incoming: value });
  }
  return plan;
}

/** What to do with one conflict. */
export type Resolution = 'rename' | 'overwrite' | 'skip';

export interface ResolveOptions<V> {
  /** Applied to every conflict without an explicit decision. Default `'rename'`. */
  policy?: Resolution;
  /** Per-key decisions, typically collected by a dialog. */
  decisions?: Record<string, Resolution>;
  /** Prefix for renamed incoming keys. Default `'imported-'`. */
  prefix?: string;
  /** Build a candidate key; `attempt` starts at 1 and grows until the key is free. */
  renameKey?: (key: string, attempt: number, prefix: string) => string;
  /** Put the new key into the value, when the value also carries its key (e.g. an `id` field). */
  rekey?: (value: V, newKey: string) => V;
}

export type WriteAction = 'add' | 'overwrite' | 'rename';

export interface Write<V> {
  key: string;
  value: V;
  action: WriteAction;
  /** For `rename`: the key the value came in under. */
  from?: string;
}

export interface ImportResolution<V> {
  writes: Write<V>[];
  skipped: string[];
  identical: string[];
}

const defaultRenameKey = (key: string, attempt: number, prefix: string) =>
  attempt === 1 ? `${prefix}${key}` : `${prefix}${attempt}-${key}`;

export function resolveImport<V>(plan: ImportPlan<V>, opts: ResolveOptions<V> = {}): ImportResolution<V> {
  const {
    policy = 'rename',
    decisions = {},
    prefix = 'imported-',
    renameKey = defaultRenameKey,
    rekey = (v: V) => v,
  } = opts;
  const taken = new Set([...plan.heldKeys, ...plan.added.map(([k]) => k)]);
  const out: ImportResolution<V> = {
    writes: plan.added.map(([key, value]) => ({ key, value, action: 'add' as const })),
    skipped: [],
    identical: [...plan.identical],
  };
  for (const { key, incoming } of plan.conflicts) {
    const choice = decisions[key] ?? policy;
    if (choice === 'skip') out.skipped.push(key);
    else if (choice === 'overwrite') out.writes.push({ key, value: incoming, action: 'overwrite' });
    else {
      let attempt = 1;
      let newKey = renameKey(key, attempt, prefix);
      while (taken.has(newKey)) newKey = renameKey(key, ++attempt, prefix);
      taken.add(newKey);
      out.writes.push({ key: newKey, value: rekey(incoming, newKey), action: 'rename', from: key });
    }
  }
  return out;
}
