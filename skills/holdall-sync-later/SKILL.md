---
name: holdall-sync-later
description: >-
  Decide whether a browser-only app needs sync or CRDTs yet, and keep it sync-ready at no cost until it does. Use when asked to "sync between devices", "same data on my phone and laptop", "real-time collaboration", "multiplayer", "add a backend later", "CRDT", "Yjs or Automerge", "local-first", "offline-first sync", "conflict resolution across devices", "PowerSync / ElectricSQL / Dexie Cloud / TinyBase / Jazz / Evolu", "encrypted share link", "share without the server reading it", or "do we need sync?". Covers when export/import and share links suffice, the sync-ready data shape to keep now, candidate engines with licenses and a pick-when line, encrypted share links, and local-first principles.
license: MIT
metadata:
  package: holdall
---

# holdall-sync-later: sync is a later seam, the data shape is now

Use this when someone says "sync", "collaborate" or "multi-device", or when you are designing a store and want the later move to cost one adapter, not a rewrite. Do not add a sync engine, server, accounts or CRDT fields to v1. Do keep the six cheap habits below.

## 1. Is sync warranted?

| Situation | Enough | Sync engine warranted |
|---|---|---|
| One person, one device | local store + "Save backup" (`holdall-local-store`, `holdall-files`) | no |
| One person, two devices, occasionally | export/import a file, or a share link to yourself (`holdall-share-links`) | only if they complain about manual moves |
| Send a snapshot to another person | share link or file; encrypted link (section 4) if the payload is private | no |
| One person, many devices, expects always-current data | | yes: record sync (last-writer-wins is fine for one author) |
| Two or more people editing the same thing at once | | yes: a CRDT or a server-authoritative engine |
| A backend, accounts or a database now exists | | yes: pick an engine that fits that backend |

Rule: sync is warranted by multi-device same user, real-time collaboration, or a backend that appears. "It would be nice" is not a reason; file export plus links covers most needs and stays honest about where data lives.

## 2. The sync-ready shape to keep NOW (near-zero cost, costly to retrofit)

1. Stable client-generated ids: `crypto.randomUUID()` (or UUIDv7/ULID/nanoid). Never auto-increment, never `Date.now()` counters, never ids derived from content that can change. Two offline devices must not collide.
2. `updatedAt` (and `createdAt`) on every record, ideally a hybrid logical clock (HLC) string so ordering survives skewed clocks. Bump it only when content actually changed, so re-opening cannot beat a real edit made elsewhere. Wall-clock last-writer-wins is acceptable for one author; clock skew is its known weakness.
3. Tombstones: delete sets `deletedAt` and keeps the id and `updatedAt`; a separate purge compacts later. Without them a replica that never saw the delete resurrects the record (the same reason an old link must not resurrect a deleted item).
4. Change events: a store that can say what changed. In zodal, `DataProvider.subscribe(cb)` emits `{type:'created'|'updated', id?, item}` or `{type:'deleted', id}` and returns an unsubscribe; it is optional, so check `provider.subscribe` and implement it in your own providers. If you later need an ordered, resumable feed, add a local `seq` and an origin tag (`local` or `remote`) so an engine can apply remote changes without echo loops.
5. Namespaced keys (`<app>.<collection>.v<N>`) so a sync scope is a prefix, and same-origin apps do not collide.
6. Export/import of the whole store in an open format, envelope included (`exportCollection`, `parseCollection`, `planImport`, `resolveImport`). It is the "long now" guarantee and the escape hatch when a vendor or sync service goes away. A stable per-install replica id (stored once) is also worth adding.

Envelopes carry `version`, so a synced replica running older code refuses newer data (`too-new`) instead of corrupting it.

## 3. Candidate engines (licenses and versions checked 2026-09-29)

| Engine | License | Pick when |
|---|---|---|
| Yjs (+ y-indexeddb, y-websocket) | MIT | shared rich text or documents with live cursors; the ecosystem is the largest |
| Automerge / automerge-repo | MIT | JSON-like documents with history; pluggable storage and network adapters (its byte key-value storage interface is a good model for your own seam); the npm `latest` tag of automerge-repo pointed at an alpha, pin a stable |
| Loro | MIT | versioned JSON-like documents, newer and fast; bring your own transport |
| TinyBase (`MergeableStore`) | MIT | your data is tables of rows; built-in HLC merge, persisters and synchronizers |
| Dexie Cloud | library Apache-2.0; hosted service is paid | you already use Dexie and want managed sync with access control (free tier is small: 3 production users) |
| PowerSync | SDKs Apache-2.0; service commercial or self-hosted | a Postgres, MongoDB or MySQL backend exists; SQLite on the client with an upload queue |
| ElectricSQL (+ TanStack DB) | Apache-2.0 (TanStack DB MIT, pre-1.0) | Postgres backend, read-path sync, writes through your API |
| Zero (Rocicorp) | Apache-2.0 | a real Postgres backend and query-driven sync; server-centric |
| Jazz | MIT | pre-1.0 and its direction has shifted: watch, do not adopt for now |
| Evolu | MIT | end-to-end-encrypted sync on SQLite; internals not verified |
| remoteStorage.js | MIT | the user chooses their own storage server (protocol-level); document-level last-writer-wins, small ecosystem |

Avoid: Triplit (AGPL-3.0; acquired by Supabase, 2025), Replicache (open-sourced but in maintenance mode; new work goes to Zero), localForage-style "sync" wrappers. Two shapes exist: document CRDTs (Yjs, Automerge, Loro) own the data model; record or mutation-log sync (PowerSync, Electric, Zero, Dexie Cloud, TinyBase) sits beside a store and needs the ids, versions and change feed from section 2. Hosted services are commercial even when the client is Apache-2.0.

## 4. Encrypted share links: the first step beyond pure-URL sharing

When a payload is too big for a URL or is private, upload only ciphertext to a dumb blob store and put the key in the URL fragment, which browsers do not send to servers. The server can neither read nor be compelled to disclose it.

```ts
import { wrap } from 'holdall';
const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));                       // fresh random IV per encryption
const plain = new TextEncoder().encode(JSON.stringify(wrap(item, spec)));    // compress here if wanted: ciphertext will not compress
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
const id = await upload(concat(iv, ct));                                     // server stores iv||ciphertext under a random id
const k = base64url(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
const link = `https://example.com/app/#/s/${id}&k=${k}`;                     // recipient: fetch, split iv, decrypt, then unwrap(raw, spec)
```

- The link is a bearer capability: anyone holding it can read. Say so in the UI. Give the blob an expiry and a delete token.
- After reading the fragment, `history.replaceState` it away; set `Referrer-Policy: no-referrer` and load no third-party scripts on the receive page (history, extensions and screenshots can still leak it).
- Optionally wrap the key with a password (PBKDF2 or Argon2) as a second factor. Read-only sharing is trivial; collaborative editing needs a CRDT and per-message IVs, which is out of scope here.
- It also solves the iOS install boundary: the Home Screen app starts empty, so "move my data" is a file or a link.

## 5. Local-first principles (Ink & Switch, 2019)

Work is instant on the local copy (no spinners); it is not trapped on one device; the network is optional; collaboration is seamless; the data outlives the vendor; security and privacy are the default; the user keeps ultimate ownership. In practice: the local store is primary, sync is an optional replica-to-replica transport, export in an open format always works, and encryption happens before anything leaves the device.

## Pitfalls

1. Adding a sync engine "for later": it brings a server, accounts and a migration. Keep the shape (section 2) and wait for the trigger.
2. Auto-increment ids or content-derived ids: two devices collide or the id changes on edit. Use client-generated random ids.
3. Hard deletes: the delete cannot propagate and old data resurrects. Tombstone first, purge later.
4. `Date.now()` as the only ordering: skewed clocks silently drop real edits. Prefer an HLC and bump only on real changes.
5. Reusing an AES-GCM IV with one key: it breaks confidentiality. Use a random 12-byte IV per encryption.

## Checklist

- The trigger (multi-device, collaboration, a backend) is real, or the answer is "export/import and links".
- Records have random ids, `updatedAt`, tombstones; the store can emit change events; keys are namespaced.
- Export/import round-trips including tombstones; the envelope refuses newer versions.
- Any encrypted link keeps the key in the fragment and tells the user it is a bearer link.
- Engine choice matches the backend and the license (no AGPL); pilot behind one adapter.

## References

- `references/research.md`: engine landscape with versions and licenses, the sync-ready store table, the encrypted-link design and the local-first principles, with Vancouver references.
- Router: `holdall`; storage and migrations: `holdall-local-store`; files and links: `holdall-files`, `holdall-share-links`.
