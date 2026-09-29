# Client-side persistence and sharing: URL state, IndexedDB/KV stores, formats, import/merge

Research date: 2026-09-29. Scope: choose permissive (MIT/Apache/ISC/BSD) dependencies for a headless, stack-agnostic, agent-first toolkit for client-side persistence and sharing, and write guidance.

Method notes. npm metadata (latest version, license, release date, weekly downloads) was pulled live from the npm registry and npm downloads API on 2026-09-29 [1]. GitHub metadata (stars, last push, archived) via the GitHub API [2]. Bundle sizes are MEASURED by me, not quoted: esbuild 0.x, `--minify`, browser platform, gzip level default, importing only the named functions a typical user would (bundlephobia returned HTTP 429). Compression ratios were measured on synthetic JSON (5, 50, 500 records of a "view/collection" shape), so treat them as directional, not as benchmarks of your data. Anything I could not verify is labelled UNVERIFIED.

## 0. Executive summary (RECOMMENDATIONS at a glance)

- A. URL share links: deflate-raw + base64url in the URL fragment, with a self-describing codec prefix (for example `z1.`) and an inner `{app, kind, version, data}` envelope. Use `fflate` (MIT, 4.5 KB gz, sync) as the default codec and native `CompressionStream('deflate-raw')` as a zero-dependency option. Do not add msgpack/CBOR (measured gain 0-2% after deflate). Keep `lz-string` decode-only for legacy links. Set a length budget (2K / 4K / 8K tiers) and fall back to a stored payload plus key-in-fragment (Excalidraw pattern) or a file when over budget. For readable, typed URL state in React use `nuqs` (MIT) or TanStack Router `validateSearch`; for headless use `serialize-query-params` (0.4 KB gz) or just `URLSearchParams` plus a Standard Schema validator.
- B. Storage: `idb-keyval` (Apache-2.0, 0.5 KB gz) as the default KV layer; `idb` (ISC, 1.3 KB gz) when indexes and versioned schema upgrades are needed; `Dexie` (Apache-2.0, 32 KB gz) only when live queries and rich indexed queries are the point; `unstorage` (MIT, 3.4 KB gz) if you want a ready-made multi-driver facade. `zustand/persist` for store slices. Avoid `localForage` (dormant since 2021/2024) and `RxDB` (its OPFS/IndexedDB storages are paid). Leave `localStorage` at roughly 1 MB, any binary, or any need to query.
- C. Persisted data: validate at the boundary with any Standard Schema validator (do not hard-depend on Zod: full Zod classic is about 25 KB gz for a trivial schema, `zod/mini` about 4 KB, `valibot` about 1 KB). Persist an envelope with an integer `version`, and run a small forward-only migration chain (no adopted library does this well; tldraw's `createMigrationSequence` is the best reference design). Refuse data newer than the running code. Use Zod 4 `z.codec` (or `superjson`/`devalue`) for Dates/BigInt/Map/Set at the JSON boundary; IndexedDB itself uses structured clone and needs none of that.
- D. Import/merge: identity by key, equality by content hash (RFC 8785 canonical JSON via `canonicalize` (Apache-2.0, 0.8 KB gz) or `fast-json-stable-stringify` (MIT), then native `crypto.subtle` SHA-256). Identical content is always a silent no-op; otherwise apply a pluggable strategy `skip | overwrite | keepBoth | ask` with "apply to all", and always produce a dry-run plan first. No library provides this UX, so a small policy engine is justified.

## 1. Topic A: URL state and share links

### 1.1 Compressing JSON into a URL

Options compared. Ratios are compressed-URL-chars divided by raw JSON bytes on my synthetic data (lower is better). "JSON percent-encoded" is the naive baseline and is 164-167% of raw.

| Option | License | Version / last release | Weekly dl | Size (min / gz) | Sync? | Ratio (5 / 50 / 500 records) | Notes |
|---|---|---|---|---|---|---|---|
| lz-string `compressToEncodedURIComponent` | MIT | 1.5.0 / 2023-03-04 | 75.4M | 5.3 KB / 1.7 KB | yes | 77% / 39% / 22% | Alphabet `A-Za-z0-9+-$`; `+` becomes a space in query strings (the decoder re-maps space to `+`), fine in a fragment. Returns `null` on malformed input rather than throwing. Finished but effectively frozen; GitHub repo only gets doc commits [3]. |
| fflate `deflateSync` + base64url | MIT | 0.8.3 / 2026-05-16 | 95.8M | 9.1 KB / 4.5 KB | yes (async/worker variants exist) | 50% / 22% / 15% | Zero deps, tree-shakable, actively maintained [4]. |
| pako deflate + base64url | MIT AND Zlib | 3.0.2 / 2026-09-12 | 133M | 41.2 KB / 12.5 KB | yes | same as fflate (same algorithm) | Used by Excalidraw and Mermaid Live [5][7][12]; 3x larger than fflate. |
| Native `CompressionStream('deflate-raw')` | platform | n/a | n/a | 0 KB | NO (streams, async) | 50% / 21% / 14% (zlib-equivalent) | Baseline widely available since May 2023; `deflate-raw` needs Chrome 103, Firefox 113, Safari 16.4 [1][2]. |
| Native `CompressionStream('brotli')` | platform | n/a | n/a | 0 KB | NO | best: 41% / 18% / 12% (measured with Node zlib) | NOT portable yet: Firefox 147 and Safari 18.4 have it, Chrome does not (tracked at crbug 463397980); `zstd` is flag-only in Firefox and absent in Chrome/Safari [2]. |
| msgpack (`@msgpack/msgpack` ISC 5.8 KB gz; `msgpackr` MIT 10 KB gz) then deflate | ISC / MIT | 3.1.3 / 2.1.0 | 5.8M / 42.7M | 5.8 / 10.2 KB gz | yes | 49% / 22% / 15% | Measured gain over plain deflate: 1-2%. Not worth a dependency or losing debuggability. |
| cbor-x | MIT | 1.6.6 | 3.1M | 10.5 KB gz | yes | not measured | Same argument as msgpack. |
| json-url (multi-codec: lzma, lzstring, pack, ...) | ISC | 4.0.0 / 2025-08 | 7K | 7 deps | no | n/a | Niche; do not adopt. |

Readable-parameter formats (for small filter-like state where humans read URLs). Measured on one object (`q, page, sort{by,dir}, tags[], inStock, min:null`): JSON percent-encoded 199 chars; jsurl 86; rison 76 (108 after percent-encoding its `!`, `(`, `'`); urlon 78; plain flat query string 57.

| Library | License | Last release | Weekly dl | Status |
|---|---|---|---|---|
| jsurl | MIT (npm) / none on GitHub | 2016-12 | 139K | UNMAINTAINED (last commit 2023) |
| jsurl2 | MIT (npm) / none on GitHub | 2024-03 | small | one maintainer, low adoption |
| rison | Apache-2.0 | 2014-10 | 108K | UNMAINTAINED (Kibana lineage) |
| urlon | MIT | 2021-04 | 2.7K | UNMAINTAINED |

Findings on how real products do it:
- Excalidraw stores the scene server-side (encrypted) and puts only `id,key` in the fragment (`#json=<id>,<key>`); the payload is deflated with pako and AES-GCM encrypted [6][7][8]. The encoder wraps every buffer in a version-stamped container (`CONCAT_BUFFERS_VERSION = 1`) and the reader throws on a higher version [7].
- Mermaid Live Editor puts state in the fragment as `#pako:<base64url(deflate level 9 of JSON)>`. Its `serde.ts` is the cleanest prior art for codec-prefix versioning: `serializeState` emits `<serde>:<payload>`, `deserializeState` accepts unprefixed payloads as legacy `base64`, and throws on an unknown prefix [12].
- TypeScript Playground uses `#code/<lz-string compressToEncodedURIComponent>` (search-result level evidence; I did not open the handbook page) [13].
- Plannotator (a small OSS app) hit exactly the wall this toolkit must plan for: 10-40 KB share URLs got truncated in Slack and other messengers, and the maintainers proposed an optional paste service with short IDs while keeping old hash links working [20].

Security and robustness notes (mine, from the above): cap decompressed output size when decoding untrusted links (decompression bombs); treat every decoded link as untrusted input and validate with a schema; compress after pruning default-valued fields (TanStack Router `stripSearchParams` and nuqs `clearOnDefault` do this for query params [29][31]); use level 9 (the ratio gain over default is small but free at share time).

RECOMMENDATION (A1, codec): base64url(deflate-raw(UTF-8 JSON)). Implement behind one `Codec` interface with two shipped strategies: `fflate` (default, sync, works everywhere and in Node for agents/tests) and native `CompressionStream` (0 KB, async). Keep `lz-string` only as a decoder for legacy links. No msgpack/CBOR. Do not use jsurl/rison/urlon.

### 1.2 Practical URL length limits

Browsers (numbers are from aggregator pages and vendor blogs; the exact Safari figure is UNVERIFIED and the Firefox figure is a display limit):

| Client | Limit | Source note |
|---|---|---|
| Chrome / Chromium | 2 MB (2,097,152 chars) URL; omnibox displays up to 32 KB | Chromium-dev discussion and docs [19] |
| Firefox | Practically unlimited for navigation; the location bar stops displaying past 65,536 chars; a `network.standard-url.max-length` pref exists (1 MB) | aggregator pages [19]; pref value only seen in a policy listing, UNVERIFIED |
| Safari | about 80,000 chars reported | aggregator pages only, UNVERIFIED [19] |
| Legacy IE / old Edge | 2,083 chars (`INTERNET_MAX_URL_LENGTH`); address bar 2,047 | Microsoft IEInternals [14] |
| Safe cross-everything figure | 2,048 chars | multiple aggregators [19] |

Servers, proxies and CDNs (these only matter for URLs that are sent to a server, so NOT for the fragment):

| Component | Limit | Source |
|---|---|---|
| nginx default | `large_client_header_buffers 4 8k`: request line over one 8K buffer returns 414 | [17] |
| Node.js http | 16 KiB header limit default (was reduced to 8 KiB in 11.6-13.12, restored in 13.13); 431 on excess | [18] |
| Cloudflare | URL 16 KB; request headers 128 KB total (raised from 32 KB in Oct 2025) | [15] |
| AWS CloudFront | URL 8,192 bytes; whole request line plus headers 32,768 bytes | [16] |
| Apache | `LimitRequestLine` default 8,190 (not re-verified in this session) | UNVERIFIED |

Messaging apps, link unfurlers and email (weakest evidence; mostly anecdotes and issue trackers, none of these vendors publish a URL limit):

| Channel | What is known | Source |
|---|---|---|
| Slack | Hard message cap 40,000 chars; docs advise 4,000 for `chat.postMessage`. Bot-posted URLs above about 4,000 bytes were split across two messages (4,060-byte URL split at 3,992). Plannotator reports 10-40 KB share links truncated/broken. Human-typed paste behavior UNVERIFIED. | [21][22][20] |
| Discord | 2,000-char message limit (4,000 with Nitro), so the URL must fit in that | [24] |
| WhatsApp / iMessage | No published URL limit found. Previews truncate titles (WhatsApp about 65 chars, iMessage about 44) but that is metadata, not the URL. Plannotator reports WhatsApp and iMessage truncation for very long URLs (anecdotal). | search results, [20] |
| X / Twitter | Any link is wrapped by t.co and counted as 23 chars | search results |
| Outlook desktop | Old limit 2,083 (hyperlinks truncated at 2,048 by SafeLinks rewriting); fixed to 8,192 in build 16116.10000 | Microsoft Q&A [23] |
| Gmail | Wraps long lines visually; long links break some table layouts in the Android app | search results |
| Unfurlers in general | Fetch the URL server-side and never see the fragment, so hash-based state yields a generic preview; only query-string state can drive a per-state Open Graph preview | reasoning from [26] |

Derived budgets for the toolkit (mine): treat 2,000 chars as "safe everywhere" (Discord, old Outlook), about 4,000 as "chat-safe" (Slack line splitting), about 8,000 as "email and CDN-safe" (CloudFront, modern Outlook, nginx default), above that as "must offer an alternative". These should be configurable constants, not magic numbers.

RECOMMENDATION (A2, limits): ship `measure(url)` and a tiered `ShareBudget` (warn at 2K, warn strongly at 4K, refuse by default at 8K, all overridable). Above budget, automatically offer (a) a stored payload plus key in the fragment (Excalidraw's pattern [6][8]) through a pluggable `ShareStore` seam, or (b) a downloadable file. Recompute after compression, since raw JSON grows about 65% when percent-encoded and shrinks 50-86% when deflated.

### 1.3 Hash fragment versus query string

| Aspect | Fragment (`#...`) | Query (`?...`) |
|---|---|---|
| Sent to your server / CDN / access logs | No; browser never sends it [26] | Yes; also subject to the server limits above |
| In `Referer` sent to other sites | Never; the Referrer Policy spec strips fragment, username and password [25] | Subject to the Referrer-Policy; default `strict-origin-when-cross-origin` trims cross-origin referrers to the origin, but same-origin requests carry the full URL |
| Server-side rendering / per-state Open Graph unfurl | Impossible | Possible |
| Visible to page JavaScript (analytics, error reporters, session replay, extensions) | Yes; vendor behavior varies. Example: GA4 page_location handling of fragments is inconsistent in the wild and needs explicit config [27]. Audit your own tools. | Yes |
| Visible to the messaging platform carrying the link | Yes, it is part of the pasted text | Yes |
| Survives 3xx redirects | Generally preserved by browsers unless the redirect target has its own fragment (not re-verified here) | Preserved only if the redirect copies it |
| Router conflicts | Collides with hash routers (`HashRouter`) and `#anchor` scrolling; text fragments use `#:~:text=` | Collides with app query params |
| Reload/back-button semantics | `hashchange` events; `replaceState` avoids history spam | `pushState/replaceState`; Safari throttles `replaceState` (nuqs throttles URL writes at 50 ms, 120 ms on Safari, for this reason [29]) |

Key privacy caveat to write in the guidance: the fragment hides state from YOUR server, not from the chat app, email provider, browser sync, browser history or third-party scripts. It is not a secret store. For confidentiality use the Excalidraw model (ciphertext elsewhere, key in the fragment) and accept that whoever holds the full link holds the key [6].

RECOMMENDATION (A3): payload-class state (whole collections, views, documents) goes in the fragment; small navigational state a server or unfurler should see (page, tab, filter that changes the preview) goes in the query string. Make the location a strategy (`location: 'hash' | 'search'`) on the same encoder.

### 1.4 Schema-typed URL state libraries

| Library | License | Version / last release | Weekly dl | Size (gz, measured) | Frameworks | Schema support | Status |
|---|---|---|---|---|---|---|---|
| nuqs | MIT | 2.10.1 / 2026-08-25 | 5.7M | 4.8 KB | Next (app/pages), React SPA, Remix, React Router 6/7/8, TanStack Router (marked experimental in README) | Built-in parsers (string, int, float, bool, dates, enums, arrays, JSON); `parseAsJson` accepts any Standard Schema (Zod, Valibot, ArkType) or a function; `createLoader` for server-side parsing | Very active, 10.9K stars [28][29][30] |
| TanStack Router search params | MIT | 1.170.x / 2026-09-27 | 27.5M (whole router) | router-sized | TanStack Router only | `validateSearch` accepts Standard Schema (Zod 4, Valibot, ArkType, Effect Schema; Zod 3 needs an adapter); JSON-first serialization; `stripSearchParams`, `retainSearchParams` middlewares; custom `parseSearch`/`stringifySearch` is the hook for compressed payloads | Very active [31] |
| use-query-params | ISC | 2.2.2 / 2025-11-22 | 652K | 2.6 KB | React Router 5/6, adapters | Param objects (`StringParam`, `JsonParam`, custom) rather than schema validators | Maintained but slower, 2.2K stars [32] |
| serialize-query-params | ISC | 2.0.4 / 2025-11-27 | 1.03M | 0.4 KB | none (framework-agnostic core of use-query-params) | Same param objects | Only headless option of the four [32] |
| zustand-querystring | MIT (npm) | 0.7.0 / 2026-03 | 8K | small | zustand | store to query string | tiny adoption |
| jotai-location | MIT | 0.6.2 / 2025-08 | small | small | jotai | atoms to location | fine for jotai users |

Findings: nuqs's own docs are explicit that parsers do not validate shape, so pass JSON through a schema [30]. TanStack Router's stock serialization is JSON-first with nested values URL-safe encoded, and compression is not built in, so you must supply `stringifySearch`/`parseSearch` yourself [31]. Nothing here handles a single compressed opaque payload; that is what the toolkit's core should do.

RECOMMENDATION (A4): in the core, do not depend on any of these. Expose `encodeState(value, {codec, location, budget})` / `decodeState(string, {schema})` as pure functions over `URL`/`URLSearchParams`. Ship thin adapters (React via nuqs `createParser` or a `useUrlPayload` hook; TanStack Router via `stringifySearch`/`parseSearch`). Recommend nuqs to app authors for ordinary typed query params, and TanStack Router `validateSearch` when they already use it.

### 1.5 Versioning a URL payload

Design (mine, following Mermaid and Excalidraw [12][7]):
- Outer, rarely changes: a codec prefix that names the byte-level encoding and its version, for example `z1.<b64url>` (deflate-raw), `j1.<b64url>` (uncompressed), `e1.<...>` (encrypted). Unprefixed strings are treated as a named legacy format (Mermaid treats unprefixed as `base64` [12]). Unknown prefix: throw a typed error that says "link made by a newer version" and offers the raw prefix.
- Inner, changes with your data model: the JSON envelope `{app, kind, version, data}`; `version` is an integer that selects the migration chain (section 3).
- Never re-use a prefix for a different codec; only add new ones; keep decoders for every prefix ever shipped, with a fixture test per prefix (a "golden links" test file).
- Pick separator characters that survive URLs, chat autolinkers and Markdown: `.` and `_` are safe after `#`; avoid trailing punctuation and `)`.

RECOMMENDATION (A5): both layers, as above, with golden-link tests.

## 2. Topic B: IndexedDB wrappers and key-value stores

Numbers: version and last release from npm [1]; downloads and repo activity as of 2026-09-29; sizes measured (min / gz).

| Library | License | Latest / released | Weekly dl | Size (min / gz) | API shape | Cross-tab | Migrations | Maintenance |
|---|---|---|---|---|---|---|---|---|
| idb (Jake Archibald) | ISC | 8.0.3 / 2025-05-07 | 28.0M | 3.3 / 1.3 KB | Promisified IndexedDB, typed via `DBSchema`; `openDB(name, ver, {upgrade, blocked, blocking, terminated})` [35] | none built in; use `blocking` callback to close on `versionchange`, plus BroadcastChannel yourself | `upgrade(db, oldVersion, newVersion, tx)` (you write the chain) | Stable, 7.4K stars, low churn; last push 2025-05 |
| idb-keyval | Apache-2.0 (LICENCE file; GitHub API says NOASSERTION) | 6.3.0 / 2026-07-08 | 10.4M | 1.1 / 0.5 KB | `get/set/update/getMany/setMany/del/keys/entries/createStore` on structured-clonable values [36] | none | none (single object store) | Active |
| Dexie | Apache-2.0 | 4.4.6 / 2026-09-10 | 2.6M | 97.9 / 32.0 KB | Table API, indexes, `liveQuery`, hooks (`dexie-react-hooks` 4.4.0), `dexie-export-import` 4.4.1 addon [37] | Yes: `liveQuery` propagates via BroadcastChannel with storage-event fallback on old Safari; `Dexie.on.storagemutated` documented [40] | First-class: `db.version(n).stores({...}).upgrade(tx => ...)`, sequential; old versions no longer required since 3.x [39] | Very active, 14.6K stars. Dexie Cloud (sync) is a separate commercial service: free tier 3 production users / 100 MB, then EUR 0.12 per user per month, or paid on-prem [38]. The library itself is Apache-2.0. |
| localForage | Apache-2.0 | 1.10.0 / 2021-08-18 | 9.8M | 29.8 / 9.7 KB | Async `getItem/setItem` over IndexedDB, WebSQL, localStorage, auto JSON | none | none | DORMANT: last release 2021, last commit 2024-07-30 (a docs fix), about 250 open issues [41]. Do not adopt; the download count is legacy inertia. |
| unstorage (unjs) | MIT | 1.17.5 / 2026-03-26 | 30.6M | 8.9-9.1 / 3.3-3.4 KB (createStorage + one driver) | Unified async KV with 20+ drivers, mounts, snapshot, `watch`, transformations [42] | localStorage driver: `watch` via the `storage` event; indexedb driver: NONE (it is a thin wrapper over idb-keyval with no watch, per source) [43] | none | Active (8 deps) |
| zustand `persist` + `createJSONStorage` | MIT | zustand 5.0.15 / 2026-08-13 | 63.7M | 2.6 / 1.3 KB (create + persist) | Middleware: `name`, `storage`, `partialize`, `version`, `migrate`, `merge`, `skipHydration`, `onRehydrateStorage`, `rehydrate()`; async storage via idb-keyval wrapper [46] | Manual: listen for the `storage` event and call `rehydrate()` [46] | `version` + single `migrate(persisted, version)` function (you write the chain) | Active, 58.8K stars |
| TinyBase | MIT | 10.0.1 / 2026-09-24 | 18K | 34.3 / 15.1 KB (createStore only) | Reactive tables/rows/cells store; persisters for localStorage, sessionStorage, IndexedDB, OPFS, SQLite, Postgres, Yjs, Automerge; `MergeableStore` CRDT sync [45] | Yes for localStorage via storage events; `startAutoPersisting()` [45] | Schema support; migration story UNVERIFIED | Very active, 5.2K stars, low adoption |
| RxDB | Apache-2.0 core | 17.5.0 / 2026-08-20 | 89.5K | build failed in my esbuild (peer/optional plugin deps) | Reactive NoSQL DB with replication | Yes (BroadcastChannel-based) | schema versioning plus migration plugin | Active, 23.4K stars. LICENSE TIERS: Apache-2.0 core, free Dexie/Memory/LokiJS/localStorage storages; the OPFS, IndexedDB, SQLite, sharding, worker storages are premium: Pro USD 99 per month, Pro Plus USD 239 per month, annual billing, no trial [44]. Do not depend on it for a permissive toolkit. |
| broadcast-channel (pubkey) | MIT | 7.4.0 / 2026-08-03 | 3.6M | 10.3 / 3.7 KB | BroadcastChannel ponyfill with leader election | n/a | n/a | Active; only needed for very old browsers since native BroadcastChannel is Baseline since 2022-03 [48] |

localStorage limits and when to leave it:
- About 5 MiB per origin for localStorage and a separate 5 MiB for sessionStorage; throws `QuotaExceededError`; synchronous (blocks the main thread on read and write); strings only [47].
- IndexedDB, Cache API and OPFS share one origin quota: Chromium 60% of disk, Firefox best-effort min(10% of disk, 10 GiB) per site or persistent 50%, Safari about 60% of disk in browser apps (legacy pre-iOS 17 was about 1 GiB) [47].
- Eviction: best-effort storage is evicted per origin (all of IndexedDB, Cache and so on together, LRU) under pressure, and Safari deletes script-writable storage after 7 days without user interaction (ITP). Ask for `navigator.storage.persist()` for user data and surface `navigator.storage.estimate()` [47].
- Cross-tab primitives: `storage` event fires only in OTHER documents of the origin and only for localStorage/sessionStorage [49]; `BroadcastChannel` reaches other same-origin contexts but not the sender [48]; Dexie already builds on the latter [40].
- Rule of thumb for the guidance: keep in localStorage only small (<100 KB), rarely written, non-sensitive prefs; move to IndexedDB when data exceeds about 1 MB, contains Blobs/typed arrays, needs indexes or transactions, is written often, or the main-thread jank matters.

2025-2026 newcomers and adjacent options (none is a good v1 dependency for a headless persistence toolkit, all worth knowing):

| Project | License | Version | Note |
|---|---|---|---|
| TanStack DB | MIT | 0.9.2 (pre-1.0) | Reactive client store with collection types (Query, Electric, PowerSync, RxDB, LocalStorage, LocalOnly); persistence is delegated [51] |
| Evolu | MIT | 8.12.0 | SQLite in the browser, Kysely, E2E-encrypted sync; 3.5K weekly downloads [52] |
| LiveStore | Apache-2.0 | 0.4.0 (pre-1.0) | event-sourcing local-first store on SQLite |
| SQLocal | MIT | 0.18.0 | SQLite WASM on OPFS in a worker with Kysely/Drizzle drivers [53] |
| PGlite | Apache-2.0 | 0.5.8 | Postgres in WASM, 21M weekly downloads (mostly dev tooling) |
| @sqlite.org/sqlite-wasm | Apache-2.0 | 3.53.4 | Official; PowerSync's May 2026 survey recommends OPFSCoopSyncVFS (wa-sqlite) for performance, IDBBatchAtomicVFS as fallback; Safari lacks OPFS in private mode; no VFS gives concurrent writers [50] |
| Jazz (jazz-tools) | MIT | 0.20.x | CRDT sync framework, tiny adoption |
| Yjs / Automerge / Loro | MIT | 13.6 / 3.5 / 1.16 | CRDTs, relevant only if real-time merge is a goal; `y-indexeddb` last released 2023-11 |
| LokiJS | MIT | 1.5.12 / 2021 | UNMAINTAINED |
| PouchDB | Apache-2.0 | 9.0.0 / 2024-06 | Maintained lightly; CouchDB sync only |

RECOMMENDATION (B):
1. Define a small async `KeyValueStore` seam (`get/set/delete/keys/entries` plus optional `subscribe`) whose default implementation is `idb-keyval` in the browser, `localStorage` as a fallback and in-memory for tests and Node/agents. Do not reimplement what `unstorage` already is: if you want more than these three, take `unstorage` (MIT, 3.4 KB gz) as the facade and note that its IndexedDB driver has no cross-tab watch, so add your own BroadcastChannel notifier at the toolkit layer.
2. When indexes, versioned migrations or multi-tab live queries are needed, document `Dexie` (Apache-2.0) as the escalation path and use `idb` (ISC) for typed multi-store use; do not wrap either.
3. Cross-tab sync: use native `BroadcastChannel` (name it after `app:kind`) plus the `storage` event only for the localStorage backend; on schema upgrades close the DB in idb's `blocking` callback. No ponyfill needed.
4. For zustand users, show the `persist` + `createJSONStorage` recipe with an idb-keyval `StateStorage` and a `storage`-event `rehydrate()` hook; keep persistence of stores as a documented recipe, not a dependency.
5. Flag in guidance: `localForage` (dormant), `LokiJS` (dead), `RxDB` premium storages, Dexie Cloud (commercial service).

## 3. Topic C: validating and migrating persisted data

### 3.1 Validator seam

`@standard-schema/spec` (MIT, 1.1.0, 132.9M weekly downloads) is the common interface implemented by Zod 4, Valibot, ArkType and Effect Schema, and consumed by TanStack Router and nuqs [31][30][34]. Accepting a Standard Schema object at every toolkit boundary keeps the toolkit stack-agnostic, and lets agents bring any validator.

Measured bundle cost for a trivial two-field object schema (gz): valibot 1.1 KB; `zod/v4-mini` 4.3 KB; Zod 4 classic (`import {object,string,number}`) 25.4 KB; importing `{z}` as a namespace pulled about 90 KB gz in my build (locales), so document the named-import pattern. The registry version is Zod 4.6.5 (2026-09-13) [1].

### 3.2 Envelope and version chain

Prior art for envelopes:

| Product | Envelope | Versioning | Notes |
|---|---|---|---|
| Excalidraw `.excalidraw` | `{type: "excalidraw", version, source, elements, appState, files}`; library files `{type: "excalidrawlib", version: 1|2, libraryItems}` | `type` discriminator plus integer `version`; `isValidExcalidrawData`/`isValidLibrary` check `type` and version [10] | `source` records the emitting origin |
| tldraw `.tldr` | `{tldrawFileFormatVersion: 1, schema: {schemaVersion: 1 or 2, sequences: {...}}, records: [...]}`; MIME `application/vnd.tldraw+json`, extension `.tldr` | Two layers: file-format version (throws if higher than latest) and a schema serialization that lets the store migrate old snapshots (`migrateStoreSnapshot`) [57] | Snapshots split `document` (shared) from `session` (camera, selection) [56] |
| tldraw store migrations | `createMigrationSequence({sequenceId: 'com.myapp.book', sequence: [{id: 'com.myapp.book/1', scope: 'record', up, down?, dependsOn?}]})` | Named sequences with ids and dependencies, so plugins/custom shapes migrate independently [58] | `@tldraw/store` and `@tldraw/tlschema` are MIT even though the `tldraw` SDK is not (see below) |
| Excalidraw share/backend payload | `{version: "1", encoding: "bstring", compressed: boolean, encoded}` plus binary container with a 4-byte version header | Version fields "for potential migration purposes" [7] | Files use `compression: "pako@1"`, `encryption: "AES-GCM"` metadata |
| zustand `persist` | `{state, version}` in storage | `version` + `migrate(state, version)`; if the stored version differs and no `migrate` is given the state is discarded with an error [46] | one function, you write the branching |
| Dexie / idb | DB `version` integer | `version(n).upgrade()` chain / `upgrade(db, old, new)` [39][35] | schema-level rather than document-level |

Migration libraries on npm are essentially absent: `zod-migrate` (0.0.1, 2020), `versioned-schema` (3 downloads per week), `json-schema-migrate` (JSON-Schema draft upgrades, not data). The credible reference designs are tldraw's sequences and Dexie's chain. tldraw's `@tldraw/store` is MIT but is coupled to its record store, so it is a design reference, not a drop-in.

RECOMMENDATION (C1): persist `{app, kind, version, data}` (plus optional `createdAt`, `source`); keep `kind` and `app` as discriminators (Excalidraw style) and `version` as a positive integer. Provide `defineMigrations({1: up1to2, 2: up2to3})` as a tiny forward-only chain (about 30 lines: apply `up` for each missing step, validate with the current schema at the end, and optionally validate each intermediate step in dev). This is one of the few places where a new small utility is justified because no adopted permissive library exists. Rules: unknown/newer version means refuse with a typed error and do not overwrite storage (tldraw and Excalidraw both throw [7][57]); back up the pre-migration blob under a `:backup:<version>` key before writing; make migrations pure and unit-testable with golden fixtures; run validation on load, not only on import.

### 3.3 JSON, structured clone, and rich types

- IndexedDB, `postMessage` and `structuredClone` share the structured clone algorithm: it supports Date, Map, Set, RegExp (not `lastIndex`), ArrayBuffer/typed arrays, Blob, File, Error types, and BigInt; it rejects functions, DOM nodes and symbols, and drops prototypes, getters/setters and class identity [63]. So an IndexedDB-backed store needs no custom serializer for Date/Map/Set/Blob.
- JSON (URLs, `.json` export, localStorage, hashing) loses all of that: Date becomes a string, Map/Set become `{}`/`[]`, BigInt throws, `undefined` disappears, Blob is impossible.

| Tool | License | Version / release | Weekly dl | Size (gz) | Handles | Output | Notes |
|---|---|---|---|---|---|---|---|
| Zod 4 codecs (`z.codec`, `z.encode`/`z.decode`) | MIT | zod 4.1+ | 341M (zod) | in Zod | Anything you define: ISO string to Date, string to BigInt, JSON parse | plain JSON | Type-safe and validating; best when you already have schemas [60] |
| superjson | MIT | 2.2.6 / 2025-11-27 | 12.0M | 4.0 KB | undefined, bigint, Date, RegExp, Set, Map, Error, URL, NaN, Infinity, -0; `registerCustom`; no functions, no Blob | `{json, meta}` (JSON-valid, readable) | Now under the `ravionhq` org, active [61] |
| devalue (Svelte) | MIT | 6.0.2 / 2026-09-22 | 16.4M | 4.1 KB | the above plus typed arrays/ArrayBuffer, URL/URLSearchParams, cyclic and repeated refs; custom reducers/revivers; no functions, class instances or Blob | compact custom JSON array format | Designed to be safe for untrusted input via `parse`; do not `eval` `uneval` output from clients [62] |
| seroval | MIT | 1.6.8 / 2026-09-29 | 33.8M | not measured | very broad including streams/promises | JS or JSON | Powers Solid/TanStack Start; heavier scope than needed |
| flatted | ISC | 3.4.4 | 178M | small | cycles only | JSON | not a type-preserving format |
| `@ungap/structured-clone` | ISC | 1.4.0 | 96.9M | small | polyfill of structuredClone with JSON-ish output (`serialize`) | | useful only for old runtimes |

RECOMMENDATION (C2): the persisted/exported JSON contract stays plain JSON with explicit conversions declared in the schema (Zod codecs if the app uses Zod, otherwise a `{encode, decode}` pair on the schema adapter). Blobs are never inlined by default: store them under separate keys/store and export as separate files or a zip (Excalidraw puts them in a `files` map as data URLs, which balloons size [10]). Offer `superjson` (readable, JSON-compatible, works with hashing after `serialize`) as the optional rich-type strategy; recommend `devalue` only for inputs that never leave your origin. Never JSON-encode values on the way into IndexedDB.

## 4. Topic D: export/import and merge UX

### 4.1 Canonical JSON and content hashes

| Library | License | Version / release | Weekly dl | Size (gz) | Behavior | Status |
|---|---|---|---|---|---|---|
| canonicalize | Apache-2.0 | 5.1.0 / 2026-09-18 | 4.35M | 0.8 KB | RFC 8785 JCS (author is a co-author of the RFC); duplicate keys resolved by `JSON.parse` before canonicalization (last wins) [65] | Active, tiny |
| fast-json-stable-stringify | MIT | 2.1.0 / 2019-12-14 | 182M | 0.8 KB | Sorted keys, `toJSON` support, optional cycle handling; not advertised as JCS | Feature-complete but not touched since 2023 (GitHub license field says NOASSERTION) |
| safe-stable-stringify | MIT | 2.5.0 / 2024-08-24 | 69.7M | 2.6 KB | Deterministic key order by default, BigInt modes, circular replacement, fastest of the three in its own benchmark; RFC 8785 conformance not claimed [66] | Maintained |
| json-canonicalize | MIT | 3.0.1 / 2026-09 | small | small | RFC 8785, TypeScript | alternative |
| json-stable-stringify | MIT | 1.3.0 / 2025-04 | 16.2M | 5 deps | sorted keys | heavier |
| ohash | MIT | 2.0.12 / 2026-08 | 53.4M | small | object hashing utility from unjs | good if you want hash-in-one-call |
| object-hash | MIT | 3.0.0 / 2022-02 | 77.9M | large | old, includes Node crypto | avoid in browser |
| Native `crypto.subtle.digest('SHA-256')` | platform | n/a | n/a | 0 | needs a secure context (HTTPS/localhost) and is async | use for the digest |

RFC 8785 essentials [64]: object keys sorted by UTF-16 code units, ECMAScript number serialization, minimal string escaping, I-JSON constraints (no duplicate keys, IEEE-754 numbers, so big integers must be strings), and NaN/Infinity are errors. It does not normalize Unicode.

Cautions: `undefined`-valued keys are dropped by JSON.stringify-based canonicalizers (so `{a:undefined}` equals `{}` for hashing; document it); numbers like `1.0` vs `1` are the same JS number; Dates must be strings before hashing; strip volatile fields (`updatedAt`, `lastOpened`, `id` if it is the key) with an explicit `hashIgnore` list, otherwise "identical" content will never compare equal.

RECOMMENDATION (D1): `contentHash(value) = hex(SHA-256(canonicalize(normalize(value))))` with `canonicalize` (Apache-2.0, RFC-based) as default and the canonicalizer injectable (`fast-json-stable-stringify` compatible signature). Use `crypto.subtle` for the digest with an injected fallback for non-secure contexts and Node tests. No dependency for hashing itself.

### 4.2 Conflict-resolution patterns and prior art

| Product / pattern | What it does on collision | Lesson |
|---|---|---|
| Desktop file-copy dialog (Windows Explorer, macOS Finder) | Replace / Skip / Keep both, with "do this for all conflicts", showing existing versus incoming name, size, date; keep both auto-suffixes the name [68] | The canonical four verbs, plus "apply to all", plus a comparison view. Safest default focus is Skip (keep existing). |
| Postman collection import | Import as copy vs Replace; users complained bitterly when the choice disappeared and when Replace produced duplicates, and asked for "do it for all" during bulk import [69] | Never remove the choice; make Replace truly replace; bulk needs apply-to-all |
| VS Code Profiles export/import | Import creates a new profile; machine-specific settings are omitted on export; users asked for rename-on-conflict and import-over-existing [70] | Export should strip machine-local data; import should offer rename |
| Excalidraw library import | `mergeLibraryItems(local, other)` adds only items that are "unique" (same element ids and `versionNonce` set counts as duplicate) and puts new ones first; a hash `id:name:hashElementsVersion` detects unsaved changes [9] | Identity by content signature, additive merge, no destructive default; persistence goes through a `LibraryPersistenceAdapter` seam |
| Obsidian Sync | Markdown: three-way merge with diff-match-patch; settings JSON: merge keys with local applied over remote; other files including canvases: last-modified wins; since 1.9.7 user can choose "automatically merge" or "create conflict file" per device [67] | Different strategy per data class; offer "create conflict file" (keep both) as the safe alternative |
| tldraw | Loads a snapshot by replacing store contents after migrations; document (shared) and session (per-user) are separate | Separate shareable content from per-user session state so import never clobbers UI prefs [56] |
| Figma / Notion | Not re-verified here; omitted rather than guessed | |

Field-level three-way merge exists as libraries (`node-diff3` MIT 3.2.1, `jsondiffpatch` MIT 0.7.6, `rfc6902` MIT 5.3.0, `microdiff` MIT) but a collection import rarely has a common ancestor, so do item-level resolution by default and only add field-level merge behind a strategy.

Suggested contract (mine):
- `planImport(existing, incoming, {key, hash, policy}) -> Plan` where each incoming item resolves to one action: `add`, `identical` (same hash, no-op), `skip`, `overwrite`, `rename` (keep both, new key such as `name (2)` or `-copy`), or `ask`; the plan is a pure, serializable, previewable object (good for agents, tests and a dry-run UI).
- `policy` is `skip | overwrite | keepBoth | ask | (conflict) => decision`; `ask` yields a list of conflicts with `{existing, incoming, diffSummary}` plus per-decision `applyToAll`.
- `applyImport(plan, store)` is atomic per batch where the backend supports transactions (IndexedDB does) and returns a report `{added, skipped, overwritten, renamed, identical, failed}` and an undo token (the overwritten previous values).
- Import pipeline order: parse envelope, check `app`/`kind`, check version (refuse newer), migrate, validate each item (collect per-item errors instead of aborting the batch), then plan.
- Export strips machine-local and volatile fields, includes `source` and `exportedAt`, uses a MIME type and extension of your own (`application/vnd.<app>+json`, like tldraw's `.tldr`) and `browser-fs-access` (Apache-2.0, 0.38.0, 1.08M weekly, used by Excalidraw for file open/save with a fallback download) for saving [11].

RECOMMENDATION (D2): build the policy engine (about 150 lines), depend on `canonicalize` for the canonical form and on `browser-fs-access` (optional, UI layer) for file save/open. Ship default `policy: 'ask'` at the UI layer and `'skip'` for headless/agent calls (never destructive without an explicit flag).

### 4.3 Excalidraw and tldraw in detail

Excalidraw (MIT, 133K stars, `@excalidraw/excalidraw` 0.18.1, 670K weekly downloads):
- Share link: `https://excalidraw.com/#json=<id>,<key>`. The client generates an AES-GCM key (128-bit, exported as the JWK `k` value in base64url), deflates the scene with pako, encrypts, POSTs the ciphertext to a backend that returns an id; the key never leaves the fragment [6][8]. The 2019 blog notes an all-zero 12-byte IV with a "don't reuse key" warning; the current `compressData` container stores the IV in the payload [6][7]. Size cap `FILE_UPLOAD_MAX_BYTES` yields a "too big to share" error rather than a fallback [8]. Live collaboration links (`#room=<id>,<key>`) use the same key-in-fragment trick (documentation of this is thin; I did not find a primary write-up).
- Local persistence: elements in `localStorage` key `excalidraw`, app state in `excalidraw-state`, debounced 300 ms; binary image files in IndexedDB via idb-keyval (`files-db`); the library in IndexedDB (`excalidraw-library`) after migrating away from a legacy localStorage key; cross-tab sync through the `storage` event on `version-dataState` and `version-files` timestamps [11].
- File save: `.excalidraw` JSON `{type: "excalidraw", version, source, elements, appState, files}` and `.excalidrawlib`; saving via `browser-fs-access` (`fileOpen`, `fileSave`, File System Access API with fallback) [10][11].
- Takeaways for us: envelope with `type`+`version`+`source`; ciphertext-elsewhere plus key-in-fragment for big or private shares; split hot state (localStorage) from heavy blobs (IndexedDB); a `version` timestamp key as the cross-tab signal; library import as additive dedupe.

tldraw (`tldraw` SDK 5.4.2; 50.6K stars; 492K weekly downloads):
- License: the `tldraw` SDK uses the tldraw License, which is free only for development environments; production needs a trial or commercial license key and the SDK includes technical measures (license key check, watermark) [55]. It is NOT permissive; do not depend on it. Its `@tldraw/store` and `@tldraw/tlschema` packages are MIT (5.4.2) and are useful as design references.
- Local persistence: `persistenceKey` prop gives automatic IndexedDB storage with cross-tab sync; or manual `getSnapshot()`/`loadSnapshot()` with the document/session split; `createTLStore()` for standalone stores; older snapshots migrate automatically [56].
- Files: `.tldr` JSON `{tldrawFileFormatVersion, schema, records}`; `parseTldrawJsonFile` validates with runtime validators (`T.object`, `numberUnion('schemaVersion', {...})`), throws on a newer file-format version, then runs `schema.migrateStoreSnapshot` [57].
- Sharing: tldraw.com shares by creating a multiplayer room and sharing its URL (read-only links exist); self-hosting uses `@tldraw/sync` (WebSocket rooms plus asset storage, Cloudflare template) rather than payload-in-URL [59]. So it does not solve URL-payload sharing; it solves live rooms.
- Takeaways: versioned schema serialized inside the file so the reader can migrate; validators at the boundary; separate shared document from personal session state; migrations as named sequences.

## 5. Guidance sentences worth putting in the toolkit docs (agent-facing)

- Prefer the fragment for payloads and the query for state a server must see; a fragment is invisible to your server but not to the chat app, browser history or page scripts.
- Never share a link longer than the configured budget without an explicit override; above 8,000 characters offer stored-payload or file.
- Every persisted and shared blob carries `{app, kind, version}`; decoders never guess; unknown newer versions are refused, never overwritten.
- Validate on every decode with a Standard Schema validator; treat URL payloads and imported files as untrusted input.
- Storage defaults: idb-keyval for KV, localStorage only for tiny prefs, Dexie when queries matter; do not adopt localForage or RxDB premium storages.
- Import is a plan first (pure data), an action second; identical content is a no-op; destructive actions require an explicit strategy; keep an undo token.

## 6. Flags and open items

- UNMAINTAINED or dormant: localForage (release 2021-08, commits to 2024-07), jsurl (2016), rison (2014), urlon (2021), LokiJS (2021), y-indexeddb (2023), `zod-migrate`, `versioned-schema`, deep-diff (deprecated flag on npm).
- Frozen but fine: lz-string (1.5.0 in 2023, 75M weekly downloads), fast-json-stable-stringify (2019), idb (2025-05, stable API).
- Non-permissive or tiered: tldraw SDK (proprietary license key), RxDB premium storages (paid), Dexie Cloud (paid service; library stays Apache-2.0).
- Pre-1.0 and moving: TanStack DB 0.9, LiveStore 0.4, SQLocal 0.18, Evolu 8.x, PGlite 0.5, Jazz 0.20.
- UNVERIFIED: exact Safari URL limit; whether Slack/WhatsApp/iMessage truncate human-pasted URLs at a fixed length (evidence is bot-posted messages and one project's issue); Apache `LimitRequestLine`; fragment survival across redirects; TinyBase migration story; Figma and Notion import behavior; whether the measured compression ratios generalize to your real payloads (re-run on real data before fixing budgets).
- Version-number caution: registry shows recent majors (Zod 4.6, tldraw 5.4, Jotai 3.0, TinyBase 10, RxDB 17); re-check versions at implementation time.

## REFERENCES

[1] [npm registry and npm downloads API (queried 2026-09-29)](https://registry.npmjs.org/)
[2] [GitHub REST API repository metadata (queried 2026-09-29)](https://docs.github.com/en/rest/repos/repos)
[3] [lz-string (pieroxy) repository](https://github.com/pieroxy/lz-string)
[4] [fflate repository](https://github.com/101arrowz/fflate)
[5] [pako repository](https://github.com/nodeca/pako)
[6] [Excalidraw blog: End-to-End Encryption in the Browser](https://plus.excalidraw.com/blog/end-to-end-encryption)
[7] [Excalidraw source: packages/excalidraw/data/encode.ts](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/encode.ts)
[8] [Excalidraw source: excalidraw-app/data/index.ts (exportToBackend, importFromBackend)](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/index.ts)
[9] [Excalidraw source: packages/excalidraw/data/library.ts (mergeLibraryItems)](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/library.ts)
[10] [Excalidraw source: packages/excalidraw/data/json.ts (serializeAsJSON, isValidExcalidrawData, isValidLibrary)](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/json.ts)
[11] [Excalidraw source: excalidraw-app/data/LocalData.ts, app_constants.ts and data/filesystem.ts](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/LocalData.ts)
[12] [Mermaid Live Editor source: src/lib/util/serde.ts](https://github.com/mermaid-js/mermaid-live-editor/blob/develop/src/lib/util/serde.ts)
[13] [TypeScript Playground handbook: URL Structures](https://www.typescriptlang.org/_playground-handbook/url-structure.html)
[14] [Microsoft IEInternals: URL Length Limits](https://learn.microsoft.com/en-us/archive/blogs/ieinternals/url-length-limits)
[15] [Cloudflare docs: Connection and request limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/)
[16] [AWS CloudFront quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html)
[17] [nginx docs: ngx_http_core_module (large_client_header_buffers)](https://nginx.org/en/docs/http/ngx_http_core_module.html)
[18] [Node.js issue 27645: Increase HTTP_MAX_HEADER_SIZE to 16kb](https://github.com/nodejs/node/issues/27645)
[19] [GeeksforGeeks: Maximum length of a URL in different browsers](https://www.geeksforgeeks.org/maximum-length-of-a-url-in-different-browsers/) and [Chromium-dev thread: data URL IPC size limit](https://groups.google.com/a/chromium.org/g/chromium-dev/c/zYYSVvn6a5M)
[20] [Plannotator issue 187: share URLs too large for Slack and messaging apps](https://github.com/backnotprop/plannotator/issues/187)
[21] [Kibana issue 158262: URLs longer than 4K bytes are split in Slack and email messages](https://github.com/elastic/kibana/issues/158262)
[22] [Slack changelog: Truncating really long messages](https://api.slack.com/changelog/2018-04-truncating-really-long-messages)
[23] [Microsoft Q&A: Outlook for Microsoft 365 truncating long URLs](https://learn.microsoft.com/en-us/answers/questions/1063670/outlook-for-microsoft-365-truncating-long-urls)
[24] [Discord community: Message Max Length](https://support.discord.com/hc/en-us/community/posts/360031093812-Message-Max-Lenght)
[25] [W3C Referrer Policy](https://www.w3.org/TR/referrer-policy/)
[26] [MDN: URI fragment](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment)
[27] [Analytics Playbook: Track URLs with fragments in GA4 with GTM](https://kpplaybook.com/resources/track-urls-with-fragments-hash-mark-in-ga4-with-gtm/)
[28] [nuqs repository](https://github.com/47ng/nuqs)
[29] [nuqs docs: Options (history, throttling, clearOnDefault)](https://nuqs.dev/docs/options)
[30] [nuqs docs: Built-in parsers (parseAsJson with Standard Schema)](https://nuqs.dev/docs/parsers/built-in)
[31] [TanStack Router docs: Search params](https://tanstack.com/router/latest/docs/framework/react/guide/search-params)
[32] [use-query-params and serialize-query-params repository](https://github.com/pbeshai/use-query-params)
[33] [MDN: CompressionStream() constructor](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream/CompressionStream)
[34] [Standard Schema specification](https://github.com/standard-schema/standard-schema)
[35] [idb repository](https://github.com/jakearchibald/idb)
[36] [idb-keyval repository](https://github.com/jakearchibald/idb-keyval)
[37] [Dexie.js repository](https://github.com/dexie/Dexie.js)
[38] [Dexie Cloud pricing](https://dexie.org/cloud/pricing)
[39] [Dexie docs: Version.upgrade()](https://dexie.org/docs/Version/Version.upgrade())
[40] [Dexie docs: Dexie.on.storagemutated](https://dexie.org/docs/Dexie/Dexie.on.storagemutated)
[41] [localForage repository](https://github.com/localForage/localForage)
[42] [unstorage documentation](https://unstorage.unjs.io/)
[43] [unstorage source: drivers/indexedb.ts](https://github.com/unjs/unstorage/blob/main/src/drivers/indexedb.ts)
[44] [RxDB premium plugins and pricing](https://rxdb.info/premium/)
[45] [TinyBase docs: An intro to persistence](https://tinybase.org/guides/persistence/an-intro-to-persistence/)
[46] [Zustand docs: Persisting store data](https://zustand.docs.pmnd.rs/reference/integrations/persisting-store-data)
[47] [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
[48] [MDN: BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
[49] [MDN: Window storage event](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event)
[50] [PowerSync: The current state of SQLite persistence on the web (May 2026)](https://powersync.com/blog/sqlite-persistence-on-the-web)
[51] [TanStack DB overview](https://tanstack.com/db/latest/docs/overview)
[52] [Evolu](https://www.evolu.dev/)
[53] [SQLocal](https://sqlocal.dev/)
[54] [MDN browser-compat-data: api/CompressionStream.json](https://github.com/mdn/browser-compat-data/blob/main/api/CompressionStream.json)
[55] [tldraw license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)
[56] [tldraw docs: Persistence](https://tldraw.dev/docs/persistence)
[57] [tldraw source: packages/tldraw/src/lib/utils/tldr/file.ts](https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/utils/tldr/file.ts)
[58] [tldraw source: packages/store/src/lib/migrate.ts](https://github.com/tldraw/tldraw/blob/main/packages/store/src/lib/migrate.ts)
[59] [tldraw docs: sync](https://tldraw.dev/docs/sync)
[60] [Zod docs: Codecs](https://zod.dev/codecs)
[61] [superjson repository](https://github.com/blitz-js/superjson)
[62] [devalue repository](https://github.com/sveltejs/devalue)
[63] [MDN: The structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
[64] [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
[65] [canonicalize repository](https://github.com/erdtman/canonicalize)
[66] [safe-stable-stringify repository](https://github.com/BridgeAR/safe-stable-stringify)
[67] [Obsidian Help: Troubleshoot Obsidian Sync (conflict resolution)](https://obsidian.md/help/sync/troubleshoot)
[68] [The Old New Thing: file copy conflict dialog options](https://devblogs.microsoft.com/oldnewthing/20190604-00/?p=102539)
[69] [Postman issue 11862: collection import lost replace vs copy](https://github.com/postmanlabs/postman-app-support/issues/11862)
[70] [VS Code docs: Profiles](https://code.visualstudio.com/docs/configure/profiles)
