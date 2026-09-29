/**
 * Keeping browser storage alive: ask for persistent storage, and tell the user
 * how to install the app on their platform (installed apps are evicted less,
 * and on Safari/iOS they escape the 7-day storage cap).
 *
 * Everything here returns data, not UI: `installAdvice()` gives a `kind`,
 * numbered `steps` and English `copy` that any renderer can show or replace.
 * Browser globals are injectable so decisions are testable in Node.
 * Sources: docs/research/02 and 03.
 */

// ---- persistent storage ----

interface StorageManagerLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

export interface PersistenceStatus {
  /** The browser exposes `navigator.storage.persist`. */
  supported: boolean;
  /** Storage is marked persistent (not evicted under pressure). Safari may still apply its 7-day cap. */
  persisted: boolean;
  usage?: number;
  quota?: number;
}

/**
 * Report persistence and, with `request: true`, ask for it.
 * Call with `request: true` from a click handler after the user first saves
 * something: Firefox shows a permission prompt, Chrome decides silently.
 * Never throws.
 */
export async function ensurePersistence({
  request = false,
  storage = (globalThis.navigator as { storage?: StorageManagerLike } | undefined)?.storage,
}: { request?: boolean; storage?: StorageManagerLike } = {}): Promise<PersistenceStatus> {
  const status: PersistenceStatus = { supported: typeof storage?.persist === 'function', persisted: false };
  try {
    status.persisted = (await storage?.persisted?.()) ?? false;
    if (!status.persisted && request && storage?.persist) status.persisted = await storage.persist();
  } catch {
    /* private mode or blocked storage: report not persisted */
  }
  try {
    const est = await storage?.estimate?.();
    if (est) Object.assign(status, { usage: est.usage, quota: est.quota });
  } catch {
    /* estimate is advisory */
  }
  return status;
}

// ---- platform detection ----

export interface InstallEnv {
  userAgent: string;
  /** `navigator.maxTouchPoints`: tells iPadOS (which reports a Mac UA) from a Mac. */
  maxTouchPoints: number;
  /** Running as an installed app (display-mode standalone, or iOS `navigator.standalone`). */
  standalone: boolean;
  /** A `beforeinstallprompt` event has been captured and not used yet. */
  canPrompt: boolean;
}

type WindowLike = {
  navigator?: { userAgent?: string; maxTouchPoints?: number; standalone?: boolean };
  matchMedia?: (q: string) => { matches: boolean };
};

export function detectInstallEnv(
  win: WindowLike = globalThis as WindowLike,
  { canPrompt = false }: { canPrompt?: boolean } = {},
): InstallEnv {
  const nav = win.navigator ?? {};
  const mm = (q: string) => {
    try {
      return win.matchMedia?.(q).matches ?? false;
    } catch {
      return false;
    }
  };
  return {
    userAgent: nav.userAgent ?? '',
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone === true || mm('(display-mode: standalone)') || mm('(display-mode: window-controls-overlay)'),
    canPrompt,
  };
}

export type Platform =
  | 'ios'
  | 'android'
  | 'macos-safari'
  | 'chromium-desktop'
  | 'firefox-windows'
  | 'firefox-other'
  | 'in-app'
  | 'other';

const IN_APP = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|GSA\/|Snapchat|TikTok|; wv\)/;

export function detectPlatform({ userAgent: ua, maxTouchPoints }: Pick<InstallEnv, 'userAgent' | 'maxTouchPoints'>): Platform {
  if (IN_APP.test(ua)) return 'in-app';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (ios) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return /Windows/.test(ua) ? 'firefox-windows' : 'firefox-other';
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'chromium-desktop';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return 'macos-safari';
  return 'other';
}

// ---- install advice ----

export type InstallAdviceKind =
  | 'installed'
  | 'prompt'
  | 'menu'
  | 'ios-share-sheet'
  | 'macos-add-to-dock'
  | 'firefox-taskbar'
  | 'open-in-browser'
  | 'unsupported';

export interface InstallAdvice {
  kind: InstallAdviceKind;
  platform: Platform;
  /** Numbered steps to show; empty when one button does it. */
  steps: string[];
  copy: { title: string; body: string; action?: string; warning?: string };
  /** What installing does for storage on this platform. */
  storageEffect: 'escapes-7-day-cap' | 'helps-persistence' | 'none';
}

/**
 * What to show the user, as data. Show it after a value moment (the first
 * saved item), never on page load, and never when `kind === 'installed'`.
 */
export function installAdvice(env: InstallEnv, { appName = 'this app' }: { appName?: string } = {}): InstallAdvice {
  const platform = detectPlatform(env);
  const helps = 'Opens in its own window and helps your browser keep your data.';
  const base = { platform, steps: [] as string[] };
  if (env.standalone) {
    return { ...base, kind: 'installed', copy: { title: 'Installed', body: 'Your data is stored on this device only. Save a backup file now and then.' }, storageEffect: 'none' };
  }
  if (platform === 'in-app') {
    return { ...base, kind: 'open-in-browser', copy: { title: 'Open in your browser', body: `To install ${appName}, open this page in Safari or Chrome.` }, storageEffect: 'none' };
  }
  if (platform === 'ios') {
    return {
      ...base,
      kind: 'ios-share-sheet',
      steps: ['Tap the Share button (the square with an arrow).', 'Choose "Add to Home Screen".', 'Keep "Open as Web App" on, then tap Add.'],
      copy: {
        title: `Add ${appName} to your Home Screen`,
        body: 'Safari deletes data of websites you have not used for about a week. Apps on the Home Screen keep theirs.',
        warning: 'The Home Screen app starts empty: save a backup file first, then open it in the app.',
      },
      storageEffect: 'escapes-7-day-cap',
    };
  }
  if (env.canPrompt) {
    return { ...base, kind: 'prompt', copy: { title: `Install ${appName}`, body: helps, action: `Install ${appName}` }, storageEffect: 'helps-persistence' };
  }
  if (platform === 'macos-safari') {
    return {
      ...base,
      kind: 'macos-add-to-dock',
      steps: ['In the menu bar, choose File > Add to Dock.', 'Click Add.'],
      copy: { title: `Add ${appName} to the Dock`, body: 'Safari deletes data of websites you have not used for about a week. Apps in the Dock keep theirs.', warning: 'The Dock app starts empty: save a backup file first, then open it in the app.' },
      storageEffect: 'escapes-7-day-cap',
    };
  }
  if (platform === 'chromium-desktop' || platform === 'android') {
    return {
      ...base,
      kind: 'menu',
      steps: platform === 'android' ? ['Open the browser menu (⋮).', 'Choose "Install app" or "Add to Home screen".'] : ['Open the browser menu (⋮).', `Choose "Install ${appName}" (in Chrome, under "Cast, save, and share").`],
      copy: { title: `Install ${appName}`, body: helps },
      storageEffect: 'helps-persistence',
    };
  }
  if (platform === 'firefox-windows') {
    return { ...base, kind: 'firefox-taskbar', steps: ['Click the "Add tab to taskbar" icon in the address bar.'], copy: { title: `Add ${appName} to the taskbar`, body: helps }, storageEffect: 'none' };
  }
  return {
    ...base,
    kind: 'unsupported',
    copy: { title: 'Keep a backup', body: `This browser cannot install apps. Save a backup file now and then, or open ${appName} in Chrome, Edge or Safari to install it.` },
    storageEffect: 'none',
  };
}

// ---- the install prompt (Chromium) ----

interface PromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type EventTargetLike = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface InstallPrompt {
  available(): boolean;
  /** Show the browser's install dialog. Call from a click handler. The event is single-use. */
  prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** Called when availability changes (event captured, used, or app installed). Returns an unsubscribe. */
  subscribe(cb: (available: boolean) => void): () => void;
  dispose(): void;
}

/**
 * Capture `beforeinstallprompt` so a button of yours can trigger it. Call once,
 * early (the event can fire before your UI mounts).
 */
export function captureInstallPrompt(target: EventTargetLike = globalThis as unknown as EventTargetLike): InstallPrompt {
  let event: PromptEvent | null = null;
  const listeners = new Set<(a: boolean) => void>();
  const notify = () => listeners.forEach((cb) => cb(event !== null));
  const onPrompt = (e: Event) => {
    e.preventDefault();
    event = e as PromptEvent;
    notify();
  };
  const onInstalled = () => {
    event = null;
    notify();
  };
  target.addEventListener('beforeinstallprompt', onPrompt);
  target.addEventListener('appinstalled', onInstalled);
  return {
    available: () => event !== null,
    async prompt() {
      const e = event;
      if (!e) return 'unavailable';
      event = null;
      notify();
      await e.prompt();
      return (await e.userChoice).outcome;
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      target.removeEventListener('beforeinstallprompt', onPrompt);
      target.removeEventListener('appinstalled', onInstalled);
      listeners.clear();
    },
  };
}
