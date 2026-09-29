# Sync later: research extract

Extract of the holdall research (state as of 2026-09-29) behind the `holdall-sync-later` skill. Versions and licenses were read from npm and GitHub on that date. Anything not confirmed from a primary source is labelled unverified. Citations use Vancouver numbering local to this file.

## 1. Local-first principles (the yardstick)

Kleppmann, Wiggins, van Hardenberg and McGranaghan (Ink & Switch, 2019) list seven ideals: no spinners (work is instant on the local copy), your work is not trapped on one device, the network is optional, seamless collaboration, the long now (data outlives the vendor), security and privacy by default, and you retain ultimate ownership and control. They argue CRDTs are the promising foundation for the collaboration part [1]. For a toolkit: the local store is primary, sync is an optional replica-to-replica transport, export in an open format must always work, encryption happens before anything leaves the device.

## 2. Landscape

| Option | Model | Latest (npm), published | License | Fit as a later seam |
|---|---|---|---|---|
| [Yjs](https://github.com/yjs/yjs) [2] | CRDT for shared docs; composable providers (`Y.Doc` + persistence + network) | yjs 13.6.33 (2026-09-23); y-indexeddb 9.0.12 (2023-11); y-websocket 3.1.0 (2026-08) | MIT (GitHub API shows NOASSERTION; npm says MIT) | Best for rich text and collaborative documents; y-webrtc needs signaling servers and does not suit many peers [3]; not ideal for a plain record store |
| [Automerge](https://automerge.org/) + automerge-repo | JSON-like CRDT documents; a Repo with pluggable storage and network adapters | automerge 3.5.0 (2026-09-16); automerge-repo stable 2.5.6 (2026-05-18), `latest` tag pointed at 2.6.0-alpha.3 | MIT | Its storage adapter is a binary key-value interface with array keys and prefix ranges (`load/save/remove/loadRange/removeRange`) [4], a good model for a store seam; adapters for IndexedDB, WebSocket, BroadcastChannel [5] |
| [Loro](https://loro.dev/) [6] | CRDT library (Rust, WASM), versioned JSON-like data | loro-crdt 1.16.3 (2026-09-21) | MIT | Younger ecosystem; bring your own transport and storage |
| [TinyBase](https://tinybase.org/) [7] | Reactive tabular store; `MergeableStore` adds HLC timestamps and hashes so stores merge deterministically | tinybase 10.0.1 (2026-09-24) | MIT | Closest to a records store; synchronizers over WebSocket and BroadcastChannel |
| [Replicache](https://replicache.dev/) [8] | Client mutation queue with pull/push against your backend | 15.3.0 (2025-07-02) | Open-sourced and free, but in maintenance mode; the npm `license` field points at a terms URL, read the repo LICENSE | Do not start new work; users are told to move to Zero |
| [Zero](https://github.com/rocicorp/mono) [9] | Query-driven sync from Postgres | @rocicorp/zero 1.9.0 (2026-08-14) | Apache-2.0 | Server-centric (zero-cache plus Postgres) |
| [ElectricSQL](https://electric.ax/docs/intro) [10] | Read-path sync from Postgres over HTTP "Shapes"; writes through your API | @electric-sql/client 1.5.28 (2026-09-09) | Apache-2.0 | Postgres-centric; pairs with TanStack DB and PGlite |
| [TanStack DB](https://github.com/TanStack/db) | Client collections and live queries backed by Electric, PowerSync and others | @tanstack/db 0.9.2 (2026-09-14) | MIT | Pre-1.0 but active |
| [PowerSync](https://docs.powersync.com/client-sdks/reference/javascript-web) [11] | SQLite on the client; local writes go to an upload queue your connector sends to your backend; auto-created text `id` column | @powersync/web 2.4.1 (2026-09-23) | Apache-2.0 SDKs; service commercial or self-hosted | The clearest example of an ordered local mutation log |
| [Jazz](https://jazz.tools/) | Local-first relational database with row-level permissions and sync | jazz-tools 0.20.19 (2026-07-03) | MIT | Pre-1.0 and has changed direction; watch, do not adopt |
| [Triplit](https://supabase.com/blog/triplit-joins-supabase) [12] | Full-stack sync database | @triplit/client 1.0.50 (2025-07-31) | AGPL-3.0 | Acquired by Supabase (2025-10-08); AGPL is an obstacle for a toolkit |
| [remoteStorage.js](https://github.com/remotestorage/remotestorage.js) [13] | Open protocol; user-owned server or Dropbox and Google Drive backends | remotestoragejs 2.0.0-beta.10 (2026-08-12) | MIT | Aligned with user ownership; document-level last-writer-wins, slower ecosystem |
| [Evolu](https://www.evolu.dev/docs) [14] | TypeScript local-first platform on SQLite; end-to-end-encrypted sync via relays | @evolu/common 8.12.0 (2026-09-27) | MIT | CRDT and encryption details unverified |
| [Dexie Cloud](https://dexie.org/cloud/) [15] | Dexie plus a hosted sync service with access control | dexie 4.4.6 / dexie-cloud-addon 4.4.15 (2026-09) | Library Apache-2.0; service SaaS (free tier 3 production users, 100 MB; paid per seat) or paid on-prem | Natural upgrade if the local store is Dexie; needs string primary keys and its own realm and ownership fields |
| LiveStore | Event-sourced SQLite client store with sync providers | @livestore/livestore 0.4.0 (2026-06-02) | Apache-2.0 | Pre-1.0; event-sourcing matches the change-feed idea |

Takeaways. Two shapes exist: document CRDTs (Yjs, Automerge, Loro) own the data model; record or mutation-log sync (PowerSync, Electric with TanStack DB, Zero, Dexie Cloud, Replicache, TinyBase) sits beside a store and needs ids, versions and an ordered change feed. A generic local store supports the second shape natively and the first through an opaque-blob value. Licenses: avoid Triplit (AGPL); read Replicache's terms; Zero, Electric and PowerSync are Apache-2.0 but their hosted services are commercial. Yjs, Automerge, Dexie, Electric, PowerSync and TinyBase were actively released in September 2026; Jazz, LiveStore and TanStack DB are pre-1.0.

## 3. What a local store should expose now

Cheap on day one, expensive to retrofit. Any engine above can then attach at one seam.

| Capability | Why an engine needs it |
|---|---|
| Stable client-generated globally unique ids (UUIDv7, ULID, nanoid); never auto-increment, never content-derived | Every engine addresses records by id; two devices creating records offline must not collide [11][15] |
| Per-record `updatedAt` and `createdAt`, preferably a hybrid logical clock string | Last-writer-wins merges (TinyBase, remoteStorage) break on skewed wall clocks; an HLC gives monotonic mergeable ordering [7] |
| Tombstones: delete marks `deletedAt` and keeps the id; a separate purge compacts | A deletion cannot propagate otherwise, and a replica that missed it resurrects the record |
| A local sequence number and an ordered change feed (`changes(since)`, `subscribe`) | This is what PowerSync's upload queue, Replicache's mutation log and LiveStore's event log consume; it lets a transport resume after a crash [11] |
| A stable replica id per install | HLC tie-breaking, CRDT actor ids, echo suppression |
| Origin tagging of writes (`local` or `remote`) | Stops feedback loops when an engine applies remote changes through the same API |
| Atomic batch writes and one change event per committed transaction | Consistent snapshots and checkpoints |
| Integer schema version per store | Migrations and sync coexist (expand, migrate, contract) |
| Export/import of the whole store in an open format, tombstones and blobs included | The "long now" ideal [1]; also the iOS install move |
| Namespaced keys `<app>/<store>/<id>` | Same-origin isolation and per-namespace sync scopes |

Nice to have, only if cheap: an opaque bytes value type (for CRDT snapshots and updates); a byte key-value adapter in the style of automerge-repo's storage interface so one backend (IndexedDB, OPFS, file, memory) can serve records and CRDT chunks [4]; a per-record version or etag for optimistic concurrency; a per-remote synced-`seq` checkpoint.

An engine plugs in through a replicator: it reads `changes(since = checkpoint)`, pushes them, pulls remote changes and applies them with `origin: 'remote'`, then stores the checkpoint. For a CRDT engine the store holds the binary snapshot under one id; for record-sync engines the replicator maps a change to their CRUD or mutation types. App code does not change. Do not add a sync engine, server, accounts or CRDT-typed fields in v1.

The zodal `DataProvider` (`@zodal/store` 0.2.0) already has an optional `subscribe(callback)` returning an unsubscribe function, with events `{type: 'created', item}`, `{type: 'updated', id, item}` and `{type: 'deleted', id}`. It carries no sequence number, no origin tag and no timestamp, so the fields above must live in the records or in a wrapper.

## 4. Encrypted share links

Excalidraw generates a random AES-GCM key with the Web Crypto API, encrypts the scene client-side, uploads only ciphertext, and puts the exported key in the URL fragment, which browsers do not send to servers; the server can neither read nor be compelled to disclose the content [16]. Their write-up uses an all-zero 12-byte IV, justified because each key encrypts exactly once [16]. Guidance for a toolkit:

1. Generate a fresh 256-bit key and a random 12-byte IV per encryption (a random IV stays safe even if the same key later updates the blob); upload `iv || ciphertext` under a random id; return `https://host/app/#/s/<id>&k=<base64url key>`.
2. Nothing after `#` reaches the server; remove the fragment with `replaceState` after reading it, set `Referrer-Policy: no-referrer`, and use no third-party scripts on the receive page, because history, extensions and screenshots can still leak it.
3. Optionally wrap the key with a password (PBKDF2 or Argon2) as a second factor.
4. Add an expiry and a delete token on the blob server; the link is a bearer capability and anyone holding it can read.
5. It doubles as the data move across the iOS install boundary: the Home Screen app has a separate, initially empty store.
6. Read-only sharing is simple; collaborative editing on top needs a CRDT and per-message IVs, which is out of scope for a v1 share link.

## REFERENCES

1. Kleppmann M, Wiggins A, van Hardenberg P, McGranaghan M. [Local-first software: You own your data, in spite of the cloud](https://www.inkandswitch.com/essay/local-first/). Ink & Switch; 2019.
2. Yjs docs. [Offline editing and providers](https://docs.yjs.dev/getting-started/allowing-offline-editing).
3. [y-webrtc README](https://github.com/yjs/y-webrtc).
4. [automerge-repo StorageAdapterInterface.ts](https://github.com/automerge/automerge-repo/blob/main/packages/automerge-repo/src/storage/StorageAdapterInterface.ts).
5. [automerge-repo README (storage and network adapters)](https://github.com/automerge/automerge-repo).
6. [Loro repository and docs](https://github.com/loro-dev/loro).
7. TinyBase docs. [Using a MergeableStore](https://tinybase.org/guides/synchronization/using-a-mergeablestore/).
8. [Replicache (maintenance mode, open-sourced, free)](https://replicache.dev/).
9. [rocicorp/mono (Zero and Replicache monorepo)](https://github.com/rocicorp/mono).
10. [Electric Sync docs](https://electric.ax/docs/intro).
11. PowerSync. [JavaScript Web SDK: local writes, upload queue and id column](https://docs.powersync.com/client-sdks/reference/javascript-web).
12. Supabase blog. [Triplit joins Supabase](https://supabase.com/blog/triplit-joins-supabase).
13. [remoteStorage.js README](https://github.com/remotestorage/remotestorage.js).
14. [Evolu documentation](https://www.evolu.dev/docs).
15. [Dexie Cloud](https://dexie.org/cloud/).
16. Excalidraw blog. [End-to-end encryption in Excalidraw](https://plus.excalidraw.com/blog/end-to-end-encryption).
