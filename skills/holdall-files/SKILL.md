---
name: holdall-files
description: >-
  Save, open, export and import the user's data as files, including merging an imported file with what is already there. Use when asked to "save to a file", "download my data", "open/load a JSON file", "export", "import", "backup and restore", "export everything", "export the whole collection", "import and merge", "duplicate items on import", "conflict dialog", "overwrite or keep both", "share sheet", "share a file on iPhone", "File System Access API", "browser-fs-access", "file naming", "remind me to back up", "restore after clearing browser data", "createPersistence", "zodal export/import", or "what happens if the imported item already exists". Covers shareOrSave, single-item and whole-collection files, parseCollection/planImport/resolveImport, the conflict dialog UX, the zodal facade, file naming and backup nudges.
license: MIT
metadata:
  package: holdall
---

# holdall-files: the file is the record

Browser storage is a cache; a file the user holds is the record. Use this when the app must let people save what they made, open it again on another device or after a wipe, move a whole collection, or merge someone else's file into their own without losing anything. Links for small payloads live in `holdall-share-links`; keeping storage alive lives in `holdall-durability`.

## 1. Decide what to offer

| Need | Offer | holdall |
|---|---|---|
| keep one item | "Save to file" | `wrap(item, spec)` then `shareOrSave` / `saveJson` |
| back up or move everything | "Export all" | `exportCollection(items, spec)` then `shareOrSave` |
| bring a file in | "Open file…" | `openText` then `parseCollection` → `planImport` → dialog → `resolveImport` |
| send to a person on a phone | the OS share sheet | `shareOrSave` (falls back to saving) |
| send a small item as text | a link | `holdall-share-links` |

Platform reality (2026): the File System Access pickers (`showSaveFilePicker`, real "Save to the same file") exist only in Chromium desktop; Firefox and Safari can only download to the Downloads folder and read through `<input type=file>`, and Chromium on Android is not reliable. `browser-fs-access` (which holdall's `saveText`/`openText` wrap) gives one call with progressive enhancement, so never write `showSaveFilePicker` yourself. There is no "save back to the same file" outside Chromium: say "Saved a copy to Downloads" and make Open the return path.

## 2. Saving

`saveText`/`saveJson(value, {fileName, extensions?, mimeType?, description?, indent?})` resolve `true` when saved and `false` when the user cancelled. `openText({extensions=['.json'], multiple?})` resolves `[]` on cancel and `{name, text}[]` otherwise. `shareOrSave(text, {fileName, title?, ...})` resolves a tri-state:

| Outcome | Meaning | Record "exported"? |
|---|---|---|
| `'shared'` | the OS share sheet took the file (phones, Safari) | yes |
| `'saved'` | written via picker or download | yes |
| `'cancelled'` | user closed the sheet or dialog (`AbortError`) | **no** |

Any other share failure falls through to saving. Browsers only share some MIME types via `navigator.canShare({files})`; JSON is often refused, so test on a real phone and, if the sheet never appears, pass `mimeType: 'text/plain'` (name still ends in `.json`).

File names: `<app>-<kind>-YYYY-MM-DD.json` using the **local** date, not `toISOString()` (UTC would name an evening export tomorrow). Collections use the same pattern with the collection kind.

```ts
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fileName = (app: string, kind: string) => `${app}-${kind}-${localDate()}.json`;
```

## 3. The file format

One envelope per file, so a file is self-describing and migratable:

- Single item: `{app, kind: 'note', version, savedAt, data: <item>}`.
- Collection: `{app, kind: 'note:collection', version, savedAt, data: {items: {<key>: <item>}}}` (`collectionKind(kind)`, `exportCollection`).

Export strips machine-local and volatile state (window layout, "last opened") so an import never clobbers preferences. Keep the extension `.json` so any OS opens it.

## 4. Importing: plan, ask, apply

```ts
import { openText, parseCollection, planImport, resolveImport, isHoldallError } from 'holdall';

const spec = { app: 'notes', kind: 'note', version: 2, schema: NoteSchema, migrations };
const [file] = await openText();
if (!file) return;                                            // cancelled
const parsed = parseCollection<Note>(file.text, spec, { keyOf: (n) => n.id }); // may throw HoldallError
const plan = planImport(await heldEntries(), parsed.items);   // dry run, pure data
// Show: `${plan.added.length} new, ${plan.identical.length} already here, ${plan.conflicts.length} differ`
const decisions = await conflictDialog(plan.conflicts);       // {key: 'rename'|'overwrite'|'skip'} (may be empty)
const res = resolveImport(plan, { policy: 'rename', decisions, rekey: (n, key) => ({ ...n, id: key }) });
for (const w of res.writes) await store.set(w.key, w.value);  // add | overwrite | rename (w.from = incoming key)
report({ ...res, rejected: parsed.rejected });                // never drop silently
```

- `parseCollection(raw, spec, {keyOf?})` accepts JSON text or a parsed value, a collection file or a single-item file (needs `keyOf`; `source` says which), validates **item by item** and returns `{items, rejected: [{key, error}], source}`. One bad record is reported, not fatal. `spec.bareVersion` accepts old files written before envelopes existed.
- `planImport(held, incoming, {equals?})` returns `{added, identical, conflicts: [{key, existing, incoming}], heldKeys}`. Equality is RFC 8785 canonical JSON (`canonicalEquals`), so key order and number formatting do not matter. Identical content is a silent no-op.
- `resolveImport(plan, {policy='rename', decisions, prefix='imported-', renameKey?, rekey?})` returns `{writes, skipped, identical}`. Policies: `rename` (keep both: incoming key gets prefix `imported-`, then `imported-2-…` until free), `overwrite`, `skip`. `decisions[key]` beats the policy. **Pass `rekey`** whenever the value carries its own id, or the renamed copy still has the old id and collides.
- File-level errors are `HoldallError` with a `code`; map each to one sentence: `not-an-envelope` "This file was not exported by this app", `wrong-app`, `wrong-kind` (a different kind of file), `too-new` "Reload to update the app", `bad-payload` (not JSON), `invalid`, `missing-migration`.

### The conflict dialog

1. **Summary first, before any write:** "12 new, 5 already here, 3 differ." If nothing differs, one button: "Import 12". The dry run is the confirmation.
2. **Per-conflict row** with the item's name, a compact "already here" vs "in the file" comparison (both values, or a field diff; show dates and sizes when the model has them), and three choices: **Keep both** (default, focused), Replace with the file's, Skip.
3. **Apply to all** checkbox on the choice row, feeding `policy`; individual overrides go in `decisions`. A bulk import with 200 conflicts needs it.
4. **Never remove the choice**; "Replace" must truly replace (no duplicate left behind).
5. **After:** a report "Added 12, kept both 2 (renamed), replaced 1, skipped 0, could not read 1". List what could not be read (`rejected`) or refused by the store (`failed`), with the reason. Offer to undo only if you kept the overwritten values.

Headless or agent callers use `policy: 'skip'` or `'rename'`, never `'overwrite'` unless explicitly told.

## 5. With zodal

`createPersistence({provider, app, kind, version, schema, migrations, idField='id', now})` from `holdall/zodal` wraps any `DataProvider` and returns:

| Method | Does |
|---|---|
| `exportAll()` | collection envelope, ready for `shareOrSave` |
| `exportOne(id)` | single-item envelope |
| `planImport(raw)` | parse (collection or single item) and compare; returns `{plan, rejected}` |
| `applyImport(pending, {policy, decisions, prefix, renameKey})` | applies; returns `ImportReport {added, overwritten, renamed:[{from,to}], skipped, identical, rejected, failed}`; `rekey` is set to `idField` for you; provider refusals land in `failed` |
| `shareLink(id, baseUrl, opts?)` / `readLink(url, opts?)` | one item as a payload link (see `holdall-share-links`) |

Add `persistenceOperations` (`holdall.exportAll`, `holdall.import`, `holdall.saveFile`, `holdall.shareLink`) to `defineCollection({operations})` and wire each name to the method above. The app still renders the dialog and the toasts.

## 6. "Last exported" and nudges

The library does not track this; the app does, in one small record (`{lastExportedAt, exportedCount}`) next to the data. Write it only when `shareOrSave` resolves `'shared'` or `'saved'`. Nudge when **unsaved work grows**, not on a timer: after the first item is created ("Your data lives only in this browser. Save a backup file."), and again when items changed since the last export pass a threshold (a count, not a clock). Show a quiet inline banner with the Save button, dismiss for the session, and do not block. Copy: "Your data is only in this browser on this device. We have no copy."

## 7. Restore on an empty store

Every empty state offers "Restore from a file" beside "Start fresh", because empty also means new device, cleared browsing data, or Safari's inactivity purge. A sentinel (`firstRunAt`) written to a second storage type (e.g. localStorage next to an IndexedDB store) can distinguish "never used" from "was wiped" when only one is lost; if both go, the empty state's restore button is the fallback. iOS caveat: the Home Screen app has its own storage and starts empty, so tell users to save a file before installing and open it in the installed app.

## 8. Pitfalls

1. Marking a backup done when the user cancelled the sheet gives false safety. Only `'shared'` and `'saved'` count.
2. Renaming without `rekey` leaves two records with one id. Whenever the value carries its key, pass `rekey`.
3. Volatile fields (`updatedAt`, `lastOpened`) make "identical" never equal. Strip them on export, or pass `equals` to `planImport` (the zodal facade's `planImport(raw, {equals})` too).
4. Importing without a plan (write, then tell) destroys data with no undo. Always show the dry run.
5. `URL.createObjectURL` revoked immediately breaks Safari downloads. In hand-rolled downloads (not `saveText`), revoke the object URL late.
6. Trusting the file: an import is untrusted input. Validate with the schema and never merge unknown `kind`/`app`.
7. A store that swallows a JSON parse error and writes a fresh array over the corrupt key loses everything. Keep the raw text aside (a `.corrupt-<ts>` key) and tell the user (`holdall-local-store`).

## 9. Checklist

- [ ] Save item, Export all, Open file on every platform; Firefox/Safari get download, phones get the share sheet.
- [ ] Names `<app>-<kind>-YYYY-MM-DD.json`, local date; envelope with the right `kind`.
- [ ] Import shows the dry-run summary; conflicts default to keep both; apply to all; both values shown.
- [ ] `rekey` set; `rejected` and `failed` reported; nothing dropped silently.
- [ ] Old-version fixture file still imports; a newer-version file is refused with a clear message.
- [ ] "Last exported" written only on shared/saved; nudge tied to unsaved growth.
- [ ] Empty state offers restore; round trip export → wipe → import gives identical data.

## References

- `references/research.md`: File System Access support and permissions, fallbacks and libraries, Web Share and clipboard, conflict-resolution prior art, canonical JSON, backup and restore principles, with numbered sources.
