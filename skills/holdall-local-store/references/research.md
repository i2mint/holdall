# Local store: research extract

Extract of the holdall research (state as of 2026-09-29) that backs the `holdall-local-store` skill. Numbers were read from the npm registry, GitHub and the cited pages on that date; anything unverified is labelled. Citations use Vancouver numbering local to this file.

## 1. Where records can live

localStorage holds about 5 MiB per origin (sessionStorage a separate 5 MiB), stores strings only, is synchronous (it blocks the main thread on every read and write) and throws `QuotaExceededError` when full [1]. IndexedDB, the Cache API and OPFS share one origin quota: Chromium up to 60% of disk, Firefox the smaller of 10% of disk or 10 GiB per site (persistent mode up to 50%), Safari about 60% of disk for browser apps since macOS 14 / iOS 17 [1][2]. Rule of thumb used by the skill: keep only small (under about 100 KB), rarely written, non-sensitive values in localStorage; move to IndexedDB past about 1 MB, for Blobs and typed arrays, for indexes or transactions, for frequent writes, or when main-thread jank matters.

| Library | License | Notes (2026-09-29) |
|---|---|---|
| [idb](https://github.com/jakearchibald/idb) [12] | ISC | Promisified IndexedDB, typed via `DBSchema`; 1.3 KB gz; `openDB(name, version, {upgrade, blocked, blocking})`; no cross-tab support built in, use the `blocking` callback plus BroadcastChannel |
| [idb-keyval](https://github.com/jakearchibald/idb-keyval) [13] | Apache-2.0 | `get/set/update/getMany/setMany/del/keys/entries/createStore`; 0.5 KB gz; a single object store, no migrations, no cross-tab |
| [Dexie](https://github.com/dexie/Dexie.js) [14] | Apache-2.0 | Tables, indexes, `liveQuery` (propagates across tabs), `db.version(n).stores({...}).upgrade(tx => ...)` chain [15][16]; 32 KB gz; Dexie Cloud is a separate paid service |
| [localForage](https://github.com/localForage/localForage) [17] | Apache-2.0 | Dormant (last release 2021); do not adopt |
| [unstorage](https://unstorage.unjs.io/) [18] | MIT | Unified async key-value with many drivers; its IndexedDB driver has no cross-tab `watch` [19] |
| zustand `persist` [20] | MIT | Middleware with `name`, `storage`, `partialize`, `version`, `migrate`, `skipHydration`, `rehydrate()`; one `migrate(persisted, version)` function you write; cross-tab is manual (listen to the `storage` event and call `rehydrate()`); when the stored version differs and no `migrate` is given, the persisted state is discarded [20] |

RxDB puts its OPFS, IndexedDB and SQLite storages behind a paid tier, so it is not a default for a permissive stack (see the npm and vendor pages; not linked here because the price table changes).

OPFS is private to the origin, invisible to the user and needs no prompts. It counts against the same quota and is deleted by "clear site data" like IndexedDB [7]. The SQLite project says OPFS databases "may disappear due to virus scanners, cleaner software, browser permissions, or automatic browser cleanup" [8]. Its synchronous access handles work only in dedicated workers [7]. `@sqlite.org/sqlite-wasm` (Apache-2.0) offers `opfs`, `opfs-sahpool` (fastest, single connection, no special headers) and `kvvfs` backends [8]. Design point: no engine changes the durability class; a SQLite file in OPFS is exactly as evictable as an IndexedDB store, so a file the user holds is still the durability path.

## 2. Eviction and durability, in one paragraph

Storage is best-effort by default: the browser may clear an origin under pressure, least recently used first, and it clears all of an origin's data together, not parts [1][6]. `navigator.storage.persist()` asks for persistent mode; Chromium and Safari decide silently by heuristics, Firefox prompts after a user gesture [5][2]. Safari deletes script-writable storage after 7 days of Safari use without user interaction with the site, and a WebKit bug reports that this is not prevented by `persist()` (still open at last check) [3][4]. Home Screen web apps have their own container and are exempt from the 7-day cap [2][3]. "Clear site data" removes everything including OPFS [1][6]. The full per-engine matrix lives in the `holdall-durability` skill.

## 3. Envelope and migration prior art

| Product | Envelope | Versioning |
|---|---|---|
| Excalidraw file | `{type, version, source, elements, appState, files}` | `type` discriminator plus integer `version`; validators check both [27] |
| tldraw file | `{tldrawFileFormatVersion, schema, records}` | Two layers: a file-format version (throws if newer than the code) and per-record migration sequences with ids and dependencies [25][26] |
| zustand persist | `{state, version}` | `version` plus one `migrate` function [20] |
| Dexie / idb | database version integer | `version(n).upgrade()` chain, or `upgrade(db, oldVersion, newVersion, tx)` [15][12] |

No adopted permissive migration library exists on npm, so holdall ships a tiny forward-only chain (`migrations[n]` turns version n into n+1; a gap throws `missing-migration`; newer data throws `too-new`). Rules the research supports: refuse newer versions with a typed error and do not overwrite storage (tldraw and Excalidraw both throw); back up the pre-migration value under a separate key before writing; keep migrations pure and test them with golden fixtures; validate on load, not only on import. The validator seam is [Standard Schema](https://standardschema.dev) [28], implemented by Zod 4, Valibot and ArkType, so the toolkit accepts any of them. Measured gz cost for a trivial two-field schema: Valibot 1.1 KB, `zod/v4-mini` 4.3 KB, Zod 4 classic named imports 25.4 KB; a namespace import (`import {z}`) pulled about 90 KB in the test build, so import named functions.

## 4. JSON versus structured clone

IndexedDB, `postMessage` and `structuredClone` share the structured clone algorithm: Date, Map, Set, RegExp, ArrayBuffer and typed arrays, Blob, File, Error types and BigInt survive; functions, DOM nodes and symbols are rejected; prototypes, getters and class identity are dropped [24]. JSON (localStorage, export files, URLs, hashing) turns a Date into a string, a Map or Set into `{}` or `[]`, throws on BigInt, drops `undefined`, and cannot hold a Blob. Tools: Zod 4 codecs (`z.codec`, `z.decode`, `z.encode`) convert at the boundary and stay typed [21]; superjson (MIT, about 4 KB gz) writes a JSON-valid `{json, meta}` pair and handles Date, Map, Set, BigInt, undefined, RegExp [22]; devalue (MIT) is compact and handles cycles, but is designed for data that stays inside your origin [23]. Excalidraw inlines images as data URLs in its `files` map, which balloons file size [27]; the skill therefore stores blobs separately and exports them separately.

## 5. Cross-tab consistency

| Mechanism | What it does | Limits |
|---|---|---|
| `storage` event | Fires in the other same-origin documents when localStorage changes, not in the writer [9] | localStorage and sessionStorage only; no event for IndexedDB or OPFS |
| `BroadcastChannel` | Message bus across same-origin windows, tabs, frames, workers; the sender does not receive its own message [10] | No persistence, no delivery to tabs opened later; Baseline since 2022 |
| Web Locks (`navigator.locks`) | Named exclusive or shared locks across tabs and workers; released when the tab closes or crashes; supports leader election [11] | Origin-scoped; avoid nested locks; Baseline since 2022 |

Recommended combination: Web Locks to serialise read-modify-write and elect a leader, BroadcastChannel to say "data changed, re-read" (carry a key or version, not the data), the `storage` event only for localStorage-backed stores. On a notification, re-read from the store instead of trusting the message payload, because a frozen or newly opened tab has missed messages.

## REFERENCES

1. MDN. [Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
2. WebKit blog. [Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/).
3. WebKit blog. [Full Third-Party Cookie Blocking and More (ITP, 7-day cap)](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/).
4. WebKit Bugzilla. [Bug 209563: Support longterm persistent storage](https://bugs.webkit.org/show_bug.cgi?id=209563).
5. web.dev. [Persistent storage](https://web.dev/articles/persistent-storage).
6. WHATWG. [Storage Standard](https://storage.spec.whatwg.org/).
7. MDN. [Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system).
8. SQLite. [SQLite Wasm: persistence options](https://sqlite.org/wasm/doc/trunk/persistence.md).
9. MDN. [Window: storage event](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event).
10. MDN. [Broadcast Channel API](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API).
11. MDN. [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).
12. [idb repository](https://github.com/jakearchibald/idb).
13. [idb-keyval repository](https://github.com/jakearchibald/idb-keyval).
14. [Dexie.js repository](https://github.com/dexie/Dexie.js).
15. [Dexie docs: Version.upgrade()](https://dexie.org/docs/Version/Version.upgrade()).
16. [Dexie docs: Dexie.on.storagemutated](https://dexie.org/docs/Dexie/Dexie.on.storagemutated).
17. [localForage repository](https://github.com/localForage/localForage).
18. [unstorage documentation](https://unstorage.unjs.io/).
19. [unstorage source: drivers/indexedb.ts](https://github.com/unjs/unstorage/blob/main/src/drivers/indexedb.ts).
20. [Zustand docs: Persisting store data](https://zustand.docs.pmnd.rs/reference/integrations/persisting-store-data).
21. [Zod docs: Codecs](https://zod.dev/codecs).
22. [superjson repository](https://github.com/blitz-js/superjson).
23. [devalue repository](https://github.com/sveltejs/devalue).
24. MDN. [The structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).
25. [tldraw source: tldr/file.ts](https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/utils/tldr/file.ts).
26. [tldraw source: store/migrate.ts](https://github.com/tldraw/tldraw/blob/main/packages/store/src/lib/migrate.ts).
27. [Excalidraw source: data/json.ts](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/json.ts).
28. [Standard Schema](https://standardschema.dev).
