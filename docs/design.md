# holdall design

## What it is

Two products in one repo. The **agent surface** (the main product): a router skill `holdall`, five nested skills and a read-only auditor subagent, which route a request such as "implement client-side storage" to the right patterns for the app's stack. The **headless core**: a small, framework-free TypeScript package that implements the parts every app otherwise re-writes (share-link codec, envelopes and migrations, the import conflict planner, file save/open, persistence and install advice, autosave), plus an optional zodal facade.

The user's data lives with the user: in the browser, in files, in links. Nothing is stored on a server.

## Seams

| # | Seam (one parameter) | v1 default | Replacement that exists |
|---|---|---|---|
| 1 | where records live (`provider` in `createPersistence`) | any zodal `DataProvider`; apps start with `@zodal/store-localstorage` | `@zodal/store-fs`, `@zodal/store-http`, `@zodal/store-supabase`; an IndexedDB records provider is a planned zodal satellite (the existing IndexedDB providers hold content and blobs only) |
| 2 | link payload codec (`codec`) | `auto`: `z1` (fflate raw DEFLATE) or `j1` (plain), whichever is shorter | an encrypted `e1` codec (AES-GCM, key in the fragment, async): `e1` is reserved (sync decoders raise `async-codec`), and it will arrive as a new async reader beside the sync one; the zodal facade's `readLink` is already async so its callers will not change |
| 3 | import conflict handling (`policy`, `decisions`) | `rename` with prefix `imported-` | `skip`, `overwrite`, per-key decisions from a dialog |
| 4 | install UI | `installAdvice()` returns data (kind, steps, copy) | `@khmyznikov/pwa-install` web component |
| 5 | validation (`schema`) | envelope checks only | any Standard Schema validator (Zod 4, Valibot, ArkType) |

**Not seams, written directly on purpose:** the envelope shape `{app, kind, version, savedAt, data}`, base64url, the payload grammar `<codec>.<body>`, the collection file shape `{items: {key: value}}` under kind `<kind>:collection`, key namespacing conventions, file naming.

## Surfaces

- **npm library** (`holdall`, `holdall/zodal`): the core.
- **CLI** (`holdall encode|decode`): inspect and build share links from a terminal; it is also the one-command test.
- **Agent skills and subagent** (`skills/`, `agents/`): the main surface; each skill carries its own `references/`.
- MCP and HTTP: not needed. The library runs in the browser, and the formats are plain JSON and base64url that any stack can read.

## One-command test

`pnpm build && pnpm smoke` encodes `examples/design.json` into a payload and decodes it back. `tests/smoke.test.ts` does the same through a full share link.

## Research

`docs/research/` holds the three cited reports behind the defaults: URL state, storage libraries, formats and merge (01); durability, files and sharing (02); install and sync (03).
