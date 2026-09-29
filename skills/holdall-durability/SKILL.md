---
name: holdall-durability
description: >-
  Keep browser-stored data from being silently wiped, and add an honest "Install app" button. Use when asked to "make storage persistent", "call navigator.storage.persist", "Safari deleted my data", "iOS loses localStorage after a week", "data disappears", "storage quota", "eviction", "does Clear site data delete IndexedDB/OPFS", "add an Install button", "make it installable", "add to home screen", "add to dock", "beforeinstallprompt", "PWA", "manifest", "service worker", "vite-plugin-pwa", "Workbox", "install under a subpath", "several apps on one origin", "iOS install starts empty", or "why does Firefox ask for permission". Covers per-engine eviction, ensurePersistence (when to call it), installAdvice/captureInstallPrompt with per-platform copy, manifest and service-worker settings for subpath deployment, and the no-service-worker option.
license: MIT
metadata:
  package: holdall
---

# holdall-durability: keep storage alive, and the install button

Use this when the app keeps data in the browser and you must decide how hard to protect it, or when it needs an install affordance. The short version: browser storage is best-effort and can vanish (idle Safari, "Clear site data", storage pressure); ask for persistence after the first save, offer install advice on the platforms where installing helps, and never claim more than the platform gives. The durable copy is always a file or link the user holds (see `holdall-files`, `holdall-share-links`).

## 1. Eviction, per engine

| Situation | Chromium (Chrome, Edge, Samsung) | Firefox | Safari macOS / iOS / iPadOS |
|---|---|---|---|
| Default mode | best-effort: whole origin evicted LRU under storage pressure | same | same |
| `persist()` | silent heuristic (engagement, installed, bookmarked, notifications); may deny, can be asked again | permission prompt, only after a user gesture | silent; granted by heuristics such as "is a Home Screen web app" |
| Persisted origin evicted under pressure? | no | no | no |
| Time-based deletion | none | none | **yes: 7 days of Safari use without user interaction wipes script-writable storage (IndexedDB, localStorage, sessionStorage, SW registrations and cache)**; an open WebKit bug reports `persist()` does NOT stop it |
| Escape hatch | none needed | none needed | **Home Screen app (iOS/iPadOS) and Dock app (macOS 14+)**: own container, own counter, exempt from the cap |
| Installed app vs tab storage | same storage as the tab | Windows taskbar tab: no documented storage effect | iOS Home Screen app: **separate container, starts empty**; macOS Dock app: only cookies copied |
| Private window | small quota, gone when the window closes | works, ephemeral | ephemeral; OPFS may throw |

- Eviction is all-or-nothing per origin: IndexedDB, Cache API, localStorage, OPFS and SW registrations go together. Partial loss is a bug or a Safari cap, not normal eviction.
- **"Clear site data" wipes everything for the origin, persisted or not, OPFS included.** `persist()` only protects against the browser, never against the user or a cleaner app.
- **Same-origin apps share one bucket:** quota, eviction, permissions and one "Clear site data" wipe all of them (`example.com/a/` and `example.com/b/`). Namespace keys per app and never `clear()` a whole store you did not create.
- On iOS outside the EU every browser runs WebKit, so Chrome or Firefox on iOS inherit Safari's cap (inference, not a documented statement).
- Verify on a real iPhone before promising that `persist()` protects on Safari.

## 2. Ask for persistence

`ensurePersistence({request?, storage?}): Promise<{supported, persisted, usage?, quota?}>`. It never throws (private mode and blocked storage report `persisted: false`). Without `request` it only reads state.

| Strategy | When | Trade-off |
|---|---|---|
| **A. After the first save, from a click** (default) | the user just made something worth keeping; call `ensurePersistence({request: true})` inside that click handler | best odds of a grant in Chromium; **Firefox shows its prompt inside the tab**, so word your button ("Keep my data on this device") and do not call it on load |
| **B. Only when running standalone** | `installAdvice(...).kind === 'installed'` (or `env.standalone`) | no Firefox tab prompt at all, and installed apps are likelier to be granted; but tab users never ask, so they stay best-effort |

Both are valid. Pick A for apps where losing data hurts early; pick B when a surprise permission prompt would hurt the first impression. Either way: re-read `persisted` on every start, re-ask after install (Chromium re-evaluates), and show the answer in settings ("Storage: kept / may be cleared").

`estimate()` is advisory: quotas are fuzzy on purpose and Chrome derives them from total disk. Use `usage/quota` for a "nearly full" warning, not for capacity planning, and never display it as exact.

## 3. Install advice (data, not UI)

```ts
import { captureInstallPrompt, detectInstallEnv, installAdvice, ensurePersistence } from 'holdall';

const prompt = captureInstallPrompt();          // once, at module load, before the UI mounts

export function currentAdvice() {
  return installAdvice(detectInstallEnv(window, { canPrompt: prompt.available() }), { appName: 'My App' });
}

// A React/Svelte/Vue wrapper subscribes so the button appears when the event arrives:
prompt.subscribe(() => rerender());

// Click handler of the install button (must be a user gesture):
export async function onInstallClick() {
  const advice = currentAdvice();
  if (advice.kind === 'prompt') {
    const outcome = await prompt.prompt();      // 'accepted' | 'dismissed' | 'unavailable'; event is single-use
    if (outcome === 'accepted') await ensurePersistence({ request: true });
  } else {
    showSteps(advice);                           // render advice.steps, advice.copy, advice.copy.warning
  }
}
```

`installAdvice(env, {appName})` returns `{kind, platform, steps, copy: {title, body, action?, warning?}, storageEffect}`. `detectInstallEnv(win, {canPrompt})` reads user agent, `maxTouchPoints`, and standalone (`navigator.standalone` or display-mode `standalone`/`window-controls-overlay`).

| `kind` | Where | What to render | `storageEffect` |
|---|---|---|---|
| `installed` | already standalone | nothing; a status line in settings | `none` |
| `prompt` | Chromium with a captured `beforeinstallprompt` | one button `copy.action`; call `prompt.prompt()` | `helps-persistence` |
| `menu` | Chromium desktop/Android, event not (yet) available | steps through the browser menu | `helps-persistence` |
| `ios-share-sheet` | iPhone, iPad (also Chrome/Firefox on iOS) | numbered steps + `copy.warning`; offer "Save a backup first" | `escapes-7-day-cap` |
| `macos-add-to-dock` | Safari on macOS 14+ | steps `File > Add to Dock` + `copy.warning` | `escapes-7-day-cap` |
| `firefox-taskbar` | Firefox on Windows 143+ | one step (taskbar icon in the address bar) | `none` |
| `open-in-browser` | Instagram, Facebook, Line and other in-app browsers | "open this page in Safari or Chrome" | `none` |
| `unsupported` | Firefox macOS/Linux, others | no install UI; keep the backup nudge | `none` |

`captureInstallPrompt(target?)` returns `{available(), prompt(), subscribe(cb), dispose()}`. Call it early: the event can fire before your UI mounts, and it fires once per page load. `prompt()` consumes the event; `subscribe` also fires on `appinstalled`. Safari never fires `beforeinstallprompt`, so Apple platforms only ever get instructions.

## 4. UX rules

1. Show install UI **after a value moment** (first saved item, first export), never on page load, never when `kind === 'installed'`.
2. **Remember one dismissal** with a timestamp in localStorage (try/catch every access; storage may be blocked) and re-ask only after a configurable interval. No re-ask on every visit; holdall does not store this for you, so keep it in the app's own namespace.
3. One primary action per platform. One line on the benefit, one honest line on durability.
4. **Avoid the word "PWA"** in user-facing text. Say "install", "add to Home Screen", "add to Dock".
5. **iOS and macOS Safari: "save a backup first, the Home Screen app starts empty."** The installed app also does not receive the URL fragment of the page it was installed from. Have the user save a file (or copy the link), install, then open the file or link inside the app. Provide an import path on first launch in standalone mode when the store is empty.
6. Never say "your data will be kept" on iOS. Say where it lives: "Your data is only in this browser on this device. We have no copy."
7. Verify step wording against the current iOS and browser UI before shipping; Share-sheet layout varies by version and browser.

User-facing copy (English; `installAdvice` returns most of it, adapt tone):

- Chromium button: "Install {App}. Opens in its own window and helps your browser keep your data."
- iPhone/iPad: "1. Tap the Share button (the square with an arrow). 2. Choose Add to Home Screen. 3. Keep Open as Web App on, then tap Add." Warning: "The Home Screen app starts empty: save a backup file first, then open it in the app." Why: "Safari deletes data of websites you have not used for about a week. Apps on the Home Screen keep theirs."
- macOS Safari: "In the menu bar choose File > Add to Dock, then Add." Same warning and why, with "Dock".
- Firefox Windows: "Click the Add tab to taskbar icon in the address bar."
- Firefox persistence button: "Keep my data on this device" (explain the browser will ask for permission).
- Unsupported: "This browser cannot install apps. Save a backup file now and then, or open {App} in Chrome, Edge or Safari to install it."
- In-app browser: "Open this page in your browser (Safari or Chrome) to install."
- Installed: "Installed. Your data is stored on this device only. Save a backup file now and then."

## 5. Manifest and service worker (vite-plugin-pwa + Workbox, MIT)

Chromium menu install no longer requires a service worker (mobile 108, desktop 112), but the automatic `beforeinstallprompt` still wants a `fetch` handler, so ship a small one. `vite-plugin-pwa` (`generateSW`) gives you the manifest, the worker and Workbox precache. Sketch for an app served at `/my-app/`:

```ts
// vite.config.ts
VitePWA({
  registerType: 'autoUpdate',
  manifest: {
    id: '/my-app/',                // explicit, root-relative, stable forever
    name: 'My App', short_name: 'My App',
    start_url: '/my-app/', scope: '/my-app/',       // scope ends with "/"
    display: 'standalone', theme_color: '#ffffff', background_color: '#ffffff',
    icons: [{ src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },   // relative paths
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
  },
  workbox: { navigateFallback: '/my-app/index.html', cleanupOutdatedCaches: true },
})
// with base: '/my-app/' in the Vite config; generate icons with @vite-pwa/assets-generator
```

Subpath and shared-origin gotchas:

- `id` resolves against the ORIGIN of `start_url`, so a relative `id: "my-app"` becomes `/my-app`, and an absent `id` defaults to `start_url`. Set it explicitly and never change it (it is the app's identity across updates).
- `scope` is prefix-matched: `"/my-app"` also captures `/my-app-old/`. End it with `/`.
- A worker at `/my-app/sw.js` cannot control `/` unless the server sends `Service-Worker-Allowed`. Do not send it on a shared origin.
- **Never register a root-scoped worker or manifest on a shared origin** (for example the landing page of `apps.example.com`): it captures siblings, and Workbox `cleanupOutdatedCaches` can delete siblings' precaches whose names contain the root scope.
- Icon `src` must be relative (resolved against the manifest URL); root-relative paths and config icons not prefixed by `base` 404 under a subpath.
- `navigateFallback` must live under the base; the server must serve `index.html` for deep links.
- **Do not cache `manifest.webmanifest` or `sw.js` for long** (short cache or `no-cache`), or updates never reach users. Test with a production build (`vite preview`), not dev.
- Changing `id` or `scope` after users install creates a second app identity that never updates.
- Ideal for isolation is one origin (subdomain) per app; path-separated apps on one origin are "not recommended" by Google. If you stay on paths, namespace keys and warn in reset UI: "Removing browser data for this site also removes the other apps on it."

**No service worker (option).** Skip the worker to avoid stale-cache bugs: menu install still works in Chromium and Apple platforms never needed one, but you lose the automatic prompt (so `installAdvice` returns `menu` instead of `prompt`), offline loading, and the storage grant heuristic that likes installed apps. Choose this for small tools that must never serve stale code; choose the worker for apps people use offline.

## 6. Optional enhancements

- **Web Install API** (`navigator.install()`, `<install>` element): Chromium desktop only and still rolling out; WebKit opposes site-initiated install. Feature-detect (`'install' in navigator`) and treat it as an extra path over `beforeinstallprompt`, never the only one.
- **`@khmyznikov/pwa-install`** (MIT, `<pwa-install>` web component): a ready-made dialog with Chromium prompt, iOS/macOS instructions, in-app-browser detection and many locales. Use it when you want UI without writing it; keep holdall's `ensurePersistence` and the backup nudge either way (it does not save a backup for you). Requires `lit`.
- `navigator.getInstalledRelatedApps()` (Chromium only) can hide the button in a tab when the app is already installed; needs a self-referencing `related_applications` entry.

## 7. Pitfalls

1. Calling `persist()` on page load. Firefox shows a permission prompt with no context; call it from a click after the first save (or only when standalone).
2. Treating `persisted: true` as safe on Safari. The 7-day cap may still apply to a tab; only Home Screen/Dock apps are exempt.
3. Showing an install banner on load or again after dismissal. Users learn to ignore it; wait for a value moment and remember one dismissal.
4. Installing on iOS without a backup. The Home Screen app is a separate empty container, so the user thinks their data is gone.
5. Listening for `beforeinstallprompt` after the UI mounts. The event fires once and may already be gone; capture at module load.
6. Reusing a `beforeinstallprompt` event. It is single-use; `prompt()` consumes it, so hide the button until `subscribe` reports a new one.
7. Root-scoped service worker or manifest on a shared origin. It hijacks sibling apps and can delete their caches.
8. Serving `sw.js` and the manifest with long cache headers. Users get stuck on old code; use `no-cache`.
9. Wiping storage with `localStorage.clear()` or a blanket "Reset". On a shared origin it deletes other apps' data; delete only your namespace.
10. Trusting `estimate()` numbers. They are deliberately imprecise; use them only to warn.

## 8. Checklist

- [ ] `captureInstallPrompt()` runs at module load; `dispose()` on teardown.
- [ ] `ensurePersistence({request: true})` is called from a click after the first save (or only when standalone), and `persisted` is shown in the UI.
- [ ] Install UI appears only after a value moment, never when installed, dismissal remembered with a re-ask interval, no "PWA" wording.
- [ ] iOS and macOS Safari advice includes "save a backup first"; the standalone app offers import when empty.
- [ ] Manifest has explicit root-relative `id`, `scope` ending in `/`, relative icons (192, 512, maskable); `navigateFallback` under the base.
- [ ] No root-scoped worker on a shared origin; manifest and `sw.js` are not cached forever.
- [ ] Keys are namespaced per app; reset deletes only this app's data.
- [ ] Tried in a private window and after "Clear site data": the app offers restore, not a blank slate (see `holdall-files`).
- [ ] Told the user which durability tier applies per platform.

## References

`references/research.md` holds the cited extract: eviction table, `persist()` behaviour per engine, install matrix, storage effect of installing, subpath and shared-origin details, library facts. Facts were current on 2026-09-29; Apple and Web Install API behaviour changes fast, so re-verify the marked items.
