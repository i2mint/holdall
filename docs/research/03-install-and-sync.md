# PWA install UX, storage durability, and sync seams (research, 2026-09-29)

Scope: (A) how "Install app" works per platform today, how to detect and message it, which libraries to use, and the gotchas of serving several PWAs under sub-paths of one origin; (B) sync/CRDT engines as a later seam, and the minimal interface a local store should expose now so one can be plugged in later.

Method: primary sources (Chrome/WebKit/MDN/Mozilla docs, blink-dev Intent to Ship, source code on GitHub) plus the npm registry and GitHub API for version, license and last-release facts (queried 2026-09-29). Items I could not verify from a primary source are marked **[unverified]**.

## 0. Summary of what matters for the toolkit

1. Chromium (Chrome, Edge, Samsung Internet) is the only family with a real one-click flow. It offers `beforeinstallprompt` today, and the new Web Install API (`navigator.install()` and an `<install>` element) is being shipped to desktop Chrome, targeted at milestone 156 per the Intent to Ship dated 2026-09-21, so it is not stable yet [1][2][3][4].
2. A service worker with a `fetch` handler is no longer needed to install from the browser menu (Chrome mobile 108+, desktop 112+), but Chrome's own blog says the algorithm that shows the automatic install prompt "still requires the presence of a fetch() handler" [1]. Ship a small service worker anyway (vite-plugin-pwa does this for free) so that both paths work.
3. Safari never fires `beforeinstallprompt` (WebKit closed the request as WONTFIX; a search summary also mentioned a May 2026 "oppose" standards position, which I could not open directly [unverified]) [5][6]. On iOS/iPadOS and macOS Safari 17+, installation is always user-initiated via the Share sheet or File > Add to Dock, so we can only show instructions. Since iOS 26 every site added to the Home Screen opens as a web app by default, with an "Open as Web App" toggle in the dialog [7][8].
4. Firefox desktop still has no manifest-based PWA install. Firefox 143+ on Windows has "web apps" (taskbar tabs); it is not available on macOS or Linux [9][10].
5. Installing does not always make storage more durable, and on Apple platforms it changes WHICH storage you see. Chromium: the installed app shares the browser profile's storage with the tab, and being installed is one input to the silent `persist()` heuristic [11][12][13]. Safari on iOS: the Home Screen app gets an isolated storage container (starts empty; Safari-tab data is not carried over); macOS "Add to Dock" copies only cookies [14][15]. On the plus side, Home Screen web apps are exempt from Safari's 7-day script-writable-storage eviction [16]. So "Install" must be paired with `navigator.storage.persist()` and with an export/import (or share-link) path for data created before installing.
6. Several PWAs under `apps.example.com/<name>/` share ONE origin, hence one storage bucket, one permission set, one quota, and "uninstall + clear data" for one app wipes all of them [17]. Google's own guidance ranks separate origins (subdomains) first and path-separated same-origin second ("not recommended") [17]. Mitigations are in section A9.
7. For sync: do not pick an engine now. Make the local store expose (a) stable ids, (b) per-record `updatedAt` plus a monotonically increasing local sequence number, (c) tombstones instead of hard deletes, (d) an ordered change feed, (e) a device/replica id, and (f) an opaque key/value blob view. That is enough to plug in any of Yjs, Automerge, Loro, TinyBase, PowerSync, Electric, Zero, Dexie Cloud, Evolu, etc. later (section B4).

## A. PWA install, per platform (2026)

### A1. Installability criteria

| Criterion | Chromium (Chrome, Edge, Samsung Internet) | Safari | Firefox |
|---|---|---|---|
| Secure context | HTTPS, or localhost/127.0.0.1 [18] | HTTPS for service workers and push; any page can be added [7][19] | n/a (no manifest install) [18] |
| Manifest members | `name` or `short_name`; `icons` (192 px and 512 px); `start_url`; `display` (or `display_override`) of standalone, fullscreen, minimal-ui or window-controls-overlay; `prefer_related_applications` absent or false [18][20] | None required: since iOS 26 / Safari 17 any site can be added, a manifest only enriches it (name, icon, display, theme, start URL) [7][8][19] | Not applicable on desktop/Android via manifest [18] |
| Service worker | Not required for menu/omnibox install since mobile 108 / desktop 112; the automatic prompt algorithm "still requires the presence of a fetch() handler" (Chrome blog) [1]. The 2024 web.dev criteria page does not mention it either way [20]. | Optional [8] | n/a |
| Engagement | Chrome's `beforeinstallprompt` also wants the user to have interacted with the page (a click/tap and about 30 seconds) [20] | none | n/a |
| Already installed | No event fires if already installed [21] | n/a | n/a |

Practical reading: ship `name`, `short_name`, `id`, `start_url`, `scope`, `display: standalone`, 192/512 PNG icons plus a maskable icon, `theme_color`, `background_color`, plus a service worker with a fetch handler (Workbox precache gives you one). Optional `description` and `screenshots` enrich the Android install sheet [18].

### A2. Per-platform matrix

| Platform | How the user installs | `beforeinstallprompt` | What we can do in-page |
|---|---|---|---|
| Chrome desktop (Win/Mac/Linux/ChromeOS) | Omnibox install icon or menu > "Install <app>"; also "Create shortcut > Open as window" (shortcut only, not a full PWA) | Yes [18] | One-click: keep the event, call `prompt()` from a click. Web Install API arriving (see A3) |
| Edge desktop | Omnibox "App available" icon or Apps > Install this site as an app | Yes | Same as Chrome. Edge ships the Web Install API trial in parallel [22] |
| Chrome Android (with Google Mobile Services) | Menu > "Install app" / "Add to Home screen"; installs as a WebAPK (real launcher entry) [18] | Yes | One-click via `prompt()` |
| Samsung Internet (Samsung devices) | Install icon in the toolbar / "Install on your Apps screen"; also a WebAPK [18][23] | Yes; can fail silently if the manifest has `share_target` with `method: POST` [23]. 2026 issue: its minting server produces WebAPKs with an old `targetSdkVersion`, so Android 14+ shows an "app targets older Android version" warning [24] | One-click, but expect occasional friction |
| Other Android browsers (Firefox, Opera, ...) | Menu > Install / Add to Home screen; browser-badged shortcut, not WebAPK [18] | No [23] | Show instructions |
| Safari macOS 14 Sonoma+ (Safari 17+) | File > Add to Dock (any site; manifest optional); the Mac web app gets its own Dock icon and window [19] | No [5] | Show instructions |
| Safari iOS/iPadOS | Share > Add to Home Screen; iOS 26+: dialog has "Open as Web App" toggle, ON by default [7][8]. iOS 16.4+ also allows Chrome, Edge, Firefox and Orion to add to the Home Screen through their own share menus [18] | No [5][6] | Show instructions; detect browser to pick wording |
| Firefox desktop | Windows only: Firefox 143+ "web apps" (taskbar tabs), address-bar "Add tab to taskbar" button; `browser.taskbarTabs.enabled` pref; not on macOS, Linux off by default [9][10]. Third-party extension "PWAs for Firefox" otherwise [18] | No | Say "not supported here" plus fallback advice |
| In-app browsers (Instagram, Telegram, etc.) | Cannot install | No | Detect and say "open in your browser first" (pwa-install does this [25]) |

Notes:

- iOS 26: Apple's WWDC25 post says every site added to the Home Screen opens as a web app by default, the manifest becomes optional, and service workers are not needed for a basic web app [8]. Commentators note web apps still lack macOS-level customisation (icons, theme colours, scopes) [26]. I found no primary source describing anything newer for iOS 27 / Safari 27; the pwa-install changelog mentions "iOS/iPadOS/macOS 27+" styling support, so those OSes exist in beta or release, but I could not verify behaviour changes **[unverified]**.
- iOS EU: Apple announced removal of Home Screen web apps for the EU in iOS 17.4 and reversed the decision on 2024-03-01; the feature stayed WebKit-based [27].
- Firefox: Mozilla shipped its earlier prototype nowhere; the 2025 work is branded "web apps"/"taskbar tabs" rather than PWAs. A March 2026 Firefox leadership comment says they are taking a "fresh look" at PWAs; no committed macOS/Linux plan found [10][28].

### A3. New in late 2026: Web Install API and the `<install>` element

`navigator.install()` lets a page trigger the browser's own install UI, for the current app (no arguments) or a cross-origin app (manifest URL plus computed app id). It needs a user gesture, and the browser shows its own consent UI [2][3][22]. The declarative counterpart is `<install></install>`, where the browser renders a trusted button with no JavaScript (origin trial in Chrome/Edge 148-153) [4]. The Intent to Ship (dated 2026-09-21) targets Chrome 156 on desktop first (Windows, Mac, Linux, ChromeOS); Android is deferred; the W3C TAG review is still open; Mozilla has "no signal" and WebKit opposes site-initiated installation ("installation [is] a user decision whose flow should begin in browser UI") [3]. The pwa-install web component's 0.7.0 release notes say "Chromium 155+" [29], so the exact milestone is a moving target. Design consequence: treat it as progressive enhancement; keep `beforeinstallprompt` as the baseline and Safari/Firefox as instructions-only.

### A4. Detecting installed and standalone state

| Signal | Works where | Caveat |
|---|---|---|
| `matchMedia('(display-mode: standalone)')`, also `fullscreen`, `minimal-ui`, `window-controls-overlay` | Chromium, Firefox (windowed), Safari | Must match the manifest's `display`; web.dev's helper also checks `document.referrer.startsWith('android-app://')` for TWA [30] |
| `navigator.standalone === true` | iOS Safari (legacy, non-standard) | Also worth checking on macOS Dock apps. A 2023 Sonoma-beta report said Dock apps did not report `display-mode: standalone` [31]; I did not find confirmation for current releases, so combine both signals **[unverified for 2026]** |
| `appinstalled` window event | Chromium only [30] | Fires on install by any mechanism; not on Safari |
| `navigator.getInstalledRelatedApps()` | Chromium; desktop support in Chrome 140+ [32] | Top-level secure context only; needs a self-referencing `related_applications` entry `{platform: "webapp", url: <manifest url>, id: <manifest id>}`; from a tab it tells you whether the PWA is installed [32][33]. Not Baseline; always empty on iOS [25] |
| `beforeinstallprompt` never firing | Chromium | Also means already installed, or criteria unmet, or unsupported [21] |

Recommended detector (single function, returns one of `standalone | browser | unknown` plus `platform` hint): standalone if any display-mode query matches or `navigator.standalone` is true; else browser. Use `getInstalledRelatedApps()` only to hide the install button when the user is in a tab but the app is already installed.

### A5. What "install" does to storage durability (relevant to why we want the button)

| Fact | Source |
|---|---|
| Default ("best-effort") storage can be evicted under storage pressure, LRU, and the whole origin is evicted at once (IndexedDB, Cache API, OPFS together) | MDN [11] |
| `navigator.storage.persist()`: Chrome/Edge decide silently by heuristic (site engagement, installed or bookmarked, notification permission granted); Firefox shows a permission prompt; Safari 15.2+ supports it | web.dev, MDN [11][12] |
| WebKit grants `persist()` "based on heuristics like whether the website is opened as a Home Screen Web App" | WebKit [15] |
| Safari (tab) deletes all script-writable storage after 7 days of Safari use without user interaction with the site; Home Screen web apps have their own counter and "we do not expect the first-party in such a web application to have its website data deleted" | WebKit [16] |
| Chrome PWAs do not have separate storage (desktop or Android): tab and installed app share cookies, IndexedDB and caches. Clearing browser data affects both | Chromium/web.dev [13][17] |
| iOS Home Screen web apps get an isolated storage container: Safari-tab localStorage/IndexedDB are not visible in the installed app; service worker registration and Cache Storage are described as shared **[unverified: community sources only]** | web.dev detection page, community write-ups [30][14] |
| macOS Safari "Add to Dock": cookies are copied at install time, nothing else is shared afterwards | WebKit [19] |
| Safari quotas (macOS 14/iOS 17+): about 60% of disk per origin for browser apps, Home Screen/Dock apps get the same as a browser app, 15% for embedded WebViews | WebKit [15] |
| The same PWA installed via two different browsers gets two separate instances with no shared data | MDN [34] |

Implications:

- On Chromium, installing improves the odds that `persist()` is granted, but it is a heuristic, not a promise. Always call `persist()` (after a meaningful user action, ideally the install click or first save), then read `persisted()` and show the result in the UI.
- On iOS the install boundary is a data boundary. Offer "Export backup" (file or share link) before instructing the user to Add to Home Screen, and "Import" on first launch in standalone mode. Do not tell iOS users "your data will be kept".
- On Safari-in-tab (not installed), user data can vanish after 7 idle days; that is the strongest argument for the install nudge on iOS/macOS Safari.
- Cheap cross-cutting defence: a File System Access / download-based backup path. Out of scope here, not researched.

### A6. Recommended UX and copy

Principles: never show install UI when already standalone; show it only after a value moment (for instance after the first saved item), not on page load; one dismissal per install-state, remembered in `localStorage` with a timestamp (re-ask after roughly 30-90 days, configurable, no magic number in code); one primary action per platform; explain the benefit in one line and be honest about durability.

Decision table (the toolkit's `installAdvice()` should return `{kind, steps?, copy}` so any UI, CLI or agent can render it):

| State | UI | Copy (English; localise later) |
|---|---|---|
| Standalone | No banner. In settings show status "Installed" and "Storage: protected / not protected" | "Installed. Your data is stored on this device." |
| Chromium, `beforeinstallprompt` captured (or `navigator.install` available) | Button "Install app" (one click, calls `prompt()` or `install()`; then `persist()`) | Button: "Install {App}". Helper: "Opens in its own window, works offline, and helps your browser keep your data." |
| Chromium, no event (not yet eligible, or already installed) | Small link "How to install" with menu path | "In Chrome or Edge, open the menu and choose Install {App}." |
| Samsung Internet | As Chromium; if it fails show fallback | "Tap the install icon in the toolbar, or menu > Add page to > Home screen." |
| iOS/iPadOS Safari (also Chrome/Edge/Firefox on iOS 16.4+) | Instruction card with numbered steps and the Share icon; offer "Export backup first" | "1. Tap the Share button (square with arrow). 2. Choose Add to Home Screen. 3. Keep Open as Web App on, then tap Add." Warning: "The Home Screen app starts empty. Export your data first, then import it in the app." |
| macOS Safari 17+ | Instruction card | "In the menu bar choose File > Add to Dock, then Add." |
| Firefox Windows 143+ | Instruction card | "Click the Add tab to taskbar icon in the address bar." |
| Firefox macOS/Linux, other unsupported | No install UI; keep backup nudge | "This browser cannot install apps. Use Export regularly, or open {App} in Chrome, Edge or Safari to install it." |
| In-app browser (Instagram, etc.) | Blocking hint | "Open this page in your browser (Safari/Chrome) to install." |

Notes on wording: on iOS 26+ the exact Share-sheet layout can vary by iOS version and by browser (Safari's toolbar vs. Chrome's menu); keep step text generic and verify screenshots before shipping **[unverified]**. Avoid the word "PWA" in copy.

### A7. Libraries

| Package | Version (npm latest) | Last publish | License | Notes |
|---|---|---|---|---|
| [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) | 1.3.0 | 2026-05-05 | MIT | ~4.3k stars; peer vite `^3.1 ... ^8`; peers `workbox-build`/`workbox-window` `^7.4.1`; generates manifest, service worker (generateSW or injectManifest), register script. Repo last pushed 2026-05-05, still the de-facto Vite choice [35] |
| [workbox-build / workbox-window](https://github.com/GoogleChrome/workbox) | 7.4.1 | 2026-05-04 | MIT | ~13k stars; repo pushed today. Cache names include the SW scope, so sibling apps stay separate [36] |
| [@vite-pwa/assets-generator](https://github.com/vite-pwa/assets-generator) | 2.0.0 | 2026-09-12 | MIT | Generates the icon set (192/512/maskable/apple-touch) from one SVG |
| [@khmyznikov/pwa-install](https://github.com/khmyznikov/pwa-install) | 0.7.0 | 2026-09-14 | MIT | ~950 stars, 7 open issues, actively released. `<pwa-install>` web component (39 kB brotli): Chromium install dialog, iOS/iPadOS/macOS instructions with native look, Android non-Chrome fallback, in-app browser detection, 40 locales, Web Install API support from 0.7.0. Exposes `isUnderStandaloneMode`, `isInstallAvailable`, `isAppleMobilePlatform`, `getInstalledRelatedApps()`, events `pwa-install-success-event` etc. Peers: `lit`, `@lit/react`. Best "batteries included" option [25][29] |
| [pwa-install-handler](https://github.com/FilipChalupa/pwa-install-handler) | 2.6.5 | 2026-02-12 | ISC | Tiny, zero dependencies, typed wrapper over `beforeinstallprompt` (`canInstall`, `install`, `addListener`); 14 stars; Chromium only; no Safari instructions [37] |
| [serwist](https://github.com/serwist/serwist) / `@serwist/vite` | 9.5.12 | 2026-07-22 | MIT | Workbox fork with TypeScript-first API, popular with Next.js; alternative if leaving Workbox |
| `@pwabuilder/pwainstall`, `pwacompat` | 1.6.7 / 2.0.17 | 2020 | ISC / Apache-2.0 | Unmaintained; avoid |

Recommendation: for a headless toolkit, keep our own tiny core (`detectInstallState`, `installAdvice`, `requestInstall`, `ensurePersistence`) with no UI dependency, and offer `@khmyznikov/pwa-install` as an optional UI adapter; vite-plugin-pwa + workbox for the app shells. If we want zero third-party UI, `pwa-install-handler` is a reference for how small the Chromium path is.

### A8. Subpath deployment gotchas (app served under `/app-a/`)

1. Vite `base: '/app-a/'`. vite-plugin-pwa derives `start_url` and `scope` from Vite's base (`scope = options.scope || basePath`, `start_url = basePath`, from `src/options.ts`) [35][38]. Always end scope with `/`: matching is prefix-based, so `scope: "/app-a"` would also match `/app-a-old/` [39].
2. Set an explicit manifest `id`. Per MDN the id is resolved against the ORIGIN of `start_url`, not its path, so a relative `id: "app-a"` becomes `https://apps.example.com/app-a`, and an absent id defaults to `start_url` [40]. Use a root-relative, stable id such as `"/app-a/"`, and never change it (it is the app's identity across updates).
3. Service worker location = maximum scope. A worker at `/app-a/sw.js` gets scope `/app-a/`; it cannot claim `/` unless the server sends `Service-Worker-Allowed: /` [41]. Do not send that header from the shared server, otherwise one app could capture its siblings.
4. Never register a service worker or manifest with scope `/` on `apps.example.com` itself (the landing page) unless you want it to control every app. Two concrete hazards: nested scopes cause link-capture and notification-attribution confusion [17]; and Workbox 7's `cleanupOutdatedCaches` deletes caches whose name contains `-precache-` AND the registration scope, so a root-scoped worker (scope `https://apps.example.com/` is a substring of every sibling's cache name) would delete the siblings' precaches. Sibling `/app-a/` vs `/app-b/` are safe because the default cache name suffix is the scope [36].
5. Icons: relative paths in `manifest.icons[].src` resolve against the manifest URL; root-relative `/icon.png` will hit the wrong place. vite-plugin-pwa issue [#713](https://github.com/vite-pwa/vite-plugin-pwa/issues/713) reports icons defined in the config not being prefixed with `base`; use relative `src` values or the assets generator [42].
6. SPA fallback: `navigateFallback: '/app-a/index.html'` (not `/index.html`); your server must serve `index.html` for deep links under `/app-a/`, and the manifest and `sw.js` must not be cached forever (short cache or `no-cache`).
7. `<link rel="manifest" href="manifest.webmanifest">` relative to the page, and `registerSW` uses the same base; test in production build (`vite preview --base`), not dev.
8. Uninstall/re-install and update: changing `id` or `scope` after users install creates a second app identity; the old one keeps working but never updates.

### A9. Multiple PWAs on one origin (apps.example.com/app-a/, /app-b/)

Yes, they share storage, quota and permissions (one origin), and Google's guidance says so plainly [17]:

| Shared across apps on the same origin | Consequence |
|---|---|
| localStorage, IndexedDB, Cache API, OPFS, cookies | Key collisions possible; one app can read or overwrite another's data (same-origin policy gives no isolation) |
| Storage quota and eviction (the whole origin is evicted together) | One app's large data can push out another's; a persistence grant covers all of them |
| Permissions (notifications, persistent storage...) | One app blocking a permission blocks all |
| "Uninstall and clear data" / "Clear site data" | Wipes ALL apps on the origin [17] |
| Zoom, and (in nested-scope layouts) notification attribution and link capture | See [17] |

Ranking from Google [17]: separate origins (subdomains) recommended; same origin with non-overlapping paths "not recommended"; nested scopes strongly not recommended. Also, installing gives each app its own launcher entry keyed by manifest `id`, so `/app-a/` and `/app-b/` are distinct installed apps as long as their ids and scopes do not overlap [40][39]. A W3C manifest issue describes open ambiguity about path-scoped PWAs vs an origin-level PWA when both are installed [43].

Mitigations for our toolkit (design decisions to make now):

1. Namespace every key and database: `tw:<app>:<store>` for localStorage keys, one IndexedDB database per app named `<app>` (or `tw-<app>`), OPFS directories under `/<app>/`, Cache names via Workbox scope suffix. Put the namespace in a single config seam so it cannot drift.
2. Never enumerate or `clear()` an entire origin: use `indexedDB.deleteDatabase(name)` for own DB only; the "Reset app data" button must delete only the app's namespace.
3. Warn in the reset/uninstall UI: "Removing browser data for this site also removes data for other apps on apps.example.com."
4. Treat `persist()` and `estimate()` as origin-level: show them as "site storage" not "app storage".
5. Longer term, if isolation matters (private data apps), move each app to its own subdomain (`app-a.apps.example.com`); keep the store's location behind config so the move is a config change plus a one-time export/import, since data does not migrate across origins.
6. Do not give the landing page a manifest/service worker that overlaps app scopes (see A8.4).

## B. Sync / CRDT as a later seam

### B1. Local-first principles (the yardstick)

Kleppmann, Wiggins, van Hardenberg and McGranaghan (Ink & Switch, April 2019) list seven ideals: no spinners (work is instant on the local copy), your work is not trapped on one device, the network is optional, seamless collaboration, the long now (data outlives the vendor), security and privacy by default, and you retain ultimate ownership and control [44]. They argue CRDTs are the promising foundation for the collaboration part. For us: local store is primary; sync is an optional replica-to-replica transport; export in an open format must always work; encryption before anything leaves the device.

### B2. Landscape (versions and licenses checked on npm/GitHub 2026-09-29)

| Option | Model | Latest (npm) / last publish | License | Fit as a later seam |
|---|---|---|---|---|
| [Yjs](https://github.com/yjs/yjs) + y-indexeddb + y-webrtc/y-websocket | CRDT for shared docs; providers are composable (`Y.Doc` + persistence provider + network providers) [45] | yjs 13.6.33 (2026-09-23); y-indexeddb 9.0.12 (2023-11); y-webrtc 10.3.0 (2023-12); y-websocket 3.1.0 (2026-08) | MIT (GitHub API shows NOASSERTION; npm says MIT) | Best for rich text/collab docs. y-webrtc needs signaling servers, has an optional room password, and is not suited to many peers [46]. Not ideal for a plain record store |
| [Automerge](https://automerge.org/) + automerge-repo | JSON-like CRDT documents; Repo with pluggable storage/network adapters | automerge 3.5.0 (2026-09-16); automerge-repo stable 2.5.6 (2026-05-18), `latest` npm tag currently points at 2.6.0-alpha.3 | MIT | Storage adapter is a binary key/value interface with array keys and prefix ranges (`load/save/remove/loadRange/removeRange`) [47]; a very good model for our seam. Packages for IndexedDB, WebSocket, MessageChannel, BroadcastChannel [48] |
| [Loro](https://loro.dev/) | CRDT library (Rust, JS via WASM), versioned JSON-like data; 1.0 released | loro-crdt 1.16.3 (2026-09-21) | MIT | Strong candidate for versioned docs; younger ecosystem, bring your own transport/storage [49] |
| [TinyBase](https://tinybase.org/) | Reactive tabular store; `MergeableStore` adds HLC timestamps + hashes so stores merge deterministically (LWW); synchronizers over WebSocket/BroadcastChannel, persisters to local storage | tinybase 10.0.1 (2026-09-24) | MIT | Closest in shape to a "records" store; sync is built in [50] |
| [Replicache](https://replicache.dev/) | Client-side mutation queue + pull/push against your backend | replicache 15.3.0 (2025-07-02) | Was source-available with fees; now open-sourced and free, but in maintenance mode (no new features); users are told to migrate to Zero [51]. Note the npm `license` field still points at a terms URL, so read the repo LICENSE before depending on it | Do not start new work on it |
| [Zero](https://zero.rocicorp.dev/) | Query-driven sync from Postgres (successor to Replicache/Reflect) | @rocicorp/zero 1.9.0 (2026-08-14) | Apache-2.0 | Server-centric (needs zero-cache + Postgres); good if we ever have a real backend [52] |
| [ElectricSQL](https://electric-sql.com/) | Read-path sync from Postgres via HTTP "Shapes"; writes go through your own API; pairs with TanStack DB and PGlite | @electric-sql/client 1.5.28 (2026-09-09) | Apache-2.0 | Postgres-centric; the docs domain now redirects to electric.ax [53] |
| [TanStack DB](https://github.com/TanStack/db) | Client-side collections/live queries that can be backed by Electric, PowerSync, etc. | @tanstack/db 0.9.2 (2026-09-14) | MIT | Pre-1.0 but active |
| [PowerSync](https://www.powersync.com/) | SQLite on the client, syncs from Postgres/MongoDB/MySQL; local writes go into an upload queue (CRUD ops) that your connector's `uploadData` sends to your backend; auto-created text `id` column [54] | @powersync/web 2.4.1 (2026-09-23) | Apache-2.0 (SDKs; service is commercial or self-hosted) | The clearest example of the "ordered local mutation log" a store should expose |
| [Jazz](https://jazz.tools/) | Local-first relational database with row-level permissions and real-time sync (docs now describe it that way) | jazz-tools 0.20.19 (2026-07-03) | MIT | Pre-1.0 and has changed direction; watch, do not adopt |
| [Triplit](https://github.com/aspen-cloud/triplit) | Full-stack sync database | @triplit/client 1.0.50 (2025-07-31); repo last pushed 2026-01 | AGPL-3.0 | Acquired by Supabase 2025-10-08; AGPL is a licensing obstacle for a toolkit [55] |
| [remoteStorage.js](https://remotestorage.io/) | Open protocol (user-owned server, Dropbox/Google Drive backends); local caching and sync | remotestoragejs 2.0.0-beta.10 (2026-08-12) | MIT | Philosophically aligned (user chooses the backend); document-level LWW, slower ecosystem [56] |
| [Evolu](https://www.evolu.dev/) | TypeScript local-first platform on SQLite; end-to-end encrypted sync via self-hosted or cloud relays | @evolu/common 8.12.0 (2026-09-27) | MIT | Interesting for E2EE identity/sync; docs pages I fetched did not state the CRDT details **[unverified]** [57] |
| [Dexie Cloud](https://dexie.org/cloud/) | Dexie (IndexedDB wrapper) + hosted sync service with access control | dexie 4.4.6 / dexie-cloud-addon 4.4.15 (2026-09) | Apache-2.0 (library); the service is SaaS (free tier 3 production users, 100 MB; paid per seat) or paid on-prem (Node + Postgres) [58] | Natural upgrade path if the local store is Dexie/IndexedDB. Requires string primary keys and its own realm/ownership fields |
| [LiveStore](https://livestore.dev/) | Event-sourced SQLite client store with sync providers | @livestore/livestore 0.4.0 (2026-06-02) | Apache-2.0 | Event-sourcing shape matches the change-feed idea; pre-1.0 |

Takeaways: (1) Two shapes exist: document CRDTs (Yjs, Automerge, Loro) which own the data model, and record/mutation-log sync (PowerSync, Electric+TanStack DB, Zero, Dexie Cloud, Replicache, TinyBase) which sit next to a store and need ids, versions and an ordered change feed. A generic local store can support the second shape natively and the first via an opaque-blob column. (2) Licenses to avoid or check: Triplit AGPL; Replicache license terms; Zero/Electric/PowerSync are Apache-2.0 but the hosted services are commercial. (3) Maturity: Yjs, Automerge, Dexie, Electric, PowerSync, TinyBase are actively released in Sept 2026; Jazz, LiveStore and TanStack DB are pre-1.0.

### B3. Encrypted share links (Excalidraw pattern)

Excalidraw generates a random AES-GCM key (128-bit) with the Web Crypto API, encrypts the JSON scene client-side, uploads only the ciphertext, and puts the exported key in the URL fragment (`#...`), which browsers do not send to servers; the server can therefore neither read nor be compelled to disclose the content [59]. Their write-up uses an all-zero 12-byte IV, justified because each key is used for exactly one encryption [59].

Design guidance for our "share" seam:

1. `share(payload) -> {url}`: generate a fresh 256-bit AES-GCM key, a random 12-byte IV per encryption, encrypt, upload `iv || ciphertext` to a blob store keyed by a random id, and return `https://host/app/#/s/<id>&k=<base64url key>`. Prefer a random IV even with single-use keys, so updating a shared blob with the same key stays safe.
2. Everything after `#` is never sent to the server; strip or `replaceState` the fragment after reading it, and set `Referrer-Policy: no-referrer` and no third-party scripts on the receive page (fragments are not sent in Referer, but browser history, extensions and screenshots can leak them).
3. Optionally wrap the key with a password (PBKDF2/Argon2 -> key-wrapping) for a second factor.
4. Add an expiry and delete token on the blob server; the link is a bearer capability, so document that anyone with the link can read it.
5. This is also the natural export/import path for the iOS install boundary (A5): "Move my data to the installed app" can be a share link or file.
6. Read-only sharing is trivial; collaborative editing on top needs a CRDT (Yjs/Automerge/Loro) and per-message IVs, which is out of the share-link v1.

### B4. Minimal interface a local store should expose now

Goal: any of the engines above can be attached later at one seam without changing app code or migrating data. All of it is cheap to add on day one and expensive to retrofit.

Required (v1):

| Capability | Why a sync engine needs it |
|---|---|
| Stable, client-generated, globally unique ids (UUIDv7/ULID or nanoid; never auto-increment, never derived from content that can change) | Every engine (PowerSync id column, Dexie Cloud string keys, Electric primary keys, CRDT map keys) addresses records by id; merges need ids that two devices can create offline without collision [54][58] |
| Per-record `updatedAt` (and `createdAt`), preferably a hybrid logical clock (HLC) string rather than wall-clock time | LWW merging (TinyBase, remoteStorage) breaks on skewed clocks; HLC gives monotonic, mergeable ordering [50] |
| Tombstones: `delete()` marks `deletedAt` (keeps id, updatedAt), with a separate `purge()` for compaction | Without tombstones a deletion cannot propagate; a replica that never saw the delete resurrects the record |
| A monotonically increasing local sequence (`seq`) plus an ordered change feed: `changes(since: seq) -> AsyncIterable<{seq, op: put/delete, id, store, updatedAt, baseVersion?}>` and `subscribe(listener)` | This is what PowerSync's upload queue, Replicache's mutation log, LiveStore's event log and Electric write-back all consume; lets a transport upload "everything since checkpoint" and resume after crash [54] |
| Replica/device id (stable per install, stored in the store metadata) | Needed for HLC tie-breaking, CRDT actor ids (Yjs client id, Automerge actor) and echo suppression |
| Origin tagging of writes: `put(id, value, {origin})` so change events say whether a write is `local` or `remote` | Prevents feedback loops when a sync engine applies remote changes through the same API |
| Atomic batch writes (`transaction`) and one change event per committed transaction | Engines need consistent snapshots and checkpoints |
| Schema/version stamp per store (integer) and per-record `schemaVersion` optional | Lets migrations and sync coexist (expand, migrate, contract) |
| Export/import of the whole store (or a namespace) in an open format (JSON lines with tombstones, plus blobs) | Local-first ideal "long now"; also the iOS install move [44] |
| Namespaced keys (`<app>/<store>/<id>`) | Same-origin isolation (A9) and per-namespace sync scopes |

Nice to have (only if cheap): an opaque `blob`/`bytes` value type (for Yjs/Automerge/Loro snapshots and incremental updates); a key/value byte-array adapter in the style of automerge-repo's `StorageAdapterInterface` (`load(key[])`, `save(key[], bytes)`, `remove(key[])`, `loadRange(prefix[])`, `removeRange(prefix[])`, optional `close()`) [47], so the same backend (IndexedDB, OPFS, file, in-memory) can serve records and CRDT chunks; a `version` (integer or etag) per record for optimistic concurrency with server-authoritative backends; per-record dirty flag or a synced-`seq` checkpoint per remote.

Sketch (TypeScript, illustrative; Python side would mirror it with a `collections.abc.MutableMapping` facade and an event iterator):

```ts
interface Record<T> { id: string; value: T; updatedAt: string /* HLC */; deletedAt?: string; }
interface Change { seq: number; store: string; id: string; op: 'put' | 'delete'; updatedAt: string; origin: 'local' | 'remote'; }
interface SyncableStore {
  get(store: string, id: string): Promise<Record<unknown> | undefined>;
  put(store: string, id: string, value: unknown, opts?: { origin?: 'local' | 'remote'; updatedAt?: string }): Promise<void>;
  delete(store: string, id: string, opts?: { origin?: 'local' | 'remote' }): Promise<void>;   // tombstone
  purge?(olderThan: string): Promise<number>;                                                   // compaction
  transaction<R>(fn: (tx: SyncableStore) => Promise<R>): Promise<R>;
  changes(since: number): AsyncIterable<Change>;                                                // ordered, resumable
  subscribe(fn: (c: Change[]) => void): () => void;
  readonly replicaId: string;
  readonly headSeq: () => Promise<number>;
}
```

How an engine would plug in: a `Replicator` object takes a `SyncableStore` plus a transport: it reads `changes(since=checkpoint)`, pushes them, pulls remote changes and applies them with `origin: 'remote'`, then persists the checkpoint. For CRDT engines the store holds the binary snapshot under one id and the engine emits/consumes updates; for record-sync engines the Replicator maps `Change` to their CRUD/mutation types. Nothing in the app code changes.

### B5. What not to do now

Do not add a sync engine, a server, accounts or CRDT-typed fields in v1. Do not use auto-increment ids, hard deletes, or `Date.now()` as the only ordering. Do not key storage by bare names on the shared origin.

## Recommendations (ordered)

1. Ship a manifest and service worker per app via vite-plugin-pwa (MIT, 1.3.0) with Workbox 7.4.1; set `base`, explicit root-relative manifest `id` (for example `/app-a/`), `scope` ending in `/`, relative icon paths, 192/512/maskable icons, `display: standalone`.
2. Implement a headless `install` module: `detectInstallState()` (display-mode plus `navigator.standalone`, optional `getInstalledRelatedApps`), `captureInstallPrompt()` (early `beforeinstallprompt` listener; later `navigator.install()` when available), `installAdvice()` (returns platform, steps and copy as data per the table in A6), `ensurePersistence()` (calls `navigator.storage.persist()`, then `persisted()` and `estimate()`), and `onInstalled()` (`appinstalled`). UI is an adapter; offer `@khmyznikov/pwa-install` as the default optional UI.
3. Be honest about durability: Chromium install raises `persist()` odds but does not guarantee it; on iOS the installed app is an empty new container, so export/import or share-link migration is mandatory; Safari tabs lose data after 7 idle days while Home Screen apps do not [15][16].
4. Namespace all storage per app on `apps.example.com`, never clear origin-wide, and warn about shared-origin wipes; keep the landing page free of a root-scoped service worker/manifest. Revisit subdomain-per-app if any app holds sensitive data.
5. Progressive enhancement for the Web Install API; do not depend on it before it is stable (target Chrome 156 per Intent to Ship, 155+ per pwa-install; recheck when it lands).
6. Make the local store sync-ready with the B4 table (ids, HLC `updatedAt`, tombstones, `seq` change feed, replica id, origin tagging, export/import, namespaced keys). Model the byte-level backend on automerge-repo's storage adapter interface so CRDT chunks and records can share one backend.
7. For a later sync seam, evaluate in this order for our use case: Yjs or Automerge/Loro if collaborative documents matter; PowerSync/Electric+TanStack DB/Zero if a Postgres backend appears; Dexie Cloud if the store is Dexie; TinyBase if the store is tabular; remoteStorage.js or Evolu for user-owned/E2EE. Avoid Triplit (AGPL) and Replicache (maintenance mode) for new work.
8. Implement encrypted share links (AES-GCM, random IV, key in the fragment, blob server sees only ciphertext) as the first "sharing" surface; it also solves the iOS data-move problem.

## Open questions and uncertainties

- Exact Chrome milestone for the Web Install API (156 per Intent to Ship, 155+ per pwa-install README); Android support is deferred.
- Whether Chrome's automatic install prompt still needs a `fetch` handler in late 2026; Chrome's blog said yes at the time of the criteria change; recheck with a current DevTools/Lighthouse install test.
- iOS 27/Safari 27 web-app changes, and whether macOS Dock web apps now report `display-mode: standalone` reliably.
- iOS shared vs isolated storage details (Cache Storage/service worker sharing) rest on community write-ups, not on WebKit documentation.
- Evolu and Jazz internals (CRDT/encryption specifics) not confirmed from primary docs; Jazz has shifted positioning to a relational database.
- npm `latest` for automerge-repo is an alpha tag; the last stable is 2.5.6.

## REFERENCES

1. [Revisiting Chrome's installability criteria, Chrome for Developers](https://developer.chrome.com/blog/update-install-criteria)
2. [Web Install API is ready for testing, Microsoft Edge Blog (2025-11-24)](https://blogs.windows.com/msedgedev/2025/11/24/the-web-install-api-is-ready-for-testing/)
3. [Intent to Ship: Web Install API, blink-dev (2026-09-21), mail archive](http://www.mail-archive.com/blink-dev@chromium.org/msg17503.html)
4. [Install web apps with the new HTML install element, Chrome for Developers](https://developer.chrome.com/blog/install-element-ot?hl=en)
5. [WebKit bug 255716, BeforeInstallPrompt (resolved duplicate of WONTFIX 193959)](https://bugs.webkit.org/show_bug.cgi?id=255716)
6. [WebKit bug 193959, BeforeInstallPrompt (WONTFIX, 2019), the duplicate target](https://bugs.webkit.org/show_bug.cgi?id=193959)
7. [iOS 26 and iPadOS 26: Changed web app behaviour on the home screen, heise online](https://www.heise.de/en/news/iOS-26-and-iPadOS-26-Changed-web-app-behaviour-on-the-home-screen-10749652.html)
8. [News from WWDC25: Web technology coming this fall in Safari 26 beta, WebKit](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)
9. [Web Apps in Firefox (Taskbar Tabs), Firefox Source Docs](https://firefox-source-docs.mozilla.org/browser/components/taskbartabs/docs/index.html)
10. [Firefox supports Progressive Web Apps on Windows, gHacks (2025-08-22)](https://www.ghacks.net/2025/08/22/experimental-firefox-now-supports-progressive-web-apps-on-windows/)
11. [Storage quotas and eviction criteria, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
12. [Persistent storage, web.dev (updated 2020-05-12)](https://web.dev/articles/persistent-storage)
13. [PWA could have a standalone/dedicated storage, Chromium issue 40733514](https://issues.chromium.org/issues/40733514)
14. [How to share state/data between a PWA in iOS Safari and standalone mode, J. Kozak, Medium](https://jakub-kozak.medium.com/how-to-share-state-data-between-a-pwa-in-ios-safari-and-standalone-mode-64174a48b043)
15. [Updates to Storage Policy, WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/)
16. [Full Third-Party Cookie Blocking and More (7-day cap), WebKit](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)
17. [Build multiple Progressive Web Apps on the same domain, web.dev](https://web.dev/articles/building-multiple-pwas-on-the-same-domain)
18. [Making PWAs installable, MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
19. [WebKit Features in Safari 17.0 (web apps on Mac, Add to Dock)](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/)
20. [Installation criteria for Chrome, web.dev (updated 2024-09-19)](https://web.dev/articles/install-criteria)
21. [Installation prompt, web.dev Learn PWA](https://web.dev/learn/pwa/installation-prompt)
22. [Web Install API explainer, MicrosoftEdge/MSEdgeExplainers](https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/WebInstall/explainer.md)
23. [Installation, What PWA Can Do Today](https://whatpwacando.today/installation/)
24. [Samsung Internet PWA install blocked on Android 14+, SamsungInternet/support issue 123](https://github.com/SamsungInternet/support/issues/123)
25. [khmyznikov/pwa-install README](https://github.com/khmyznikov/pwa-install)
26. [Web Apps in iOS 26, Michael Tsai](https://mjtsai.com/blog/2025/10/03/web-apps-in-ios-26/)
27. [iOS 17.4 won't remove Home Screen web apps in the EU after all, 9to5Mac](https://9to5mac.com/2024/03/01/apple-home-screen-web-apps-ios-17-eu/)
28. [How can Firefox create the best support for web apps on the desktop? Mozilla Connect](https://connect.mozilla.org/t5/discussions/how-can-firefox-create-the-best-support-for-web-apps-on-the/m-p/61153)
29. [pwa-install releases (v0.7.0, 2026-09-14)](https://github.com/khmyznikov/pwa-install/releases)
30. [Detection, web.dev Learn PWA](https://web.dev/learn/pwa/detection)
31. [Web Apps on macOS Sonoma 14 Beta, Blogccasion (T. Steiner)](https://blog.tomayac.com/2023/06/07/web-apps-on-macos-sonoma-14-beta/)
32. [Is your app installed? Get Installed Related Apps API, Chrome for Developers](https://developer.chrome.com/docs/capabilities/get-installed-related-apps)
33. [Navigator: getInstalledRelatedApps(), MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getInstalledRelatedApps)
34. [Installing and uninstalling web apps, MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing)
35. [vite-plugin-pwa (GitHub, npm 1.3.0, MIT)](https://github.com/vite-pwa/vite-plugin-pwa)
36. [Workbox v7 source: cacheNames.ts and deleteOutdatedCaches.ts](https://github.com/GoogleChrome/workbox/tree/v7/packages)
37. [pwa-install-handler README (npm 2.6.5, ISC)](https://github.com/FilipChalupa/pwa-install-handler)
38. [vite-plugin-pwa src/options.ts (scope and start_url defaults)](https://github.com/vite-pwa/vite-plugin-pwa/blob/main/src/options.ts)
39. [Manifest scope, MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope)
40. [Manifest id, MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id)
41. [ServiceWorkerContainer.register(), MDN (scope and Service-Worker-Allowed)](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)
42. [manifest icons do not follow "base" path, vite-plugin-pwa issue 713](https://github.com/vite-pwa/vite-plugin-pwa/issues/713)
43. [multiple pwa on same origin could be conflicting for app scoped to path, w3c/manifest issue 1180](https://github.com/w3c/manifest/issues/1180)
44. [Local-first software: You own your data, in spite of the cloud, Ink & Switch (2019)](https://www.inkandswitch.com/essay/local-first/)
45. [Offline editing and providers, Yjs docs](https://docs.yjs.dev/getting-started/allowing-offline-editing)
46. [y-webrtc README](https://github.com/yjs/y-webrtc)
47. [automerge-repo StorageAdapterInterface.ts](https://github.com/automerge/automerge-repo/blob/main/packages/automerge-repo/src/storage/StorageAdapterInterface.ts)
48. [automerge-repo README (storage and network adapters)](https://github.com/automerge/automerge-repo)
49. [Loro repository and docs](https://github.com/loro-dev/loro)
50. [TinyBase: Using a MergeableStore](https://tinybase.org/guides/synchronization/using-a-mergeablestore/)
51. [Replicache (maintenance mode, open-sourced, free)](https://replicache.dev/)
52. [rocicorp/mono (Zero and Replicache monorepo)](https://github.com/rocicorp/mono)
53. [Electric Sync docs (electric.ax)](https://electric.ax/docs/intro)
54. [PowerSync JavaScript Web SDK: local writes, upload queue and id column](https://docs.powersync.com/client-sdks/reference/javascript-web)
55. [Triplit joins Supabase](https://supabase.com/blog/triplit-joins-supabase)
56. [remoteStorage.js README](https://github.com/remotestorage/remotestorage.js)
57. [Evolu documentation](https://www.evolu.dev/docs)
58. [Dexie Cloud](https://dexie.org/cloud/)
59. [End-to-end encryption in Excalidraw, Excalidraw blog](https://plus.excalidraw.com/blog/end-to-end-encryption)
