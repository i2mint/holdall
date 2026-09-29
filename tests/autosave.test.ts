import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from '../src';

afterEach(() => vi.useRealTimers());

describe('autosave', () => {
  it('debounces, and flushes on pagehide', async () => {
    vi.useFakeTimers();
    const saved: number[] = [];
    const win = new EventTarget();
    const a = createAutosave<number>({ save: (v) => void saved.push(v), delay: 100, win, doc: new EventTarget() });
    a.schedule(1);
    a.schedule(2);
    vi.advanceTimersByTime(99);
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(saved).toEqual([2]);
    a.schedule(3);
    win.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    expect(saved).toEqual([2, 3]);
    a.dispose();
  });

  it('flushes when the document becomes hidden', async () => {
    const saved: string[] = [];
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const a = createAutosave<string>({ save: (v) => void saved.push(v), delay: 10_000, win: new EventTarget(), doc });
    a.schedule('x');
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(saved).toEqual(['x']);
    a.dispose();
  });

  it('keeps a failed value pending for the next flush', async () => {
    let fail = true;
    const saved: number[] = [];
    const onError = vi.fn();
    const a = createAutosave<number>({
      save: (v) => {
        if (fail) throw new Error('quota');
        saved.push(v);
      },
      onError,
      win: new EventTarget(),
      doc: new EventTarget(),
    });
    a.schedule(7);
    await a.flush();
    expect(onError).toHaveBeenCalledOnce();
    expect(a.pending()).toBe(true);
    fail = false;
    await a.flush();
    expect(saved).toEqual([7]);
    expect(a.pending()).toBe(false);
    a.dispose();
  });
});
