/**
 * holdall: client-side persistence and sharing, headless.
 *
 * - `envelope`: `{app, kind, version, data}` wrappers with migrations and validation.
 * - `link`: share links (compressed payload in the URL fragment) with a length budget.
 * - `merge` + `collection`: whole-collection export files and conflict-aware import.
 * - `files`: save/open files and the share sheet.
 * - `durability`: persistent storage and per-platform install advice.
 * - `autosave`: debounced writes that flush when the page is hidden.
 *
 * The zodal facade is at `holdall/zodal`.
 */
export * from './errors';
export * from './envelope';
export * from './link';
export * from './merge';
export * from './collection';
export * from './files';
export * from './durability';
export * from './autosave';
