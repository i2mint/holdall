# Durability and install: research extract (state as of 2026-09-29)

Focused extract of the holdall research on browser storage durability and install UX. Claims are cited [n]; items marked **[unverified]** rest on secondary or community sources. No browser tests were run; re-verify Apple behaviour on a real device before promising anything.

## 1. Storage modes and eviction

The Storage Standard defines "best-effort" buckets (default; the browser may clear them without asking under storage pressure) and "persistent" buckets (established only with permission; not cleared without user involvement) [9]. MDN describes the result as LRU by origin: the least recently used origin is deleted first, persistent origins are skipped [1].

Eviction is all-or-nothing per origin: IndexedDB, Cache API and the rest of the origin's data are deleted together [1]. "Clear site data" removes the whole origin's storage including service worker registrations, and OPFS is deleted too [9]. `persist()` does not defend against this: MDN says persisted storage "will not be cleared except by explicit user action" [8], and clearing site data is that action.

`navigator.storage.estimate()` returns `usage` and `quota`. Quotas are deliberately fuzzy (fingerprinting) and Chrome computes them from total disk size, not free space [1][9]. Use it for "nearly full" warnings only.

Things that can still lose data when everything is done right: users clearing site data, OS "free up space" tools, cleaner or antivirus software, profile deletion, browser reinstall, private windows, and engine bugs [1]. Example of the last: Safari 17.2 periodically erased localStorage and IndexedDB for all sites while Web Inspector was open, fixed in Safari 17.4.

## 2. Per-engine table

| Aspect | Chromium (Chrome, Edge, Samsung, Opera) | Firefox | Safari / WebKit (macOS, iOS, iPadOS) |
|---|---|---|---|
| Default mode | Best-effort [1] | Best-effort [1] | Best-effort [2] |
| Per-origin quota, best-effort | Up to 60% of disk [1] | Smaller of 10% of disk or 10 GiB per eTLD+1 group [1] | About 60% of disk for browser apps since macOS 14 / iOS 17 [1][2] |
| `persist()` decided by | Silent heuristic: site engagement, bookmarked, installed, notifications granted; otherwise denied [6][7] | Permission prompt, only after a user-gesture call [6] | Silent; "heuristics like whether the website is opened as a Home Screen Web App" [2] |
| Persisted origin deleted by the browser? | No, except by explicit user action [8] | No, except by explicit user action [8] | Protected from LRU pressure [2]. ITP 7-day: reported NOT protected (WebKit bug 209563, still open as of 2025-07) [5] |
| Time-based deletion | None | None | Yes: ITP deletes script-writable storage after 7 days of Safari use without user interaction with the site [3][4] |
| Effect of installing | Improves the odds of a `persist()` grant; the installed app shares the tab's storage [6][7] | Windows "web apps" (taskbar tabs, Firefox 143+) are experimental; no documented storage effect [16] | Home Screen (iOS/iPadOS) and Dock (macOS 14+) apps: own container, own days-of-use counter, exempt from the 7-day deletion [2][3][4][5] |
| Private browsing | Lower quota, deleted when the last window closes [1] | IndexedDB works, ephemeral [1] | Ephemeral; OPFS `getDirectory()` may throw |

The 7-day counter counts days of Safari use, not calendar days, and only user interaction resets it: "a user click, tap, or keyboard entry... Scrolling is not considered user interaction" [4]. Covered storage: IndexedDB, localStorage, sessionStorage, media keys, service worker registrations and cache [3][4].

On iOS outside the EU all browsers use WebKit, so Chrome and Firefox on iOS should inherit the cap (my inference; not stated in one place).

Chrome's grant heuristic cannot be forced: an app can call `persist()` repeatedly at meaningful moments (after saving, after install) and record the answer; requests can be repeated and are re-evaluated [6]. A 2025 hands-on test found bookmarking and installing alone did not reliably yield a grant.

## 3. Where install helps and where it moves data

- Chromium: the installed app shares cookies, IndexedDB and caches with the browser profile's tab; clearing browser data affects both. Installation is one input to the silent `persist()` heuristic [6][7].
- iOS/iPadOS Home Screen web app: isolated storage container. Safari-tab localStorage and IndexedDB are not visible in the installed app **[unverified: community sources]**. It has its own days-of-use counter and WebKit says the first-party data of such a web app is not expected to be deleted by the 7-day rule [3][4].
- macOS Safari "Add to Dock": cookies are copied at install time; nothing else is shared afterwards [17].
- Since iOS 26 every site added to the Home Screen opens as a web app by default (an "Open as Web App" toggle in the dialog); a manifest is optional [13][14].
- The same PWA installed through two different browsers gets two separate instances with no shared data [26].
- Consequence: on Apple platforms the install boundary is a data boundary. Offer a file or link backup before instructing the user to install, and an import on first launch of the installed app. The installed app also does not receive the URL fragment of the page it was installed from (observed in a production app we studied).

## 4. Installability and per-platform flows

| Platform | How the user installs | `beforeinstallprompt` |
|---|---|---|
| Chrome / Edge desktop | Omnibox install icon or menu "Install ..." | Yes [15] |
| Chrome Android | Menu "Install app" / "Add to Home screen" (WebAPK) | Yes [15] |
| Samsung Internet | Toolbar install icon; can fail silently if the manifest has a POST `share_target` | Yes |
| Other Android browsers | Menu; browser-badged shortcut | No |
| Safari macOS 14+ | File > Add to Dock (any site; manifest optional) [17] | No [28] |
| Safari iOS/iPadOS | Share > Add to Home Screen; iOS 16.4+ also from Chrome/Edge/Firefox share menus [15] | No |
| Firefox desktop | Windows 143+ only: "Add tab to taskbar" (taskbar tabs); none on macOS/Linux [16] | No |
| In-app browsers | Cannot install | No |

Chromium criteria: `name` or `short_name`, 192 px and 512 px icons, `start_url`, `display` standalone/fullscreen/minimal-ui/window-controls-overlay, no `prefer_related_applications` [12][15]. A service worker with a `fetch` handler is no longer needed for menu install (mobile 108, desktop 112), but Chrome's own blog says the algorithm behind the automatic prompt "still requires the presence of a fetch() handler" [11]. Chrome also wants user engagement before firing the event [12]. No event fires when the app is already installed.

Detecting standalone: `matchMedia('(display-mode: standalone)')` (also `fullscreen`, `minimal-ui`, `window-controls-overlay`), `navigator.standalone === true` on iOS, and `appinstalled` on Chromium [27]. A 2023 report said macOS Dock apps did not report `display-mode: standalone` **[unverified for 2026]**; combine both signals.

Web Install API: `navigator.install()` and the `<install>` element let a page trigger the browser's install UI, with a user gesture. The Intent to Ship (2026-09-21) targets Chrome 156 on desktop first, Android deferred; Mozilla has no signal and WebKit opposes site-initiated installation [24][25]. Treat it as progressive enhancement.

## 5. UX rules from the research

Never show install UI when already standalone; show it after a value moment, not on page load; one dismissal remembered with a timestamp (re-ask after a configurable interval); one primary action per platform; explain the benefit in one line and be honest about durability; avoid the word "PWA" in copy. Step text for iOS varies by version and browser, so verify before shipping **[unverified]**.

## 6. Manifest and service worker on a subpath

1. Vite `base: '/app-a/'`. vite-plugin-pwa derives `start_url` and `scope` from the base [21]. Scope matching is prefix-based, so end it with `/` [19].
2. Set an explicit manifest `id`. It resolves against the ORIGIN of `start_url`; an absent id defaults to `start_url` [18]. Use a root-relative stable id such as `/app-a/` and never change it.
3. A service worker's maximum scope is its own directory unless the server sends `Service-Worker-Allowed` [20]. Do not send it on a shared origin.
4. Never register a service worker or manifest with scope `/` on the shared origin's landing page unless it should control every app. Workbox 7 `cleanupOutdatedCaches` deletes caches whose name contains `-precache-` and the registration scope, so a root-scoped worker can delete siblings' precaches; sibling subpaths are safe because the default cache name suffix is the scope [22].
5. Icon `src` values resolve against the manifest URL; root-relative paths hit the wrong place, and config icons not prefixed with `base` are a known plugin issue [23].
6. `navigateFallback` must be under the base (`/app-a/index.html`); the server must serve `index.html` for deep links; do not cache the manifest or `sw.js` forever.
7. Register with the same base; test on a production build.
8. Changing `id` or `scope` after users install creates a second app identity that keeps working but never updates.

## 7. Several apps on one origin

They share localStorage, IndexedDB, Cache API, OPFS, cookies, quota and eviction, permissions, and "Clear site data" wipes all of them [10]. Google ranks separate origins (subdomains) first, path-separated same-origin apps "not recommended", nested scopes strongly not recommended [10]. Mitigations: namespace every key and database per app; never enumerate or clear an entire origin (delete only your own database); warn in the reset UI; treat `persist()` and `estimate()` as origin-level ("site storage"); keep the landing page free of an overlapping manifest or service worker; if isolation matters, move each app to its own subdomain (data does not migrate across origins, so plan an export and import).

## 8. Libraries (checked 2026-09-29)

| Package | Version | License | Note |
|---|---|---|---|
| [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) | 1.3.0 | MIT | manifest, service worker (generateSW or injectManifest), register script; de-facto Vite choice [21] |
| [workbox-build / workbox-window](https://github.com/GoogleChrome/workbox) | 7.4.1 | MIT | cache names include the SW scope [22] |
| [@vite-pwa/assets-generator](https://github.com/vite-pwa/assets-generator) | 2.0.0 | MIT | icon set from one SVG |
| [@khmyznikov/pwa-install](https://github.com/khmyznikov/pwa-install) | 0.7.0 | MIT | `<pwa-install>` web component: Chromium dialog, iOS/macOS instructions, in-app-browser detection, about 40 locales, Web Install API support; peers `lit`, `@lit/react` [25] |
| [pwa-install-handler](https://github.com/FilipChalupa/pwa-install-handler) | 2.6.5 | ISC | tiny typed `beforeinstallprompt` wrapper; Chromium only |
| `@pwabuilder/pwainstall`, `pwacompat` | 2020 | ISC / Apache-2.0 | unmaintained; avoid |

## REFERENCES

1. MDN. [Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
2. WebKit blog. [Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/).
3. WebKit blog. [Full Third-Party Cookie Blocking and More (7-day cap)](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/).
4. WebKit. [Tracking Prevention in WebKit](https://webkit.org/tracking-prevention/).
5. WebKit Bugzilla. [Bug 209563: Support longterm persistent storage (ITP 7-day expiry)](https://bugs.webkit.org/show_bug.cgi?id=209563).
6. web.dev. [Persistent storage](https://web.dev/articles/persistent-storage).
7. blink-dev. [Intent to Ship: Durable (persistent) storage](https://groups.google.com/a/chromium.org/g/blink-dev/c/nAM3o4NSMsI/m/3gRKsOuYBgAJ).
8. MDN. [StorageManager: persist()](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).
9. WHATWG. [Storage Standard](https://storage.spec.whatwg.org/).
10. web.dev. [Build multiple Progressive Web Apps on the same domain](https://web.dev/articles/building-multiple-pwas-on-the-same-domain).
11. Chrome for Developers. [Revisiting Chrome's installability criteria](https://developer.chrome.com/blog/update-install-criteria).
12. web.dev. [Installation criteria for Chrome](https://web.dev/articles/install-criteria).
13. WebKit blog. [News from WWDC25: Web technology coming this fall in Safari 26 beta](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/).
14. heise online. [iOS 26 and iPadOS 26: Changed web app behaviour on the home screen](https://www.heise.de/en/news/iOS-26-and-iPadOS-26-Changed-web-app-behaviour-on-the-home-screen-10749652.html).
15. MDN. [Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
16. Firefox Source Docs. [Web Apps in Firefox (Taskbar Tabs)](https://firefox-source-docs.mozilla.org/browser/components/taskbartabs/docs/index.html).
17. WebKit blog. [WebKit Features in Safari 17.0 (web apps on Mac, Add to Dock)](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/).
18. MDN. [Manifest id](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id).
19. MDN. [Manifest scope](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope).
20. MDN. [ServiceWorkerContainer.register() (scope and Service-Worker-Allowed)](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register).
21. [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa); [src/options.ts (scope and start_url defaults)](https://github.com/vite-pwa/vite-plugin-pwa/blob/main/src/options.ts).
22. [Workbox v7 source: cacheNames.ts and deleteOutdatedCaches.ts](https://github.com/GoogleChrome/workbox/tree/v7/packages).
23. [vite-plugin-pwa issue 713: manifest icons do not follow "base" path](https://github.com/vite-pwa/vite-plugin-pwa/issues/713).
24. blink-dev. [Intent to Ship: Web Install API (2026-09-21)](http://www.mail-archive.com/blink-dev@chromium.org/msg17503.html).
25. [khmyznikov/pwa-install README](https://github.com/khmyznikov/pwa-install).
26. MDN. [Installing and uninstalling web apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing).
27. web.dev. [Detection (Learn PWA)](https://web.dev/learn/pwa/detection).
28. WebKit Bugzilla. [Bug 193959: BeforeInstallPrompt (WONTFIX)](https://bugs.webkit.org/show_bug.cgi?id=193959).
