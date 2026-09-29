# Browser storage durability, local files, sharing and cross-tab consistency (state as of 2026-09-29)

Scope: what a headless, agent-first toolkit for client-side persistence and sharing (nothing stored server-side) can rely on in current browsers. Sections A to E follow the brief, then a section of concrete recommendations. Claims are cited [n]. Where a claim rests on a secondary source, on my own inference, or where two sources disagree, that is stated in the text. I did not run any browser tests; everything below is from documentation, spec text, bug trackers and compat data fetched on 2026-09-29.

Current engine versions at time of writing: Safari 27.0 shipped on 2026-09-17 [42]; caniuse lists Chrome Android 154 and Firefox 159 [17][35].

## Executive summary

The only storage the browser guarantees to keep is storage the user has explicitly given up on managing. Everything a web app writes by default (IndexedDB, OPFS, localStorage, Cache API, service workers) is "best-effort" and can be evicted whole-origin under storage pressure or, on Safari, after 7 days of non-use [1][3].

`navigator.storage.persist()` is supported in all three engines (Safari since 15.2) [12], but its value differs sharply: Chrome silently auto-grants only for "important" sites [6][7], Firefox shows a prompt after a user gesture [6], and Safari grants it but WebKit's own tracker records that Intelligent Tracking Prevention (ITP) still deleted the data of a persisted origin after 7 days [5]. The only documented protection against the Safari 7-day cap is being a Home Screen web app (iOS/iPadOS) or a Dock web app (macOS) [3][4][5].

Even a persisted origin is wiped when the user clears site data, in every browser [1][9]. So for an app with no server, the durable copy of user data must be something the user holds outside the origin: a file they saved (File System Access handle where available, otherwise a downloaded blob), or a share link/export. Browser storage should be treated as a cache with good manners, not as the system of record.

File System Access pickers remain Chromium-desktop-only in 2026; Firefox has a "negative" position [18], WebKit an "oppose" position [19], and Safari 27 does not add them [42]. OPFS is universal and follows the same quota and eviction rules as IndexedDB [27].

## A. Quotas, eviction and persistence per engine

### A.1 Concepts

The Storage Standard defines two bucket modes: "best-effort" (default; the user agent may clear it without asking, under storage pressure) and "persistent" (only established with permission; the agent must not clear it without user involvement) [10]. When storage is short, agents are told to clear best-effort buckets first, ideally in a way that least impacts the user, and only then offer to clear persistent ones [10]. MDN describes the resulting behaviour as LRU by origin: the least recently used origin is deleted first, then the next, and so on; persistent origins are skipped [1].

Eviction is all-or-nothing per origin: "all of its data, not parts of it, is deleted at the same time", covering IndexedDB, Cache API and the rest together [1]. Partial loss (for example IndexedDB gone but localStorage kept) is therefore not the normal failure mode of eviction, although it is the failure mode of Safari's 7-day cap on some storage types and of bugs (see A.4).

Clearing site data removes the entire "storage shed": IndexedDB, localStorage, sessionStorage, Cache API and service worker registrations [10]. OPFS is deleted too [27]. `persist()` does not defend against this: MDN's wording is "will not be cleared except by explicit user action" [9], and a user choosing "clear site data" is that action.

`navigator.storage.estimate()` returns `usage` and `quota`. The quota is deliberately fuzzy: the spec says quotas are conservative estimates and are obscured to prevent fingerprinting, and browsers may pad cross-origin data sizes [1][10]. Chrome computes quota from total disk size, not free space, for the same reason [1]. So `estimate()` is useful for "am I near the ceiling" warnings, not for capacity planning.

### A.2 Comparison table

| Aspect | Chromium (Chrome, Edge, Samsung, Opera) | Firefox (desktop and Android) | Safari / WebKit (macOS, iOS, iPadOS) |
|---|---|---|---|
| Default mode | Best-effort [1] | Best-effort [1] | Best-effort [2] |
| Per-origin quota, best-effort | Up to 60% of total disk; browser-wide cap 80% [1][13] | Smaller of 10% of disk or 10 GiB per eTLD+1 group [1] | About 60% of disk for browser apps since macOS 14/iOS 17; overall cap 80% [1][2] |
| Quota, persistent mode | Same 60% [1] | Up to 50% of disk, max 8 TiB, no group limit [1] | Same as best-effort; persistent origins are protected from LRU eviction [2] |
| Embedded web content (WKWebView apps) | n/a | n/a | About 15% of disk per origin, 20% overall; except Home Screen / Dock web apps, which get the browser quota [1][2] |
| `persist()` supported | Chrome 55, Edge, Android [12] | Firefox 57 [12] | Safari 15.2, iOS mirrors [12] |
| How `persist()` is decided | Silent heuristic, no prompt. Documented inputs: site engagement, bookmarked (originally "5 or fewer bookmarks"), installed/added to home screen, notifications/push granted; otherwise silently denied [6][7] | Permission prompt shown to the user, only after a user-gesture-triggered call [6] | Silent, no prompt. WebKit says it grants "based on heuristics like whether the website is opened as a Home Screen Web App" [2] |
| Is a persisted origin still deleted by the browser? | No, except by explicit user action [9] | No, except by explicit user action [9] | LRU/pressure: protected [2]. ITP 7-day: reported NOT protected (WebKit bug 209563, still open as of a 2025-07-24 comment) [5] |
| Proactive time-based deletion | None | None | Yes: ITP deletes script-writable storage after 7 days of Safari use without user interaction with the site [3][4] |
| Effect of "installed PWA" | Chrome grants persist more readily for installed apps [6][7]. On desktop the installed app shares the browser profile's storage for the same origin (secondary source [48]). Android WebAPK: shares Chrome's data, cleared when Chrome site data is cleared (secondary source [49]). Installation gives no time-based protection because there is none to escape | Firefox added an experimental "Web Apps"/Taskbar Tabs feature on Windows around Firefox 143 (2025); it is a site-styled browser window, not a separate storage container as far as I could find [46]. No documented storage effect | Home Screen web app (iOS/iPadOS) and Dock web app (macOS 14+): own storage container separate from Safari, own days-of-use counter, exempt from the ITP 7-day deletion, browser-tier quota [2][3][4][5][13] |
| Private browsing | Incognito quota is lower (web.dev says about 5% of disk; some older material says about 100 MB); data deleted when the last incognito window closes [1][13] | IndexedDB works in private windows since Firefox 115 (ephemeral, memory/encrypted-disk) [50]; OPFS `getDirectory()` throws in some browsers in private mode, MDN does not say which [32] | localStorage/IndexedDB are ephemeral and discarded when the private tab/window closes (secondary sources); `getDirectory()` may throw [32] |
| Storage Buckets API | Shipped Chrome 122 (Feb 2024), IndexedDB inside buckets only, `persisted` and `durability` options [11][12] | Not implemented, no signal [12] | Not implemented, no signal [12] |
| What "clear site data" wipes | Everything for the origin including persisted data and OPFS [1][10][27] | Same | Same; on iOS "Clear History and Website Data" wipes all origins, and Home Screen apps have separate containers |

Notes on the table.

The Safari row "ITP not honouring persist()" is the single most important caveat for this project and rests on a WebKit Bugzilla thread: a developer reported in October 2023 that "even though Safari seems to grant persistence through this API, ITP still blows away the site's data after 7 days", and WebKit's John Wilander answered only that Dock web apps share the Home Screen exemption [5]. The bug is still "NEW". I did not find a WebKit statement that this changed in Safari 26 or 27, and the Safari 26.4 and 27.0 release notes I read list no storage-policy change [42][43], but I did not test a real device. Treat it as unresolved and verify on a device before promising anything.

The 7-day cap counts days of Safari use, not calendar days, and only user interaction resets it: "a user click, tap, or keyboard entry... Scrolling is not considered user interaction" [4]. Covered storage types: IndexedDB, localStorage, media keys, sessionStorage, service worker registrations and cache [3][4]. The WebKit text does not carve out a case for sites the user visits regularly without interacting.

The cap comes from ITP, which WebKit enables by default in WKWebView apps too (secondary source [45]). On iOS outside the EU all browsers run WebKit, so Chrome-on-iOS and Firefox-on-iOS should inherit it; this is my inference and I did not find it stated in one place. In the EU since iOS 17.4, alternative engines are allowed [45], and Home Screen web apps were kept after Apple's reversal but remain WebKit-based [45].

iOS 26 changed Home Screen behaviour: every site added to the Home Screen now opens as a web app by default unless the user turns off "Open as Web App"; a manifest is no longer required [41]. That makes the "Add to Home Screen" mitigation easier to describe to users, but it is still a manual, per-user step, and it creates a storage container separate from Safari: data in the Safari tab is not visible in the Home Screen app (secondary sources [48]). The two containers must never be assumed to be the same store.

Numbers dating warning: web.dev's "Storage for the web" (last updated 2024-09-23) still says Safari allows about 1 GB and prompts in 200 MB increments [13]. That describes Safari before 17; the WebKit post on the updated policy [2] and MDN [1] supersede it.

Also of note, WebKit had a real bug where Safari 17.2 on macOS 13.6.3/14.2.1 periodically erased localStorage and IndexedDB for all sites when Web Inspector was open, fixed by Safari 17.4 [44]. It is a reminder that engine bugs are a durability risk independent of policy.

### A.3 Chrome's grant heuristics, in practice

The Intent to Ship for durable storage lists: bookmarked (and the user has 5 or fewer bookmarks), high site engagement, added to home screen, push notifications enabled; "automatically denies in all other cases" [7]. web.dev restates it as engagement, installed or bookmarked, and notification permission [6]. A 2025 hands-on test found that bookmarking and installing alone did not reliably yield a grant and that the "engagement score" has no public definition [8]. Conclusion: an app cannot make Chrome grant persistence, only call `persist()` repeatedly at meaningful moments (after saving something, after install) and record the answer. Requests can be repeated and are re-evaluated [6].

### A.4 What can still be lost even when everything is done right

Users clearing site data, storage managers in the OS ("free up space" tools on Android/iOS), antivirus/cleaner software, browser profile deletion, browser reinstall, private windows, and engine bugs [1][29][44]. The SQLite team states the same for OPFS: databases "may disappear due to virus scanners, cleaner software, browser permissions, or automatic browser cleanup" [29].

## B. File System Access API and fallbacks

### B.1 Support matrix (2026-09)

| Feature | Chrome/Edge desktop | Chrome Android | Firefox | Safari macOS/iOS |
|---|---|---|---|---|
| `showOpenFilePicker`, `showSaveFilePicker`, `showDirectoryPicker` | Yes (Chrome 86) [12] | MDN compat data says Chrome Android 132 [12]; caniuse still shows "not supported" for Chrome Android 154 [17]. Sources disagree; treat as unreliable on mobile | No. Mozilla standards position: negative [18]. A third-party extension polyfills it [51] | No. WebKit position: oppose (security), OPFS excluded from the objection [19]. Not in Safari 26.x/27.0 notes [42][43] |
| `FileSystemHandle.queryPermission` / `requestPermission` | Yes [12] | Yes (109) [12] | No [12] | No [12] |
| Handles storable in IndexedDB / `postMessage` | Yes [15] | Yes | Only OPFS handles exist | Only OPFS handles exist |
| Persistent (cross-session) permission | Chrome 122: "Allow on every visit"; installed apps auto-persist once granted [14] | Same code path, unverified | n/a | n/a |
| `FileSystemObserver` | BCD says Chrome 133 [12]; MDN calls it experimental and non-standard [26]; the Chrome blog describes an origin trial that ended in Chrome 134 [24]. Do not rely on it | No | No | No |
| OPFS `getDirectory()` | Chrome 86 [12] | 109 | Firefox 111 | Safari 15.2 |
| Global usage of the pickers (caniuse) | About 31% [17] | | | |

Requirements common to the pickers: secure context and transient user activation [16][15].

### B.2 Permission behaviour to design around

Handles are serializable and can be kept in IndexedDB to restore "recent files" or a working directory [15]. But "permissions are not always persisted between sessions": after a handle is retrieved, call `queryPermission({mode})`, and if it returns `prompt`, call `requestPermission({mode})` from a user gesture [15]. Permission access ends when all tabs of the origin close, in the older model [15].

Chrome 122 added persistent permissions: a three-way prompt ("Allow this time", "Allow on every visit", "Don't allow"); permission may still be revoked automatically after a tab has been backgrounded for a long time; installed apps automatically persist permissions once the user grants access; after more than three dismissals the regular prompts resume [14]. Users manage the grants in site settings [14].

Two consequences for a storage toolkit: (1) the handle lives in IndexedDB, so it is subject to the same eviction and clear-site-data as everything else; if the origin is wiped the folder content survives on disk but the app forgets which folder to use, and the user has to re-pick it; (2) any code path that touches the handle after a restart may need a user gesture, so an agent-driven or headless flow cannot assume silent access.

The browser may refuse certain locations, for example core operating system folders such as Windows and the macOS Library folders [15]. The exact blocklist is defined in the spec and differs by platform; I did not enumerate it.

### B.3 Fallback when the pickers are missing

Open: `<input type="file">`, and `<input webkitdirectory>` for folders. Save: create a Blob, `URL.createObjectURL`, and click an `<a download>` [20]. This is the pattern implemented by the libraries below, and it means there is no "Save" to the same file in Firefox/Safari, only "Save as" into Downloads; the user must re-import the file to continue [20].

### B.4 Libraries

| Library | What it does | License | Maintenance evidence |
|---|---|---|---|
| [browser-fs-access](https://github.com/GoogleChromeLabs/browser-fs-access) (GoogleChromeLabs) | `fileOpen`, `directoryOpen`, `fileSave`; uses FSA when present and falls back to `<input type=file>` and `<a download>` [21]. Described by Chrome as a ponyfill [20]. "Not an official Google product" [21] | Apache-2.0 | npm 0.38.0 published 2025-06-18; repo last pushed 2026-06-22; about 1.6k stars; 1 open issue, 9 PRs at time of fetch (GitHub API and npm registry, 2026-09-29) |
| [native-file-system-adapter](https://github.com/jimmywarting/native-file-system-adapter) (jimmywarting) | Ponyfill of the whole FSA surface: pickers, handles, writable streams, plus backends (OPFS sandbox, IndexedDB, memory, Node fs, Deno, Cache API). Without FSA the pickers degrade to input elements backed by an in-memory adapter [22] | MIT | npm 3.0.1 published 2024-02-26; repo last pushed 2026-07-14; about 600 stars. Repo active, npm release lagging |
| [FileSaver.js](https://github.com/eligrey/FileSaver.js) (eligrey) | `saveAs(blob, name)` only, a download shim [23] | MIT (package.json/npm; GitHub's detector reports NOASSERTION) | npm 2.0.5 published 2020-11-19; repo last pushed 2023-03-01; about 22k stars. Stable but effectively unmaintained. Modern browsers do not need it: `<a download>` with an object URL is enough |

For a toolkit that wants one facade for "get bytes in from a file / put bytes out to a file", browser-fs-access has the best fit (small, maintained, Apache-2.0, exactly the progressive-enhancement contract) and native-file-system-adapter is the better fit if you want the handle abstraction itself and multiple backends behind one interface. Neither gives you the "remember and re-open the same file" behaviour on non-Chromium browsers because that capability does not exist there.

### B.5 "Watch a local folder as a store" pattern and caveats

Idea: the user picks a directory via `showDirectoryPicker({mode: "readwrite"})`, the app keeps the handle in IndexedDB, and reads/writes the app's data as ordinary files in that directory (for example one JSON file per record). The store survives site-data clearing and can live in a cloud-synced folder or a git repo.

Caveats, in rough order of severity:

1. Chromium desktop only (see B.1). It must be optional and the same store interface must also have an OPFS/IndexedDB implementation and a "manual export/import" implementation.
2. Re-permission on each session: needs a user gesture and may show a prompt even for previously chosen folders [14][15]. Installed apps get automatic persistence of the grant [14].
3. No change notification you can depend on. `FileSystemObserver` exists in Chromium but is experimental, has platform quirks (no cross-directory "moved" on Windows, "unknown" events when events are missed or observation limits are hit) and is not a standard [24][26]. Otherwise you must poll `getFile().lastModified` or compare sizes.
4. No cross-file transactions, no OS-level locks shared with other programs. `createWritable()` writes to a temporary swap file and commits on `close()`, so a single file write is close to atomic, but a multi-file update is not. Use a manifest/journal file, and use Web Locks (E) to serialise writers within the browser only.
5. External editors and sync clients (Dropbox, iCloud, Syncthing) can change or conflict with files while the app is open; the app needs its own content hashing or version stamps.
6. Sensitive or system locations are blocked [15]; users need to pick a dedicated subfolder.
7. Chrome Android status is contradictory across sources [12][17]; do not target mobile.
8. Handle stored in IndexedDB is lost if that origin data is wiped; provide a "reconnect folder" flow.

## C. OPFS

Support: Chrome/Edge 86, Firefox 111, Safari 15.2, Chrome Android 109 [12][28]. MDN marks it "widely available" since March 2023 [27]. `createSyncAccessHandle()` (synchronous, in dedicated workers only) is available in Chrome 102, Firefox 111, Safari 15.2 [12][27]. On the main thread only async APIs are available; `createWritable()` reached Safari in 26 [12].

Semantics: private to the origin, invisible to the user, no permission prompts, no Safe Browsing checks [27][28]. It counts against the origin's quota and is visible in `estimate()` under `usageDetails.fileSystem` [28].

Is OPFS subject to the same eviction as IndexedDB? Yes. MDN's OPFS page says OPFS "is subject to browser storage quota restrictions similar to IndexedDB", counts against the origin's total quota, and "clearing storage data for a site deletes the OPFS" [27]. web.dev says it follows the same quota rules as localStorage and IndexedDB and users can clear it via site-data deletion [28]. The Storage Standard treats all origin storage, including the file system endpoint, as belonging to the same bucket [10] (my reading: the spec text I fetched speaks of "storage shed" and lists the APIs; OPFS is the "bucket file system"). The SQLite project says explicitly that OPFS databases are subject to browser-level eviction [29]. `persist()` protects it exactly as it protects IndexedDB, with the same Safari/ITP caveat.

Use cases:

| Library | Storage backends | Constraints | License / maintenance (2026-09-29) |
|---|---|---|---|
| [@sqlite.org/sqlite-wasm](https://sqlite.org/wasm) (official) | `opfs` VFS (needs COOP/COEP headers for SharedArrayBuffer, multi-connection limited), `opfs-sahpool` (fastest, no special headers, single connection), `opfs-wl` (Web Locks based, needs `Atomics.waitAsync`), `kvvfs` (localStorage/sessionStorage, about 5 MB, main thread) [29] | OPFS VFSs work only in workers. Safari 16.4+, with versions below 17 incompatible with the standard `opfs` VFS [29] | Apache-2.0; npm 3.53.4-build1, 2026-09-08; repo pushed 2026-09-08 |
| [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) | OPFS-based VFSs (OPFSCoopSyncVFS, OPFSAdaptiveVFS, OPFSWriteAheadVFS, OPFSAnyContextVFS, AccessHandlePoolVFS) and IndexedDB VFSs (IDBBatchAtomicVFS, IDBMirrorVFS), memory [31] | Build needs Emscripten; prebuilt dist provided | MIT since Feb 2023; repo pushed 2026-09-29; npm `wa-sqlite` 1.0.0 is from 2024-01 so prefer the repo dist |
| [PGlite](https://pglite.dev) | `idb://` (loads the whole DB into memory at start, layered over in-memory FS), `opfs-ahp://` (worker-only access-handle pool), `memory://` [30] | Safari appears to limit open sync access handles to 252 and Postgres needs over 300 files, so `opfs-ahp` does not work on Safari; IndexedDB is the recommended browser filesystem; multi-tab needs the Multi Tab Worker [30] | Apache-2.0; npm 0.5.8, 2026-08-26 |

Design point for the toolkit: these engines give you database-grade performance, but none of them changes the durability class. A SQLite file in OPFS is exactly as evictable as an IndexedDB store, so the "export a `.sqlite` or `.json` file" path is still the durability path.

## D. Web Share and Clipboard

### D.1 Web Share

`navigator.share(data)` and `navigator.canShare(data)`; `data` may contain `title`, `text`, `url` and `files` (Level 2) [33]. Requirements: secure context, transient user activation, and the `web-share` permissions policy [33]. Rejections: `AbortError` for user cancel or no share targets, `NotAllowedError` without activation, `TypeError` for invalid data or unsupported files [33]. Shareable file types are limited to certain audio, image, video, text (`.txt`, `.html`, `.csv`, `.css`), and `.pdf`; JSON and arbitrary binaries are typically rejected, so a JSON export should be shared as `.txt` or as a URL, and always feature-tested with `navigator.canShare({files})` [33][34].

| Browser | `share()` | `canShare()` / files |
|---|---|---|
| Chrome desktop | 128 for all desktop platforms; 89 to 127 only on Windows and ChromeOS [12] | 128 [12] |
| Edge desktop | 93 [12] | 93 |
| Chrome Android, Samsung | Yes (61) [12] | Yes (75) [12] |
| Safari macOS / iOS | 12.1 [12] | 14 [12] |
| Firefox desktop | Not shipped: behind `dom.webshare.enabled` [12], caniuse "not supported through v159" [35] | Same |
| Firefox Android | Yes (79); caniuse marks 156+ [12][35] | 96 |

caniuse global coverage is about 92.8% [35]. Note conflicting web.dev text ("Chrome 93+") versus the compat data [34][12]; the compat data is more detailed. So a share button must be a progressive enhancement over "copy link" and "download file", never the only path.

### D.2 Clipboard

`navigator.clipboard.writeText()` is Baseline (widely available since March 2020), secure context only, and rejects with `NotAllowedError` when not permitted [37]. Chromium supports the `clipboard-write` permission and lets writes through with either the permission or transient activation; Firefox and Safari require transient activation for writes and do not support the clipboard permissions [36]. `Clipboard.write()` with `ClipboardItem` exists since Chrome 76, Safari 13.1, Firefox 127 [12]. Practical rule: call `writeText` synchronously inside the click handler, and keep a visible "select and copy" text field as the fallback for iframes or denied permission (iframes need the `clipboard-write` permissions policy [36]). `document.execCommand("copy")` is the legacy fallback; I did not verify its removal status.

## E. Cross-tab consistency

| Mechanism | What it does | Limits | Support |
|---|---|---|---|
| `storage` event | Fires in other same-origin documents when localStorage changes; does not fire in the window that made the change; for sessionStorage only within the same tab's frames [39] | localStorage/sessionStorage only. No event for IndexedDB or OPFS. Synchronous storage API | Since April 2017 [39] |
| `BroadcastChannel` | Message bus among same-origin windows, tabs, frames and workers; structured clone; a channel object does not receive its own messages; respects storage partitioning (a third-party iframe cannot talk to a first-party page of the same origin) [38] | No persistence, no delivery guarantee to tabs that open later, no ordering across channels; private windows are separate | Baseline since March 2022; Safari 15.4 [12][38] |
| Web Locks (`navigator.locks`) | Named exclusive or shared locks across tabs and workers of an origin; options `ifAvailable`, `steal`, `signal`; released automatically when the tab closes or crashes; `navigator.locks.query()` for diagnostics; incognito is partitioned; supports the leader-election pattern (one tab syncs IndexedDB) [40] | Origin-scoped only; does not coordinate with other programs touching a directory-handle folder; avoid nested locks to prevent deadlocks [40] | Baseline since March 2022; Chrome 69, Firefox 96, Safari 15.4 [12][40] |

Recommended combination: Web Locks for write serialisation and leader election, BroadcastChannel for "data changed, re-read" notifications (carry a version or record id, not the data), the `storage` event only as a fallback trigger or when the store is localStorage. All three are available in every current engine, so there is no need for a per-engine shim. Re-read from the store on notification instead of trusting the message payload, because a tab that was frozen or opened later will have missed messages.

## What this means for an app that stores nothing server-side

### Principles

1. Browser storage is a cache with a best-effort lifespan. The system of record for anything the user cares about must be a file or link the user controls. The app should say so plainly.
2. Layer the stores behind one interface with capability detection, strongest first: (a) directory or file handle (Chromium desktop), (b) OPFS/IndexedDB (all browsers), (c) in-memory, with export/import available on every layer. A seam here is one keyword argument (backend), defaulting to the best available.
3. Never rely on a capability you cannot detect. Detect with `"showOpenFilePicker" in window`, `navigator.storage.persist`, `navigator.canShare`, `navigator.locks`. Report the detected tier back to the caller in the API result so an agent can act on it.
4. Ask for durability at the right moment and record the outcome. Call `navigator.storage.persist()` after the user first creates data, from a click handler (Firefox requires the gesture [6]), then read `navigator.storage.persisted()` on every start. In Chrome it may be silently denied and re-tried later; in Safari a `true` answer is not a guarantee against the 7-day cap [5].
5. Make export a first-class, cheap, obvious operation: a single "Save backup" that writes a file via a saved handle when available (Chromium) or a download otherwise, plus a "Copy share link" and a "Share" button (D). Keep a "last exported" timestamp and warn when unexported changes are older than a threshold.
6. Add "restore" on every start when the store is empty: detect a wiped store (a sentinel record written at first run, missing on a later run) and offer to import a backup, instead of silently starting fresh.
7. Serialise writers with Web Locks and notify with BroadcastChannel (E). Design writes as idempotent and append-friendly so a killed tab cannot corrupt state.
8. Measure headroom with `estimate()` and warn on high usage, but do not present its numbers as exact [1][10].

### Per-platform posture

| Platform | Posture |
|---|---|
| Chromium desktop | Best case. Offer "Link a folder/file" (persistent handle, re-request on user gesture), call `persist()`, encourage install (persisted grants for installed apps [14], easier `persist()` grant [6][7]) |
| Chrome/Android and other Chromium mobile | Treat as OPFS/IndexedDB plus download export. Do not rely on pickers (sources disagree [12][17]). Web Share works well for sharing an export file |
| Firefox | OPFS/IndexedDB with `persist()` prompt behind a clear button ("Keep my data on this device") [6]; export by download; no folder linking, no desktop Web Share |
| Safari macOS | Best-effort storage plus 7-day cap unless the user opens the site regularly with interaction or adds it to the Dock [5]. Encourage "Add to Dock" |
| Safari iOS / iPadOS and every iOS browser outside the EU | Highest risk. Assume anything not opened for 7 days of Safari use is gone. Strongly encourage "Add to Home Screen"; iOS 26 opens Home Screen sites as web apps by default [41]. Remember the Home Screen app has a separate store from the Safari tab, so a first-run in Safari followed by install starts empty: provide export in Safari and import in the installed app |
| Any private/incognito window | Assume data disappears when the window closes; detect ephemeral or blocked storage, and warn the user before they create anything |

### What to tell users (short copy)

- "Your data lives only in this browser on this device. We have no copy. Clear your browsing data, switch browser, or (on Safari) leave it unused for a week and it may disappear."
- "Use Save backup to keep a file you control. We will remind you when your last backup is old."
- Safari/iPhone: "Add this app to your Home Screen. Safari removes data from websites you have not used in about a week, but not from apps on the Home Screen."
- Chromium desktop: "Link a folder and we will keep your data as files there. Your browser may ask you to confirm access each time you come back."
- Firefox: "Allow the persistent storage prompt so Firefox does not clear this site's data when your disk is low."
- Sharing: "A share link contains your data; anyone with the link can read it" (if the toolkit encodes state into links, say so).

### Open items I could not settle

- Whether Safari 26/27 changed ITP behaviour for `persist()`-granted origins. The only evidence is a still-open WebKit bug [5]; test on a real iOS device before advertising `persist()` as protective on Safari.
- Chrome Android File System Access support: MDN compat data (132) versus caniuse (not supported) [12][17].
- Whether Firefox's new Windows Web Apps/Taskbar Tabs provide any storage separation or persistence benefit [46].
- The status of `FileSystemObserver` outside origin trial [24][25][26].
- Chrome's incognito quota number (about 5% of disk per web.dev [13] versus a legacy 100 MB figure in secondary sources).
- Some page-level facts here were extracted by an automated summariser from the linked pages; where I quote, the quote is from that extract. Verify load-bearing numbers against the primary page before committing them to product copy.

## REFERENCES

1. MDN. [Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
2. WebKit blog. [Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/).
3. WebKit blog. [Full Third-Party Cookie Blocking and More (ITP 2.x, 7-day cap)](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/).
4. WebKit. [Tracking Prevention in WebKit](https://webkit.org/tracking-prevention/).
5. WebKit Bugzilla. [Bug 209563: Support longterm persistent storage (re: default ITP 7 rolling days of browser use expiry)](https://bugs.webkit.org/show_bug.cgi?id=209563).
6. web.dev. [Persistent storage](https://web.dev/articles/persistent-storage).
7. blink-dev. [Intent to Ship: Durable (persistent) storage](https://groups.google.com/a/chromium.org/g/blink-dev/c/nAM3o4NSMsI/m/3gRKsOuYBgAJ).
8. desgrange.net. [How to ask for persistent storage permission in Google Chrome (2025-10-06)](https://blog.desgrange.net/post/2025/10/06/how-persistent-storage-permission-chrome.html).
9. MDN. [StorageManager: persist()](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).
10. WHATWG. [Storage Standard](https://storage.spec.whatwg.org/).
11. Chrome for Developers. [Not all storage is created equal: introducing Storage Buckets](https://developer.chrome.com/docs/web-platform/storage-buckets).
12. MDN browser-compat-data (queried 2026-09-29 for Window.showOpenFilePicker and siblings, StorageManager, FileSystemHandle, FileSystemFileHandle, FileSystemSyncAccessHandle, FileSystemObserver, StorageBucketManager, Navigator.share/canShare/locks, Clipboard, ClipboardItem, BroadcastChannel, LockManager, StorageEvent): [mdn/browser-compat-data](https://github.com/mdn/browser-compat-data/tree/main/api).
13. web.dev. [Storage for the web](https://web.dev/articles/storage-for-the-web) (last updated 2024-09-23; Safari figures predate Safari 17).
14. Chrome for Developers. [Persistent permissions for the File System Access API](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api).
15. Chrome for Developers. [The File System Access API: simplifying access to local files](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).
16. MDN. [Window: showOpenFilePicker()](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker).
17. Can I use. [File System Access API](https://caniuse.com/native-filesystem-api).
18. Mozilla. [standards-positions #154: File System Access (negative)](https://github.com/mozilla/standards-positions/issues/154).
19. WebKit. [standards-positions #28: File System Access (oppose)](https://github.com/WebKit/standards-positions/issues/28).
20. Chrome for Developers. [Reading and writing files and directories with the browser-fs-access library](https://developer.chrome.com/docs/capabilities/browser-fs-access).
21. GoogleChromeLabs. [browser-fs-access](https://github.com/GoogleChromeLabs/browser-fs-access) (Apache-2.0); npm registry [browser-fs-access](https://www.npmjs.com/package/browser-fs-access).
22. jimmywarting. [native-file-system-adapter](https://github.com/jimmywarting/native-file-system-adapter) (MIT); npm [native-file-system-adapter](https://www.npmjs.com/package/native-file-system-adapter).
23. eligrey. [FileSaver.js](https://github.com/eligrey/FileSaver.js); npm [file-saver](https://www.npmjs.com/package/file-saver).
24. Chrome for Developers. [The File System Observer API origin trial](https://developer.chrome.com/blog/file-system-observer).
25. Chrome for Developers. [Chrome 133 release notes](https://developer.chrome.com/release-notes/133).
26. MDN. [FileSystemObserver](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemObserver).
27. MDN. [Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system).
28. web.dev. [The origin private file system](https://web.dev/articles/origin-private-file-system).
29. SQLite. [SQLite Wasm: persistence options](https://sqlite.org/wasm/doc/trunk/persistence.md); npm [@sqlite.org/sqlite-wasm](https://www.npmjs.com/package/@sqlite.org/sqlite-wasm).
30. PGlite. [Filesystems](https://pglite.dev/docs/filesystems); npm [@electric-sql/pglite](https://www.npmjs.com/package/@electric-sql/pglite).
31. rhashimoto. [wa-sqlite](https://github.com/rhashimoto/wa-sqlite).
32. MDN. [StorageManager: getDirectory()](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/getDirectory).
33. MDN. [Navigator: share()](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share).
34. web.dev. [Share content with other apps (Web Share)](https://web.dev/articles/web-share).
35. Can I use. [Web Share API](https://caniuse.com/web-share).
36. MDN. [Clipboard API: security considerations](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API).
37. MDN. [Clipboard: writeText()](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText).
38. MDN. [Broadcast Channel API](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API).
39. MDN. [Window: storage event](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event).
40. MDN. [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).
41. WebKit blog. [Beta testing web apps in Safari 26](https://webkit.org/blog/16993/beta-testing-web-apps-in-safari-26/).
42. WebKit blog. [WebKit Features for Safari 27.0](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/) (released 2026-09-17).
43. WebKit blog. [WebKit Features for Safari 26.4](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/).
44. WebKit Bugzilla. [Bug 266559: Safari periodically erasing LocalStorage and IndexedDB for all websites](https://bugs.webkit.org/show_bug.cgi?id=266559).
45. Steiner, T. [So, what exactly did Apple break in the EU?](https://blog.tomayac.com/2024/02/28/so-what-exactly-did-apple-break-in-the-eu/) (secondary source; also used for the ITP-in-WKWebView statement).
46. Firefox Source Docs. [Web Apps in Firefox (Taskbar Tabs)](https://firefox-source-docs.mozilla.org/browser/components/taskbartabs/docs/index.html); gHacks. [Firefox supports Progressive Web Apps on Windows](https://www.ghacks.net/2025/08/22/experimental-firefox-now-supports-progressive-web-apps-on-windows/).
47. Chromium issue tracker. [PWA could have a standalone/dedicated storage (40733514)](https://issues.chromium.org/issues/40733514) (content not retrievable; listed as evidence that the request exists, not for its contents).
48. Progressier / assorted PWA guides via search (secondary): [Cookies PWA Demo](https://progressier.com/pwa-capabilities/cookies-demo); iOS separate-container statements also in [PWA iOS Limitations and Safari Support 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide).
49. web.dev. [Assets and data (PWA learn course)](https://web.dev/learn/pwa/assets-and-data); WebAPK statement is from a secondary search summary.
50. Mozilla Bugzilla. [Bug 1639542: Support IndexedDB in Private Browsing Mode](https://bugzilla.mozilla.org/show_bug.cgi?id=1639542); [Bug 781982](https://bugzilla.mozilla.org/show_bug.cgi?id=781982).
51. Mozilla Add-ons. [File System Access (Firefox extension polyfill)](https://addons.mozilla.org/en-US/firefox/addon/file-system-access/).
