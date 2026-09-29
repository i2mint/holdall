---
name: holdall-local-store
description: >-
  Where records live in the browser and how to keep them safe. Use when asked to "save the user's data locally", "persist state", "use localStorage or IndexedDB", "localStorage vs IndexedDB vs OPFS", "idb-keyval / Dexie / idb", "store without a backend", "don't lose my input", "autosave", "restore draft", "migrate stored data", "change the schema of saved data", "version the storage", "QuotaExceededError", "storage is full", "private mode", "corrupt JSON in storage", "sync state between tabs", "zustand persist", "store images/blobs offline", "Dates lost after reload". Covers the storage decision table, one store interface as a single seam, key namespacing, envelope plus forward-only migrations, validation, JSON versus structured clone, autosave and drafts, error handling, cross-tab consistency and blobs.
license: MIT
metadata:
  package: holdall
---

# holdall-local-store: records in the browser, kept safe

Use this when an app must keep records (documents, settings, drafts, files) in the browser with no server. The goal is not "call `setItem`"; it is that a reload, a schema change, a second tab, a full disk or a corrupt value never costs the user their work. Browser storage is a cache the user can wipe; the file or link they hold is the record (see `holdall-files`, `holdall-durability`).

## 1. Choose the backend

| Backend | Pick when | Limits | Library |
|---|---|---|---|
| in-memory | tests, "view mode" of someone else's data, the fallback when storage is blocked | gone on reload | a `Map` behind the store interface |
| localStorage | small (well under 1 MB), rarely written, string values: prefs, a tiny collection, a last-open id | about 5 MiB, synchronous (blocks the main thread), strings only, throws when full, `storage` event for other tabs | none |
| IndexedDB | past about 1 MB, many records, Blobs or typed arrays, frequent writes, indexes, transactions | async; shares the origin quota; evictable like everything else | `idb-keyval` (key-value), `idb` (typed, indexes), `Dexie` (queries, `liveQuery`, migrations chain) |
| OPFS | big files, SQLite wasm (`@sqlite.org/sqlite-wasm`), engines that want a real filesystem | sync handles only in workers; same eviction as IndexedDB | the engine's own docs |

Default: start with IndexedDB via `idb-keyval` unless the data is provably tiny; move up to Dexie when you need queries or a migration chain at the database level. Leave localStorage when the data nears 1 MB or needs binary or query support. Avoid localForage (dormant) and RxDB (paid storages). None of these changes durability: all of them are wiped by "clear site data" and evicted together per origin.

## 2. One store interface: the seam is one parameter

Never scatter `localStorage.getItem` through the app. Depend on a small interface and pass the implementation in. Changing backend then changes one argument.

```ts
export interface KV {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
export const memoryKV = (): KV => { /* Map-backed; also the fallback when storage is blocked */ };
export const idbKV = (dbName: string): KV => { /* idb-keyval createStore(dbName, 'kv') */ };
export const localKV = (): KV => { /* JSON.stringify / JSON.parse around localStorage */ };
```

In a zodal app the same seam already exists: `DataProvider<T>` from `@zodal/store`. `@zodal/store-localstorage` gives `createLocalStorageProvider({storageKey, idField})` for records and `createIndexedDBContentProvider` / `createIndexedDBBlobProvider` / `createBrowserBifurcatedProvider` for content fields. Use `holdall/zodal` `createPersistence({provider, app, kind, version, ...})` on top. Read the caveats in section 8 before relying on the localStorage provider for user data.

Non-JS stacks: the same rules hold with the platform's store; keep the envelope JSON so files and links stay portable.

## 3. Namespace every key

Apps on one origin (for example `apps.example.com/a/` and `/b/`) share localStorage, IndexedDB and one quota, and "Clear site data" wipes all of them. Name keys `<app>.<collection>.v<N>` (localStorage), or database `<app>` with one object store per collection (IndexedDB). Per-record keys: `<app>.<collection>.v<N>:<id>`. Never clear origin-wide; only remove keys with your prefix. `N` is the storage-layout major version (section 4), not the schema version.

## 4. Envelope, version, forward-only migrations

Every persisted value is `{app, kind, version, data}` (`wrap`), and reading goes through `unwrap(raw, spec)`, which checks app and kind, refuses `version` newer than the code (`too-new`), runs `migrations[v]` for each step up to the current version (`missing-migration` on a gap), then validates.

```ts
import { wrap, unwrap, isHoldallError, type EnvelopeSpec } from 'holdall';
import { z } from 'zod'; // any Standard Schema works; import named functions to keep the bundle small

const NoteV2 = z.object({ id: z.string(), title: z.string(), tags: z.array(z.string()), updatedAt: z.string() });
export const noteSpec: EnvelopeSpec<z.infer<typeof NoteV2>> = {
  app: 'notes', kind: 'note', version: 2,
  schema: NoteV2,
  migrations: { 1: (d: any) => ({ ...d, tags: d.tags ?? [] }) }, // v1 -> v2, pure, unit-tested with a fixture
  bareVersion: 1,                                                  // legacy values written before envelopes count as v1
};
```

Rules: bump `version` on any shape change and add exactly one migration; migrations are pure and never removed; validate on load, not only on import; write the pre-migration value to a backup key before the first migrated write.

Two levels of change, do not mix them:
- Shape change inside a collection: integer `version` plus a migration, applied lazily on read.
- Layout change (one key holding an array becomes one key per record, or a move from localStorage to IndexedDB): new key name per major version (`notes.docs.v2`). Run a one-time migration that reads `.v1`, writes `.v2`, then writes a completion marker (`notes.docs.v2.migrated`). Never delete the old key in the same release; delete it a release later, after a backup nudge.

## 5. Read and write safely

```ts
type Loaded<T> =
  | { status: 'ok'; data: T } | { status: 'empty' }
  | { status: 'too-new' }                       // read-only mode: never write
  | { status: 'corrupt'; keptAt?: string }      // ask the user; never overwrite
  | { status: 'unavailable' };                  // storage blocked: fall back to memoryKV, say so

export async function load<T>(kv: KV, key: string, spec: EnvelopeSpec<T>): Promise<Loaded<T>> {
  let raw: unknown;
  try { raw = await kv.get(key); } catch { return { status: 'unavailable' }; }
  if (raw == null) return { status: 'empty' };
  try { return { status: 'ok', data: unwrap(raw, spec) }; }
  catch (e) {
    if (isHoldallError(e, 'too-new')) return { status: 'too-new' };
    const keptAt = `${key}.corrupt-${Date.now()}`;
    try { await kv.set(keptAt, raw); } catch { /* quota: still do not overwrite the original */ }
    return { status: 'corrupt', keptAt };
  }
}

export async function save<T>(kv: KV, key: string, value: T, spec: EnvelopeSpec<T>) {
  try { await kv.set(key, wrap(value, spec)); return { ok: true as const }; }
  catch (e) { return { ok: false as const, quota: (e as DOMException)?.name === 'QuotaExceededError', error: e }; }
}
```

In a localStorage-backed `KV`, have `get` return the raw string when `JSON.parse` fails (do not throw and do not return `undefined`): `unwrap` then rejects it and the corrupt copy is kept byte-exact. Validate the whole value on load with the schema, and per item when the value is a collection (`parseCollection` reports rejected items instead of failing the batch).

## 6. Rich types at the JSON boundary

IndexedDB stores values with structured clone: Date, Map, Set, BigInt, Blob, typed arrays survive, so do not JSON-encode values on the way in. localStorage, export files, share links and hashing are JSON: a Date becomes a string, a Map becomes `{}`, BigInt throws, `undefined` vanishes. Declare the conversion once, at the schema.

- Zod 4: a codec (`z.codec(z.iso.datetime(), z.date(), {decode, encode})`; `z.encode(schema, value)` before writing, `z.decode` after reading) keeps the runtime type rich and the persisted type plain JSON.
- No Zod: superjson (`{json, meta}`, JSON-valid) for Date/Map/Set/BigInt; devalue only for data that never leaves the origin.
- Framework proxies (Vue `reactive`, Svelte `$state`) throw `DataCloneError` in IndexedDB; snapshot to a plain object before writing.
- The exported JSON contract stays plain: dates as ISO strings, blobs by reference (section 10).

## 7. Never lose input: autosave and drafts

`createAutosave({save, delay = 400, onError, win, doc})` returns `{schedule, flush, pending, dispose}`. It debounces, flushes on `pagehide` and on `visibilitychange` to hidden, and keeps a failed value pending for the next flush.

```ts
import { createAutosave, wrap } from 'holdall';
const draftKey = `draft:${userId}:${context}:${itemId}:${formId}`;   // one draft per user, place, item and form
const draftSpec = { app: 'notes', kind: 'draft', version: 1 };
const auto = createAutosave<FormValues>({
  save: (v) => draftKV.set(draftKey, wrap(v, draftSpec)),
  onError: () => showBanner('Not saved yet. Keep this tab open, or save a file.'),
});
form.onChange((v) => auto.schedule(v));
async function onSubmit(v: FormValues) { await api.submit(v); await draftKV.remove(draftKey); } // clear ONLY after confirmed submit
window.addEventListener('beforeunload', () => void auto.flush());
```

- On mount, read the draft; if it exists and differs from the loaded item, show a "Restore draft?" banner with Restore and Discard. Never apply it silently.
- Call `await auto.flush()` before `dispose()` (unmount, route change): `dispose` clears the timer but does not write the pending value.
- A failed write is retried on the next `schedule` or `flush`, not on a timer: show "not saved" and offer a retry button that calls `flush()`.
- On `pagehide` an async IndexedDB write is not guaranteed to finish; small drafts in a synchronous localStorage `KV` are the safest last-chance write. This is engineering judgment, not researched; test it on iOS Safari.

## 8. Errors, blocked storage and the zodal localStorage provider

- `QuotaExceededError` on write: keep the value in memory, tell the user, offer "Save backup" now, do not retry in a loop. Show usage from `navigator.storage.estimate()` as approximate.
- Blocked storage (private mode, cookies disabled, sandboxed iframe): touching `localStorage` may throw `SecurityError`. Probe at startup (write, read, remove a test key inside try/catch), fall back to `memoryKV`, and say "Changes won't be kept after you close this tab. Save a file."
- Corrupt value: keep the raw text aside (`<key>.corrupt-<ts>`), do not write to the original key until the user picks "restore from file" or "start fresh", and tell them.
- Newer-than-code data (`too-new`): open read-only and ask to reload; never write it back.
- Ask for persistence after the first save with `ensurePersistence` (see `holdall-durability`).

`createLocalStorageProvider` (source read 2026-09-29) stores the whole collection as one JSON array under one key. It swallows a `JSON.parse` error and returns `[]`, so the next `create` overwrites a corrupt key with a fresh array: silent total loss. Its writes have no `try/catch`, so a full disk rejects from `create`/`update`. It has no `subscribe` and no cross-tab handling, and it generates ids from `Date.now()` if you omit one. Wrap it: run `load` (section 5) on the key first, pass your own ids (`crypto.randomUUID()`), catch quota errors, and add a `storage` listener yourself. For more than a few hundred records write a `DataProvider` over `idb-keyval`; the package's IndexedDB providers hold content fields, not records.

## 9. Cross-tab consistency

Two tabs can read-modify-write the same key and lose an update. Combine:

```ts
await navigator.locks.request(`${app}.${collection}`, async () => {   // serialise writers across tabs
  const cur = await load(kv, key, spec);
  await save(kv, key, mutate(cur), spec);
  new BroadcastChannel(`${app}.${collection}`).postMessage({ key });   // "changed, re-read"; carries a key, not data
});
```

- Web Locks serialise writers and elect a leader; BroadcastChannel tells other tabs to re-read (the sender does not receive its own message; a tab opened later missed it, so also re-read on `visibilitychange` to visible); the `storage` event only for localStorage-backed stores.
- IndexedDB fires no event by itself; Dexie's `liveQuery` handles it, `idb` needs the `blocking` callback plus a channel.
- zustand `persist` (with `createJSONStorage`): fine for UI prefs and small view state. Give it a namespaced `name`, a `version` and a `migrate` (without `migrate`, a version mismatch discards the state), `partialize` to persist only what is needed, and a `storage`-event listener that calls `rehydrate()`. It rewrites one blob per change and has no envelope, so keep document collections in a real store behind `KV` and let zustand hold only the working set.

## 10. Blobs

Images, audio and PDFs do not belong inside record JSON or localStorage. Store each blob in IndexedDB under a content-hash key and reference it from the record.

```ts
const buf = await blob.arrayBuffer();
const digest = await crypto.subtle.digest('SHA-256', buf);
const id = 'sha256-' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
await blobKV.set(`blob:${id}`, blob);       // same bytes, same key: free deduplication
record.attachments.push({ blob: id, name: file.name, type: blob.type });
```

Export bundles the referenced blobs (a zip, or one file per blob beside the JSON) rather than inlining base64, and import re-hashes them. Remove orphans with a mark-and-sweep on idle, never at delete time, so undo and tombstones still work. Object URLs from `URL.createObjectURL` are for display only: revoke them, and never persist them.

## Pitfalls

1. Reading with `try { JSON.parse } catch { return [] }`, then writing: it turns any corrupt value into total loss. Keep the raw text aside and stop writing.
2. Unversioned values: without `version` you cannot change the shape later. Envelope from the first write; `bareVersion` covers legacy data.
3. Deleting the old key when migrating: a rollback or a failed migration then has nothing to fall back on. Keep `.v1` for a release and write a completion marker.
4. Bare keys (`data`, `settings`) on a shared origin collide with the neighbor app and get wiped together. Prefix with `<app>.`.
5. Clearing a draft on "submit clicked": a failed submit then loses the input. Clear on confirmed success only.
6. Trusting `flush` after `dispose`: the pending value is dropped. Flush first.
7. Assuming `persist()` or install makes data safe: it lowers eviction risk only. Keep the export path (`holdall-files`).
8. Storing Blobs or big arrays in localStorage: quota errors and main-thread stalls. Use IndexedDB with hash keys.
9. `Date` in a JSON store without a codec: it returns as a string and breaks comparisons. Convert at the schema.
10. Whole-collection writes from two tabs: lost updates. Lock, or write per-record keys.

## Checklist

- Backend chosen from the table; store behind `KV` or `DataProvider`; keys start with `<app>.`.
- Envelope on every value; `version` integer; migrations pure with fixtures; `too-new` opens read-only.
- Load handles `empty`, `corrupt`, `too-new`, `unavailable`; corrupt raw text is kept aside.
- Dates and other rich types converted at the schema; blobs referenced by content hash.
- Autosave flushes on hide and before dispose; drafts cleared on confirmed submit; restore banner shown.
- Quota and blocked-storage paths tested (private window, filled-up storage); a second tab tested.
- Round trip: export, wipe site data, import; and an old-version fixture loads.

## References

- `references/research.md`: storage limits and library table, eviction summary, envelope prior art, JSON versus structured clone, cross-tab mechanisms, with a Vancouver reference list.
- Router: `holdall`; durability and install: `holdall-durability`; export and import: `holdall-files`.
