/**
 * Autosave that never loses the last edit: debounce writes, flush on the
 * last-chance events (`pagehide`, `visibilitychange` to hidden), and keep a
 * failed value pending so the next flush retries it.
 */

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface AutosaveOptions<T> {
  save: (value: T) => void | Promise<void>;
  /** Milliseconds of quiet before writing. Default 400. */
  delay?: number;
  onError?: (error: unknown, value: T) => void;
  /** Where `pagehide` fires. Default `globalThis`. */
  win?: Target;
  /** Where `visibilitychange` fires, with `visibilityState`. Default `globalThis.document`. */
  doc?: Target & { visibilityState?: string };
}

export interface Autosave<T> {
  schedule(value: T): void;
  /** Write the pending value now. Resolves when every earlier write, and this one, has settled. */
  flush(): Promise<void>;
  pending(): boolean;
  dispose(): void;
}

export function createAutosave<T>(opts: AutosaveOptions<T>): Autosave<T> {
  const { save, delay = 400, onError = () => {} } = opts;
  const win = opts.win ?? (globalThis as unknown as Target);
  const doc = opts.doc ?? (globalThis as { document?: Target & { visibilityState?: string } }).document;
  let pendingValue: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Saves run one at a time, in order: a slow older save can never land after a newer one.
  // When idle, a save starts synchronously (a `pagehide` handler must not defer its write).
  let inFlight: Promise<void> | null = null;

  const saveNext = async () => {
    if (!pendingValue) return;
    const { value } = pendingValue;
    pendingValue = null;
    try {
      await save(value);
    } catch (e) {
      if (!pendingValue) pendingValue = { value }; // retry later, unless newer input has replaced it
      onError(e, value);
    }
  };

  const flush = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    const next: Promise<void> = (inFlight ? inFlight.then(saveNext) : saveNext()).finally(() => {
      if (inFlight === next) inFlight = null;
    });
    inFlight = next;
    return next;
  };
  const onPageHide = () => void flush();
  const onVisibility = () => {
    if (doc?.visibilityState === 'hidden') void flush();
  };
  win?.addEventListener?.('pagehide', onPageHide);
  doc?.addEventListener?.('visibilitychange', onVisibility);

  return {
    schedule(value) {
      pendingValue = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delay);
    },
    flush,
    pending: () => pendingValue !== null,
    dispose() {
      if (timer) clearTimeout(timer);
      win?.removeEventListener?.('pagehide', onPageHide);
      doc?.removeEventListener?.('visibilitychange', onVisibility);
    },
  };
}
