/**
 * Files the user holds: save and open, with the File System Access API where
 * the browser has it and a download / file input everywhere else (both via
 * `browser-fs-access`), plus the share sheet on phones.
 */
import { fileOpen, fileSave } from 'browser-fs-access';

export interface SaveOptions {
  fileName: string;
  /** e.g. `['.json']`. Defaults from the file name's extension. */
  extensions?: string[];
  mimeType?: string;
  description?: string;
}

const extOf = (name: string) => (name.includes('.') ? [name.slice(name.lastIndexOf('.'))] : []);

/** Save text to a file the user picks (Chromium) or to Downloads (elsewhere). Resolves `false` if the user cancelled. */
export async function saveText(text: string, opts: SaveOptions): Promise<boolean> {
  const { fileName, extensions = extOf(opts.fileName), mimeType = 'application/json', description } = opts;
  try {
    await fileSave(new Blob([text], { type: mimeType }), { fileName, extensions, description });
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
}

export const saveJson = (value: unknown, opts: SaveOptions & { indent?: number }) =>
  saveText(JSON.stringify(value, null, opts.indent ?? 2), opts);

export interface OpenedText {
  name: string;
  text: string;
}

/** Let the user pick one or more files; resolves `[]` if they cancelled. */
export async function openText({
  extensions = ['.json'],
  mimeTypes = ['application/json'],
  multiple = false,
  description,
}: { extensions?: string[]; mimeTypes?: string[]; multiple?: boolean; description?: string } = {}): Promise<OpenedText[]> {
  try {
    const picked = await fileOpen({ extensions, mimeTypes, multiple, description });
    const files = Array.isArray(picked) ? picked : [picked];
    return Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return [];
    throw e;
  }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'saved';

interface ShareNavigator {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
}

/**
 * Hand a file to the OS share sheet when the browser can share files (phones,
 * Safari), else save it. `cancelled` means the user closed the sheet: do not
 * record the file as saved.
 */
export async function shareOrSave(
  text: string,
  opts: SaveOptions & { title?: string; nav?: ShareNavigator },
): Promise<ShareOutcome> {
  const nav: ShareNavigator = opts.nav ?? (globalThis.navigator as ShareNavigator);
  const file = new File([text], opts.fileName, { type: opts.mimeType ?? 'application/json' });
  if (nav?.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: opts.title });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // any other refusal (NotAllowedError, unsupported type): fall through to saving
    }
  }
  return (await saveText(text, opts)) ? 'saved' : 'cancelled';
}
