# Research extract: files, sharing files, import and merge

Extract of holdall's two research reports (dated 2026-09-29) keeping what backs the `holdall-files` skill. Support figures come from MDN browser-compat data and caniuse at that date and change; re-check before advertising a capability. Claims marked UNVERIFIED rest on secondary sources.

## 1. File System Access API and fallbacks

| Feature | Chrome/Edge desktop | Chrome Android | Firefox | Safari |
|---|---|---|---|---|
| `showOpenFilePicker`, `showSaveFilePicker`, `showDirectoryPicker` | Yes (Chrome 86) | sources disagree (MDN 132; caniuse: no) [1][2] | No; Mozilla position negative [3] | No; WebKit position oppose [4] |
| Persistent permission | Chrome 122 "Allow on every visit"; installed apps persist once granted [5] | unverified | n/a | n/a |
| `FileSystemObserver` | experimental, non-standard: do not rely on it [6] | No | No | No |

The pickers need a secure context and transient user activation [7]. Global usage of the pickers is about 31% [2]. Handles can be stored in IndexedDB, but permission may need a fresh user gesture after a restart, so a headless flow cannot assume silent access [7].

Fallback when the pickers are missing: open through `<input type="file">`, save through a Blob, `URL.createObjectURL` and `<a download>` [8]. Consequence: no "Save" back to the same file on Firefox and Safari, only "Save as" into Downloads, and the user must re-import the file to continue.

| Library | Role | License | Note |
|---|---|---|---|
| [browser-fs-access](https://github.com/GoogleChromeLabs/browser-fs-access) | `fileOpen`, `directoryOpen`, `fileSave` with fallbacks [9] | Apache-2.0 | small, maintained; what holdall wraps; used by Excalidraw [10] |
| native-file-system-adapter | ponyfill of the whole FSA surface with several backends | MIT | pick it if you want the handle abstraction itself |
| FileSaver.js | `saveAs(blob, name)` download shim | MIT | effectively unmaintained and unneeded: `<a download>` suffices |

"Watch a local folder as a store" (a directory handle as the database) is Chromium desktop only, needs re-permission each session, has no dependable change notification or multi-file atomicity, and the handle itself lives in IndexedDB so a site-data wipe makes the app forget the folder. Keep it optional behind the same store interface; manual export and import must work on every layer.

## 2. Web Share and clipboard

`navigator.share()` and `navigator.canShare()` need a secure context and transient activation; `share` rejects with `AbortError` on user cancel (or no targets), `NotAllowedError` without activation, `TypeError` for invalid or unsupported files [11]. Shareable file types are limited (certain audio, image, video, text such as `.txt`/`.csv`/`.html`, and `.pdf`); JSON and arbitrary binaries are typically refused, so share a JSON export as text or as a link, and always feature-test with `navigator.canShare({files})` [11][12]. Support: Chrome desktop 128 for all platforms (earlier only Windows and ChromeOS), Chrome Android and Samsung yes, Safari macOS/iOS `share` 12.1 and `canShare` files 14, Firefox desktop not shipped, Firefox Android yes [13]. So Share is a progressive enhancement over Download, never the only path.

`navigator.clipboard.writeText()` is widely available, secure context only, and rejects with `NotAllowedError` when not permitted; call it synchronously inside the click handler and keep a visible select-and-copy field as the fallback [14][15].

## 3. Canonical JSON for equality

RFC 8785 (JCS) [16]: keys sorted by UTF-16 code units, ECMAScript number serialization, minimal escaping, I-JSON constraints (no duplicate keys, IEEE-754 numbers so big integers must be strings), NaN and Infinity are errors; Unicode is not normalized. holdall uses the `canonicalize` package (Apache-2.0, about 0.8 KB gzipped) [17]. Cautions: `undefined`-valued keys are dropped (`{a: undefined}` equals `{}`); Dates must be strings first; strip volatile fields (`updatedAt`, `lastOpened`, and the id if it is the key) or "identical" content never compares equal.

## 4. Conflict-resolution prior art

| Product | Behavior on collision | Lesson |
|---|---|---|
| Desktop file copy (Windows Explorer, macOS Finder) | Replace / Skip / Keep both, "do this for all", comparison of existing vs incoming name, size, date; keep both auto-suffixes [18] | the four verbs, apply-to-all and a comparison view; safest default is keep the existing |
| Postman collection import | import as copy vs replace; users complained when the choice disappeared and when Replace left duplicates, and asked for do-it-for-all in bulk [19] | never remove the choice; make Replace truly replace |
| VS Code Profiles export/import | import creates a new profile; machine-specific settings omitted on export; users asked for rename-on-conflict [20] | export strips machine-local data; import offers rename |
| Excalidraw library import | adds only items that are unique by content signature, new ones first; persistence goes through an adapter seam [10] | additive merge with no destructive default |
| Obsidian Sync | per-data-class strategy: three-way merge for Markdown, key-merge for settings JSON, last-modified for the rest; user can choose "create conflict file" [21] | offer keep-both as the safe option |
| tldraw | loads a snapshot by replacing the store after migrations; shared document and per-user session are separate [22] | separate shareable content from session state so import never clobbers UI prefs |

A collection import rarely has a common ancestor, so resolve per item; field-level three-way merge (node-diff3, jsondiffpatch, rfc6902) belongs behind an optional strategy. Suggested pipeline: parse envelope, check `app` and `kind`, refuse newer versions, migrate, validate each item collecting per-item errors, then plan, then apply and report `{added, skipped, overwritten, renamed, identical, failed}`. Headless and agent calls default to non-destructive policies.

## 5. Principles for an app that stores nothing server-side

- Browser storage is a cache with a best-effort lifespan; the record is a file or link the user controls, and the app says so plainly.
- Export is first-class and cheap: one "Save backup" (a handle where available, a download otherwise, the share sheet on phones), plus "Copy share link". Keep a "last exported" timestamp and warn when unexported changes pile up.
- On every start with an empty store, offer to restore a backup instead of silently starting fresh; a sentinel record written at first run and missing later signals a wipe.
- Detect capabilities (`"showOpenFilePicker" in window`, `navigator.canShare`) and report the detected tier back to the caller.
- Safari macOS and iOS remove script-writable storage after about seven days without use unless the site is a Home Screen or Dock web app; the Home Screen app has a separate store, so a first run in Safari followed by install starts empty: export in Safari, import in the installed app [23][24].
- User-facing copy: "Your data lives only in this browser on this device. We have no copy. Use Save backup to keep a file you control. We will remind you when your last backup is old."

## REFERENCES

1. [MDN browser-compat-data](https://github.com/mdn/browser-compat-data/tree/main/api) (queried 2026-09-29: showOpenFilePicker and siblings, Navigator.share/canShare, Clipboard)
2. [Can I use: File System Access API](https://caniuse.com/native-filesystem-api)
3. [Mozilla standards-positions 154: File System Access (negative)](https://github.com/mozilla/standards-positions/issues/154)
4. [WebKit standards-positions 28: File System Access (oppose)](https://github.com/WebKit/standards-positions/issues/28)
5. [Chrome for Developers: Persistent permissions for the File System Access API](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)
6. [MDN: FileSystemObserver](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemObserver)
7. [Chrome for Developers: The File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
8. [Chrome for Developers: Reading and writing files with the browser-fs-access library](https://developer.chrome.com/docs/capabilities/browser-fs-access)
9. [browser-fs-access repository](https://github.com/GoogleChromeLabs/browser-fs-access)
10. [Excalidraw source: data/library.ts (mergeLibraryItems)](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/library.ts) and [data/json.ts](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/json.ts)
11. [MDN: Navigator.share()](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
12. [web.dev: Share content with other apps](https://web.dev/articles/web-share)
13. [Can I use: Web Share API](https://caniuse.com/web-share)
14. [MDN: Clipboard API, security considerations](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)
15. [MDN: Clipboard.writeText()](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)
16. [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
17. [canonicalize repository](https://github.com/erdtman/canonicalize)
18. [The Old New Thing: file copy conflict dialog options](https://devblogs.microsoft.com/oldnewthing/20190604-00/?p=102539)
19. [Postman issue 11862: collection import lost replace vs copy](https://github.com/postmanlabs/postman-app-support/issues/11862)
20. [VS Code docs: Profiles](https://code.visualstudio.com/docs/configure/profiles)
21. [Obsidian Help: Troubleshoot Obsidian Sync (conflict resolution)](https://obsidian.md/help/sync/troubleshoot)
22. [tldraw docs: Persistence](https://tldraw.dev/docs/persistence)
23. [WebKit blog: Full Third-Party Cookie Blocking and More (7-day cap)](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)
24. [WebKit blog: Beta testing web apps in Safari 26](https://webkit.org/blog/16993/beta-testing-web-apps-in-safari-26/)
