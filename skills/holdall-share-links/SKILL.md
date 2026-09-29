---
name: holdall-share-links
description: >-
  Put app state or a whole payload in a URL so it can be shared, bookmarked or restored, with no server. Use when asked to "make a share link", "copy link", "send this to someone", "put the state in the URL", "shareable URL", "deep link to this view", "URL hash vs query params", "encode JSON in a URL", "compress the URL", "link too long", "Slack/email cut my link", "open a shared link read-only", "replaceState vs pushState", "Back button with filters", "sync filters to the URL", "nuqs", "TanStack Router search params", "validateSearch", or "is it safe to put data in the link". Covers fragment vs query, the z1./j1. payload codec and envelope, makeShareLink/readShareLink/linkTier and the length tiers, view mode with a Keep them button, history handling, privacy copy and the too-long fallback.
license: MIT
metadata:
  package: holdall
---

# holdall-share-links: state and payloads in the URL

Use this when the address bar (or a link the user copies) should carry something: a filter set, a view, one item, a whole collection. Two different jobs hide behind "state in the URL", and they get different homes. Decide which one you have before writing code.

## 1. Decide: fragment payload or readable query params

| The URL carries... | Put it in | Use | Why |
|---|---|---|---|
| a document, item, collection, saved view (opaque, big, private-ish) | the **fragment** `#s=z1.…` | holdall `makeShareLink` / `readShareLink` | never sent to your server, not in access logs, stripped from `Referer`, no 414 from proxies |
| filters, sort, page, tab, search text (small, human-readable, navigational) | the **query** `?tag=a&sort=date` | nuqs (React) or TanStack Router `validateSearch` with a Standard Schema; `URLSearchParams` elsewhere | readable, bookmarkable, a server or link unfurler may need to see it |
| an id of something in this browser's store (`?d=<localId>`) | the query or path, **never labelled as a share link** | your router | it means nothing on another device: see pitfall 1 |

Rule of thumb: if you would be embarrassed to see it in a server log, or it exceeds ~500 characters, it is a payload and goes in the fragment. Filters are not payloads; for their UX (Back as undo, applied-filter summary) see `faceted-filter-ux` if available.

## 2. The payload format

`<codec>.<base64url>` with no padding. `z1` = raw DEFLATE (RFC 1951, no zlib header) of UTF-8 JSON; `j1` = UTF-8 JSON, uncompressed. `encodePayload` picks the shorter (`codec: 'auto'`) because DEFLATE grows tiny payloads. Inside the payload put an **envelope** `{app, kind, version, data}` (`wrap` / `unwrap`), so a link decoded next year still migrates. Rules that keep old links alive:

- Never reuse a prefix for a different encoding; only add new ones (`e1.` is reserved in the research for an encrypted blob). Keep every old decoder forever, with a golden-link fixture test per prefix.
- An unknown prefix throws `HoldallError` code `unknown-codec` ("made by a newer version"); a truncated payload throws `bad-payload`. Catch both at the UI edge and show a sentence, never a stack trace.
- Treat every decoded link as untrusted: `unwrap(raw, spec)` validates with a Standard Schema.

## 3. The API (`holdall`)

| Function | Does |
|---|---|
| `makeShareLink(value, baseUrl, {key='s', part='hash', codec, budget})` | returns `{url, length, tier}`. Always returns the link; you check `tier`. |
| `readShareLink(url, {key='s', part='hash'})` | the decoded value, `null` if the link has no such param, throws on a damaged payload |
| `linkTier(link \| length, budget?)` | `'portable' \| 'chat' \| 'email' \| 'too-long'` |
| `DEFAULT_LINK_BUDGET` | `{portable: 2000, chat: 4000, email: 8000}` (override per app) |
| `setUrlParam` / `getUrlParam` / `stripUrlParams(url, keys, {part})` | param helpers on the fragment (default) or query |
| `encodePayload` / `decodePayload` | the codec alone |

The tiers come from measured limits (old Outlook and Discord ~2,000; Slack splits bot links near 4,000; CloudFront and modern email ~8,000). What the UI does per tier:

| Tier | Length | UI |
|---|---|---|
| `portable` | ≤ 2,000 | "Copy link", no caveat |
| `chat` | ≤ 4,000 | Copy link; small note "Some chat apps and old email clients may cut long links. Send a file if the recipient reports a broken link." |
| `email` | ≤ 8,000 | Copy link with a visible warning; make "Save file" the equal-weight button |
| `too-long` | > 8,000 | No link. Offer "Save file" (see `holdall-files`), say why in one line. **Never truncate a payload.** |

## 4. The pattern

```ts
import { makeShareLink, readShareLink, stripUrlParams, unwrap, wrap, isHoldallError } from 'holdall';

const spec = { app: 'notes', kind: 'note', version: 1, schema: NoteSchema };
const PAYLOAD_KEY = 's';            // fragment: a shared payload
const LOCAL_ID_KEY = 'd';           // query: a local id, never shareable

// Outgoing: build the base from the current page with every payload/local-id stripped.
function shareLinkFor(note: Note) {
  const base = stripUrlParams(stripUrlParams(location.href, [PAYLOAD_KEY]), [LOCAL_ID_KEY], { part: 'search' });
  const link = makeShareLink(wrap(note, spec), base, { key: PAYLOAD_KEY });
  return link; // { url, length, tier }: branch on tier (table above)
}

// Incoming: on load AND on popstate, before the first render of the item.
function readIncoming(): Note | null {
  try {
    const raw = readShareLink(location.href, { key: PAYLOAD_KEY });
    return raw === null ? null : unwrap(raw, spec);
  } catch (e) {
    if (isHoldallError(e)) { showLinkProblem(e.code, e.message); return null; } // never crash
    throw e;
  }
}
addEventListener('popstate', () => render(readIncoming()));
```

With zodal, `createPersistence(...).shareLink(id, baseUrl)` and `.readLink(url)` do the wrap/unwrap for you (see `holdall-files`). To share a whole collection, pass `exportCollection(items, spec)` to `makeShareLink` and read it back with `parseCollection`.

Non-JS stacks: any language can write and read links. base64url without padding of raw DEFLATE (Python: `zlib.compressobj(9, zlib.DEFLATED, -15)`) of the JSON text. `npx holdall encode <file.json> --url https://example.com/app` prints a link and its tier; `npx holdall decode '<link>'` prints what a link carries. Use them to debug "the link is broken" reports and to build golden fixtures.

## 5. View mode: opening a link must not write

Opening a link is not consent to change the recipient's data. Load the payload into **in-memory** stores, render read-only, and show a banner: "You are viewing 3 items shared with you. Nothing is saved." with **Keep them** and **Close**. Keep them runs the normal import flow (`planImport` then `resolveImport`, defaults to keep both; see `holdall-files`), then strips the payload from the address with `replaceState`. Close does the same without importing. While viewing, leave the link in the address so a reload shows the same view. If a link carries an item id the recipient already holds, the plan reports "identical" or "differs"; never overwrite silently.

Tombstones: if the user can delete items, remember the ids they deleted (a hash of the id is enough) so an old link sitting in browser history cannot resurrect them on load. An explicit "Keep them" may still bring one back.

## 6. History: replaceState, pushState, and Back

| Situation | Call | Why |
|---|---|---|
| continuous state (typing, dragging, zoom, autosaved doc) mirrored into the address | `history.replaceState(history.state, '', url)`; serialize writes (one queue) so they don't race; throttle (Safari throttles replaceState) | no history entry per keystroke; pass `history.state` back untouched so router state survives |
| a committed navigation or filter change the user may want to undo | `pushState` | Back must step through them, one per committed change, not per keystroke |
| consuming a payload on load, "Keep them", "Close" | `replaceState` to the payload-free URL | Back must not return to a payload the user dismissed |
| a pasted URL over a live page | listen to `popstate`, re-read | the app must not ignore the new address |

Default for collections: **do not mirror the payload into the address at all.** Keep the address clean and build the link only when the user clicks Copy. Mirror only small view state.

## 7. Pitfalls

1. A `?d=<localId>` is not shareable. It resolves only in the browser that holds the item. Sharing means embedding the item (payload key `s`) and using a param name distinct from local ids, or the recipient lands on "not found".
2. Never build outgoing links from `location.href` unstripped: a "share this page" or OAuth-redirect link would leak the user's payload. Always `stripUrlParams` first, and add the payload only on an explicit share.
3. The fragment is shared with the router. holdall reads `#k=v&k=v`, and for hash routers `#/route?k=v` (the path is kept on write). A plain `#anchor` used for scrolling collides with params: prefer path-based routes (History API), or scroll by an id param instead.
4. Compress after pruning default-valued fields, and measure the final URL: raw JSON grows ~65% percent-encoded and shrinks 50-86% deflated. Re-run the tiers on real data, not fixtures.
5. Decode defensively: a mangled param yields "this link looks damaged" and `null`, never an exception in render. `decodePayload`/`readShareLink` refuse payloads that inflate past `maxBytes` (default 8 MB, `DEFAULT_MAX_DECODED_BYTES`), since a 2 KB link can expand to gigabytes; lower it to what your app can actually hold.
6. Fragment payloads are not secret. Anyone with the link can read it; it sits in the chat app, the email provider, browser history (which may sync to other devices) and any page script that reads `location`. Unfurlers never see the fragment, so previews are generic.
7. Do not add msgpack/CBOR (1-2% gain after DEFLATE, lost debuggability) or jsurl/rison/urlon (dormant).

## 8. Too-long fallback (a future seam)

Today: a file (`holdall-files`). Later, the Excalidraw pattern: encrypt the payload with AES-GCM using a fresh key and a **random 96-bit IV per message**, store the ciphertext somewhere, and put `id,key` in the fragment under a new codec prefix (`e1.`). The key never leaves the fragment. Do not build this until a store exists; keep the decision in one place (`if tier === 'too-long'`) so it slots in.

## 9. Privacy copy (use it)

- On the Copy button: "This link contains your data. Anyone who has the link can read it."
- Under it: "It is not sent to our server, but it will appear in the chat, mail or browser history where you paste it."

## 10. Checklist

- [ ] Payload in the fragment; readable filters in the query; local ids under a different param name.
- [ ] Versioned prefix, envelope, schema validation; golden-link test for each prefix.
- [ ] `linkTier` drives the UI; too-long offers a file; nothing is truncated.
- [ ] Read on load and on `popstate`; damaged link shows a sentence.
- [ ] View mode is in-memory; Keep them goes through the import plan.
- [ ] Outgoing links stripped of payload params; `replaceState` for continuous state, `pushState` for undoable navigation.
- [ ] Privacy copy shown at the Copy button.

## References

- `references/research.md`: codec comparison, URL length limits by client/server/messenger, fragment vs query, typed URL-state libraries, versioning, prior art (Excalidraw, Mermaid Live), with numbered sources.
