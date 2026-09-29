---
name: holdall
description: >-
  Route any client-side persistence or sharing task in a web app to the right pattern. Use when asked to "implement client-side storage", "save the user's work", "persist state", "remember settings", "don't lose data on reload", "autosave", "make a share link", "put the state in the URL", "copy link", "save to a file", "load/open a JSON file", "export/import", "backup and restore", "export the whole collection", "merge imported items", "make it installable", "add an Install app button", "PWA", "use localStorage/IndexedDB/OPFS", "storage quota", "Safari/iOS deleted my data", "no backend, keep data in the browser", or "sync between devices". Picks the nested holdall skill by need and stack, and the holdall npm package (headless TS, optional zodal facade) when JS/TS is in play.
license: MIT
metadata:
  package: holdall
  audience: agents building web apps
---

# holdall: client-side persistence and sharing (router)

The user's data lives with the user: in their browser, in files they hold, in links they send. Nothing is stored on a server. Your job is to make that **durable, portable and honest**, with the least code, using good permissive libraries rather than re-inventing them.

## 1. Route by need

Read the request and the app, then load only the nested skills you need. Most requests need two or three.

| The user wants... | Load | holdall API (if JS/TS) |
|---|---|---|
| state to survive a reload; autosave; "don't lose my input" | `holdall-local-store` | `createAutosave`, envelope `wrap`/`unwrap` |
| to pick localStorage vs IndexedDB vs OPFS; schema versions; migrations | `holdall-local-store` | `unwrap(raw, {version, migrations, schema})` |
| a link that carries the state; URL/query state; "send this to someone" | `holdall-share-links` | `makeShareLink`, `readShareLink`, `linkTier` |
| save/open a file; export/import one item or a whole collection; merge with conflicts | `holdall-files` | `saveJson`, `openText`, `exportCollection`, `planImport`, `resolveImport` |
| data that is not silently wiped; an Install button; iOS/Safari advice | `holdall-durability` | `ensurePersistence`, `installAdvice`, `captureInstallPrompt` |
| the same data on several devices, or collaboration | `holdall-sync-later` | none yet: a later seam |
| a review of what an existing app does and what it risks | subagent `holdall-auditor` | n/a |

If the app keeps collections in zodal (`@zodal/store` `DataProvider`), use the facade `holdall/zodal` (`createPersistence`) and read the zodal section of `holdall-files`.

## 2. Route by stack

- **JS/TS (any framework).** `npm i holdall`. The core is headless and framework-free: pure functions, browser globals injectable. Wrap them in the app's own idiom (a React hook, a Svelte store, a Vue composable). Do not add a UI framework for this.
- **zodal app.** `holdall/zodal` + the app's `DataProvider`; add `persistenceOperations` to `defineCollection({operations})`; the app renders the dialogs.
- **Other stacks** (Python-rendered pages, Elm, plain HTML). Follow the patterns in the nested skills; the formats (envelope, `z1.`/`j1.` payloads, collection files) are plain JSON and base64url, so any language can read and write them. `npx holdall decode <link>` inspects a link from a terminal.

## 3. The invariants (every route)

1. **Browser storage is a cache; a file or link the user holds is the record.** Offer "Save backup" and "Copy link" from day one, not "later".
2. **Everything that leaves the app is enveloped** `{app, kind, version, data}`, and reading runs forward-only migrations and refuses data newer than the code. Old links must keep working.
3. **Never lose input.** Autosave (debounced), flush on `pagehide` and on `visibilitychange` to hidden, keep a failed write pending, clear a draft only after a confirmed save.
4. **Never drop data silently.** Import reports added / identical / conflicting / rejected; a conflict defaults to keeping both (the incoming key gets a prefix); a write the store refused stays in the file and the UI says so.
5. **Storage goes behind one interface** (a zodal `DataProvider`, or a small `get/set/list/remove` object). No scattered `localStorage` calls. Namespace keys per app: apps on one origin share storage and one "Clear site data" wipes them all.
6. **Say plainly where the data lives.** "Your data is only in this browser on this device. We have no copy." Ask for persistent storage after the first save; show install advice after the first save, never on page load.

## 4. Defaults (researched; see each nested skill's references)

| Need | Use | Avoid |
|---|---|---|
| link payload | fflate DEFLATE + base64url in the URL **fragment**, with a codec prefix | lz-string for new links, jsurl/rison/urlon (dormant) |
| key-value in IndexedDB | `idb-keyval`; `idb` when you need indexes | localForage (dormant), RxDB (paid storages) |
| rich local queries | Dexie | a hand-written IndexedDB layer |
| typed URL params (React) | nuqs, or TanStack Router `validateSearch` | hand-parsing `location.search` everywhere |
| files | browser-fs-access | file-saver (unmaintained, unneeded) |
| install | vite-plugin-pwa + Workbox for the shell; `holdall` `installAdvice` for the copy; optional `@khmyznikov/pwa-install` UI | pwacompat, @pwabuilder/pwainstall (unmaintained) |
| validation | any Standard Schema (Zod 4, Valibot) | an ad-hoc `typeof` checker |

## 5. Before you finish

- Round-trip test: export → import gives the same items; encode → decode gives the same value; an old-version fixture still loads.
- Try it in a private window (storage may be blocked) and after "Clear site data" (the app offers a restore, not a blank slate).
- Tell the user which durability tier they got on which platform (see `holdall-durability`).
