# holdall

Client-side persistence and sharing for web apps, for agents first: tell your coding agent "implement client-side storage" and it is routed to the right patterns for your stack. The user's data stays with the user, in the browser, in files and in links, and nothing is stored on a server.

```bash
gh skill install i2mint/holdall holdall      # the router skill (add the holdall-* skills too, see below)
npm i holdall                                 # the headless TypeScript core (optional)
```

```ts
import { makeShareLink, readShareLink, wrap, unwrap } from 'holdall';

const spec = { app: 'my-app', kind: 'design', version: 1 };
const link = makeShareLink(wrap(design, spec), location.href);   // {url, length, tier: 'portable' | 'chat' | 'email' | 'too-long'}
const back = unwrap(readShareLink(link.url), spec);             // migrated and validated on the way in
```

## What you get

**Agent skills** (the main product). A router skill, `holdall`, which triggers on the many ways people ask for this ("save my work", "share link", "export/import", "make it installable", "Safari deleted my data"), and five nested skills it routes to:

| Skill | For |
|---|---|
| `holdall-local-store` | localStorage vs IndexedDB vs OPFS, envelopes and migrations, never-lose-input autosave, cross-tab |
| `holdall-share-links` | state in the URL fragment, compressed and versioned, with a length budget |
| `holdall-files` | save/open files, whole-collection export and import with a conflict plan |
| `holdall-durability` | persistent storage, eviction rules per browser, the Install button and per-platform copy |
| `holdall-sync-later` | when a sync engine is warranted, and the sync-ready shape to keep now |

Plus a read-only subagent, `holdall-auditor`, that audits an existing app's persistence and returns a ranked gap list.

**A headless core** (`npm i holdall`), framework-free, with browser globals injectable for tests:

| Module | Main functions |
|---|---|
| envelope | `wrap`, `unwrap` (forward-only migrations, refuses data newer than the code, any Standard Schema validator) |
| link | `makeShareLink`, `readShareLink`, `encodePayload`, `decodePayload`, `linkTier`, `stripUrlParams` |
| collection + merge | `exportCollection`, `parseCollection`, `planImport`, `resolveImport` (default: keep both, prefix the incoming key) |
| files | `saveJson`, `openText`, `shareOrSave` (share sheet on phones, then save) |
| durability | `ensurePersistence`, `detectInstallEnv`, `installAdvice`, `captureInstallPrompt` |
| autosave | `createAutosave` (debounced, flushes on `pagehide` and when the page is hidden, retries failed writes) |

**A zodal facade** (`holdall/zodal`): `createPersistence({provider, app, kind, version, schema})` over any zodal `DataProvider` gives `exportAll`, `planImport`, `applyImport`, `shareLink` and `readLink`, and `persistenceOperations` for `defineCollection({operations})`. Your app supplies the renderings (the conflict dialog, the install card).

## Installing the skills

One skill at a time with the GitHub CLI:

```bash
for s in holdall holdall-local-store holdall-share-links holdall-files holdall-durability holdall-sync-later; do
  gh skill install i2mint/holdall "$s"
done
```

`gh skill` needs a recent GitHub CLI. Without it, clone the repo and symlink each `skills/<name>` folder into `~/.claude/skills/` (Claude Code) or your agent's skills directory.

The subagent is a single file: copy `agents/holdall-auditor.md` into `~/.claude/agents/` (or your project's `.claude/agents/`). The npm package also ships `skills/` and `agents/`, so they are in `node_modules/holdall/` once the package is installed.

## Import with conflicts

```ts
import { parseCollection, planImport, resolveImport } from 'holdall';

const { items, rejected } = parseCollection(fileText, spec);          // bad items are reported, not fatal
const plan = planImport(heldEntries, items);                          // {added, identical, conflicts}
// show "3 new, 5 already here, 2 differ"; let the user choose per conflict, or accept the default
const { writes, skipped } = resolveImport(plan, { decisions: { b: 'overwrite' } });   // others: renamed to "imported-<key>"
```

Equality is by RFC 8785 canonical JSON, so key order does not create false conflicts.

## Share links from a terminal

```bash
npx holdall encode design.json --url https://example.com/app/   # prints the link, and its length tier on stderr
npx holdall decode 'https://example.com/app/#s=z1.…'            # prints the JSON it carries
```

## Defaults, and why

Every default comes from the cited research in `docs/research/`. Briefly: payloads go in the URL fragment (never sent to a server), compressed with fflate, prefixed with a codec version; links over about 2,000 characters may be cut by messengers, and over 8,000 you should offer a file. Browser storage is best-effort everywhere, and Safari deletes script-written storage after 7 days without use unless the app is on the Home Screen or in the Dock, so the file or link the user holds is the real record. Dependencies are small and permissive: `fflate` (MIT), `canonicalize` (Apache-2.0), `browser-fs-access` (Apache-2.0).

See `docs/design.md` for the seams and surfaces.

## License

MIT
